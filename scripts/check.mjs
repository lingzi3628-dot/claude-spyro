/**
 * Repository guard.
 *
 * Catches the failure classes that have actually bitten this project:
 *
 *  - require() inside ESM modules (broke the desktop build outright)
 *  - tool names advertised to the model that are not registered (made the
 *    agent unable to read or write files, with no error anywhere)
 *  - declared-but-unwired helpers: a refactor once silently dropped every
 *    multi-cursor handler and the breadcrumb bar while the code still compiled
 *  - source maps or TypeScript sources reachable in the shipped product
 *  - unused locals hiding dead code
 *
 * Run with: node scripts/check.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log("  FAIL  " + msg);
};
const ok = (msg) => console.log("  ok    " + msg);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.statSync?.isDirectory?.() || e.isDirectory()) {
      if (["node_modules", "dist", "dist-bundle", ".git"].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const serverFiles = walk(join(ROOT, "server/src"));
const webFiles = walk(join(ROOT, "web/src"));

/* 1 ---------------------------------------------- require() in ESM sources */
{
  const bad = [];
  for (const f of serverFiles) {
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((l, i) => {
      if (/\brequire\s*\(/.test(l) && !/createRequire|nodeRequire/.test(l)) bad.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
    });
  }
  if (bad.length) fail("require() in an ESM module: " + bad.join(", "));
  else ok("no require() inside ESM modules");
}

/* 2 ------------------------------------------- advertised tool names exist */
{
  const real = new Set();
  for (const f of readdirSync(join(ROOT, "server/src/tools"))) {
    if (!f.endsWith(".ts")) continue;
    for (const m of readFileSync(join(ROOT, "server/src/tools", f), "utf8").matchAll(/name:\s*"([a-z_]+)"/g)) real.add(m[1]);
  }
  /**
   * A phantom name means different things in different lists:
   *   CORE_TOOLS        harmful - the filter hides the real tool from the model
   *   READONLY          mild    - that tool just does not get batched
   *   PLAN_MODE_ALLOWED harmless - an allow-list entry that never matches
   */
  const namesIn = (file, marker, span) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    const i = src.indexOf(marker);
    if (i === -1) return null;
    const block = src.slice(i, i + span);
    // stop at the end of the list literal
    const end = block.indexOf("]);");
    return [...(end > -1 ? block.slice(0, end) : block).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((n) => n !== "tool_search");
  };

  const core = namesIn("server/src/tools/toolsearch.ts", "CORE_TOOLS = [", 900) || [];
  const coreBad = core.filter((n) => !real.has(n));
  if (coreBad.length) fail(`CORE_TOOLS advertises unregistered tools: ${coreBad.join(", ")}`);
  else ok(`all ${core.length} core tool names are registered`);

  const readonly = namesIn("server/src/agent/loop.ts", "const READONLY", 400) || [];
  const roBad = readonly.filter((n) => !real.has(n));
  if (roBad.length) fail(`READONLY batches unregistered tools: ${roBad.join(", ")}`);
  else ok("read batching names are registered");

  const plan = namesIn("server/src/agent/loop.ts", "PLAN_MODE_ALLOWED", 600) || [];
  const planBad = plan.filter((n) => !real.has(n));
  if (planBad.length) console.log(`  note  plan-mode allow-list has ${planBad.length} unused entries (harmless): ${planBad.join(", ")}`);
  else ok("plan-mode allow-list names are registered");
}

/* 3 ----------------------------------------- unwired helpers in components */
{
  const unwired = [];
  for (const f of webFiles) {
    const src = readFileSync(f, "utf8");
    // const x = / function x( / arrow functions, counted across the file
    const re = /(?:^|\n)\s*(?:const|function)\s+([a-zA-Z_$][\w$]*)\s*(?:=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]*)?=>|\()/g;
    for (const m of src.matchAll(re)) {
      const name = m[1];
      if (["render", "format", "noop"].includes(name)) continue;
      // Exported symbols are used from other files; only private helpers matter.
      const decl = src.slice(Math.max(0, m.index - 12), m.index);
      if (/export\s+$/.test(decl)) continue;
      const uses = (src.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
      if (uses <= 1) unwired.push(`${f.slice(ROOT.length + 1)}: ${name}`);
    }
  }
  if (unwired.length) fail("declared but never referenced (likely unwired): " + unwired.join(", "));
  else ok("no unwired helpers");
}

/* 4 ------------------------------------------ shipped product has no source */
{
  const targets = [
    join(process.env.HOME || "/root", ".local/share/claude-free"),
    join(process.env.HOME || "/root", ".local/opt/claude-free-native/resources/app"),
  ].filter(existsSync);
  if (!targets.length) {
    ok("no installed copies to inspect (skipped)");
  } else {
    const leaks = [];
    for (const root of targets) {
      for (const rel of ["server/dist", "web/dist"]) {
        const dir = join(root, rel);
        if (!existsSync(dir)) continue;
        const scan = (d) => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) scan(p);
            else if (/\.(map|ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) leaks.push(`${root.includes("opt") ? "desktop" : "browser"}/${rel}/${e.name}`);
          }
        };
        scan(dir);
      }
    }
    if (leaks.length) fail("source or maps in the shipped product: " + leaks.slice(0, 5).join(", "));
    else ok("no source maps or TypeScript in the shipped product");
  }
}

/* 5 ----------------------------------------------- no unused declarations */
{
  let out = "";
  try {
    out = execFileSync("npx", ["-w", "server", "tsc", "--noEmit", "--noUnusedLocals", "--noUnusedParameters"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
  }
  const lines = out.split("\n").filter((l) => l.includes("error TS"));
  if (lines.length) fail(`${lines.length} type/unused error(s) in server — first: ${lines[0].trim()}`);
  else ok("server typechecks with no unused declarations");
}

/* 6 --------------------------------------------- ports we squat on */
{
  const cfg = readFileSync(join(ROOT, "server/src/config.ts"), "utf8");
  const m = /DEFAULT_PORT\s*=\s*(\d+)/.exec(cfg);
  if (!m) fail("DEFAULT_PORT is not defined");
  else {
    const port = Number(m[1]);
    // 8787 is Turbopack's; 3000/5173/8000/8080 belong to common dev servers.
    const clashing = [8787, 3000, 5173, 8000, 8080, 4200];
    if (clashing.includes(port)) fail(`default port ${port} collides with a common dev server`);
    else ok(`default port ${port} does not collide with common dev servers`);
  }
}

/* 7 ---------------------------------- runtime deps are actually packaged */
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const declared = Object.keys(pkg.dependencies || {});
  const roots = readFileSync(join(ROOT, "packaging/deps.js"), "utf8");
  const packaged = /const RUNTIME_ROOTS = \[(.*?)\];/.exec(roots)?.[1] || "";
  const missing = declared.filter((d) => !packaged.includes(`"${d}"`));
  if (missing.length) fail("runtime dependencies not in the package: " + missing.join(", "));
  else ok(`${declared.length} runtime dependencies are packaged`);

  /**
   * And the installed copies must be able to resolve them from where the
   * bundled server actually sits — a dependency present but in the wrong
   * directory fails only when the code path runs, in a user's hands.
   */
  const targets = [
    [join(process.env.HOME || "/root", ".local/share/claude-free/server/dist/index.js"), "browser"],
    [join(process.env.HOME || "/root", ".local/opt/claude-free-native/resources/app/server/dist/index.js"), "desktop"],
  ].filter(([f]) => existsSync(f));

  if (!targets.length) {
    ok("no installed copies to resolve against (skipped)");
  } else {
    const broken = [];
    for (const [entry, label] of targets) {
      // Resolve from the bundled server's own directory, as Node would.
      const base = join(entry, "..", "..");
      for (const d of declared) {
        if (!existsSync(join(base, "node_modules", d)) && !existsSync(join(base, "..", "node_modules", d))) {
          broken.push(`${label}:${d}`);
        }
      }
    }
    if (broken.length) fail("dependency cannot be resolved from the installed server: " + broken.join(", "));
    else ok(`all runtime dependencies resolve from ${targets.length} installed build(s)`);
  }
}

console.log("");
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
