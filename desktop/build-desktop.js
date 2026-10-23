"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { collectDeps } = require("../packaging/deps");

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const target = (process.argv[2] || process.platform).toLowerCase();

function log(...a) { console.log("  " + a.join(" ")); }
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: false, ...opts });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`\n  build failed: ${cmd} ${args.join(" ")} (status ${r.status}, signal ${r.signal})`);
    if (r.error) console.error("  spawn error:", r.error.message);
    process.exit(r.status || 1);
  }
}

const common = {
  appId: "tech.spyro.claudefree",
  productName: "Spyro Studio",
  copyright: "Copyright © Spyro Technologies",
  artifactName: "${productName}-${version}-${arch}.${ext}",
  directories: { output: "dist-desktop", buildResources: "desktop/build" },
  publish: null,
  files: [
    "desktop/main.js",
    "desktop/preload.js",
    "!**/*.map",
  ],
  extraResources: [
    { from: "server/dist", to: "app/server/dist" },
    { from: "server/package.json", to: "app/server/package.json" },
    { from: ".desktop-stage/server_modules", to: "app/server/node_modules", filter: ["**/*"] },
    { from: "web/dist", to: "app/web/dist" },
    { from: "packaging/runtime", to: "runtime", filter: ["**/*"] },
  ],
  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }, { target: "deb", arch: ["x64"] }],
    category: "Development",
    icon: "desktop/build",
    synopsis: "A free, provider-agnostic AI coding agent",
    description: "Spyro Studio is a free, provider-agnostic AI coding agent. Runs entirely on your machine.",
    executableArgs: ["--disable-dev-shm-usage"],
    desktop: {
      Comment: "AI & software development studio",
      Categories: "Development;IDE;",
      StartupWMClass: "Spyro Studio",
      Keywords: "AI;agent;coding;claude;developer;",
    },
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "desktop/build/icon.ico",
    artifactName: "${productName}-${version}-Setup.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Spyro Studio",
  },
  mac: {
    target: [{ target: "dmg", arch: ["x64", "arm64"] }],
    icon: "desktop/build/icon.icns",
    category: "public.app-category.developer-tools",
    identity: null,
  },
  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: "link", path: "/Applications" },
    ],
  },
};

function includeRuntime() {
  const win = path.join(ROOT, "packaging", "runtime", "node.exe");
  const nix = path.join(ROOT, "packaging", "runtime", "bin", "node");
  return fs.existsSync(win) || fs.existsSync(nix);
}

console.log(`\nSpyro Studio — desktop installer (${target})\n`);

function stageServerModules() {
  const dest = path.join(ROOT, ".desktop-stage", "server_modules");
  fs.rmSync(path.join(ROOT, ".desktop-stage"), { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const deps = collectDeps();
  for (const dep of deps) {
    const from = path.join(ROOT, "node_modules", dep);
    fs.cpSync(from, path.join(dest, dep), { recursive: true });
  }
  log(`staged ${deps.length} runtime deps`);
}

if (!fs.existsSync(path.join(ROOT, "server", "dist", "index.js"))) {
  console.error("  server/dist missing — run `npm run build` first.");
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, "web", "dist", "index.html"))) {
  console.error("  web/dist missing — run `npm run build` first.");
  process.exit(1);
}

const runtime = includeRuntime();
log(runtime ? "bundling Node runtime" : "using system Node (no packaged runtime)");

const args = ["--" + (target === "macos" ? "mac" : target)];

if (process.env.CF_DESKTOP_TARGETS) {
  const wanted = process.env.CF_DESKTOP_TARGETS.split(",").map((s) => s.trim());
  // electron-builder uses "win", not "windows", as the config key.
  const key = target === "macos" ? "mac" : target === "windows" ? "win" : target;
  common[key] = { ...common[key], target: wanted.map((t) => ({ target: t, arch: ["x64"] })) };
}
if (!runtime) {
  common.extraResources = common.extraResources.filter((r) => r.to !== "runtime");
}

stageServerModules();

const configPath = path.join(ROOT, "desktop", "electron-builder.json");
fs.writeFileSync(configPath, JSON.stringify(common, null, 2));
log("config:", path.relative(ROOT, configPath));

const eb = path.join(ROOT, "node_modules", "electron-builder", "cli.js");
if (!fs.existsSync(eb)) {
  console.error("\n  electron-builder not installed. Run: npm install\n");
  process.exit(1);
}
run(process.execPath, [eb].concat(args).concat(["--config", configPath]));

console.log(`\n  Done -> ${path.join(ROOT, "dist-desktop")}\n`);
