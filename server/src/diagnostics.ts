import { existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface Problem {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

/**
 * Run the project's own type checker and turn its output into real problems.
 *
 * Using the project's own tsconfig (rather than a guess) means the Problems
 * view agrees with what `npm run build` will actually tell you.
 */
export function findTsconfig(root: string): string | null {
  for (const c of ["tsconfig.json", "jsconfig.json"]) {
    const p = resolve(root, c);
    if (existsSync(p)) return p;
  }
  return null;
}

export async function runDiagnostics(root: string, timeoutMs = 45000): Promise<{ problems: Problem[]; tool: string }> {
  const tsconfig = findTsconfig(root);
  const problems: Problem[] = [];

  const run = (cmd: string, args: string[]) =>
    new Promise<{ out: string; code: number }>((done) => {
      let out = "";
      const child = spawn(cmd, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "0" } });
      const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout?.on("data", (d) => (out += d.toString()));
      child.stderr?.on("data", (d) => (out += d.toString()));
      child.on("close", (code) => {
        clearTimeout(t);
        done({ out, code: code ?? 0 });
      });
      child.on("error", () => {
        clearTimeout(t);
        done({ out, code: 1 });
      });
    });

  /**
   * Invoke the project's own tsc. Prefer the binary next to whichever
   * node_modules is in scope; npx alone silently finds nothing in projects that
   * don't have their own install, which reads as "no problems" — a bad lie.
   */
  const findTsc = (): { cmd: string; args: string[] } | null => {
    for (const dir of [resolve(root, "node_modules/.bin"), resolve(root, "../node_modules/.bin")]) {
      const bin = resolve(dir, "tsc");
      if (existsSync(bin)) return { cmd: bin, args: [] };
    }
    try {
      const req = createRequire(resolve(root, "package.json"));
      const p = req.resolve("typescript/bin/tsc");
      if (existsSync(p)) return { cmd: process.execPath, args: [p] };
    } catch {
      /* fall through to the compiler shipped with Spyro */
    }
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const p = resolve(here, "../../node_modules/typescript/bin/tsc");
      if (existsSync(p)) return { cmd: process.execPath, args: [p] };
    } catch {
      /* ignore */
    }
    return null;
  };

  // tsc prints: src/a.ts(12,5): error TS2345: message
  const tsc = tsconfig ? findTsc() : null;
  const tscOut = tsc ? (await run(tsc.cmd, [...tsc.args, "--noEmit", "-p", tsconfig!])).out : "";
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tscOut))) {
    problems.push({
      file: resolve(root, m[1]),
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4] as "error" | "warning",
      code: m[5],
      message: m[6].trim(),
    });
  }

  // node --check catches plain syntax errors in .js/.mjs without any config.
  const files: string[] = [];
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || files.length > 60) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e)) continue;
      const p = resolve(dir, e);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else if (/\.(js|mjs|cjs)$/.test(e)) files.push(p);
      } catch {
        /* ignore */
      }
    }
  };
  walk(root, 0);
  for (const f of files) {
    const r = await run("node", ["--check", f]);
    if (r.code === 0) continue;
    const mm = /:(\d+)\n/.exec(r.out);
    problems.push({
      file: f,
      line: mm ? Number(mm[1]) : 1,
      column: 1,
      severity: "error",
      code: "syntax",
      message: r.out.split("\n").find((l) => l.trim() && !l.includes("Error:"))?.trim() || "Syntax error",
    });
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { problems, tool: tsc ? "tsc" : "node --check" };
}
