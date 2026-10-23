#!/usr/bin/env node
/**
 * Cross-platform smoke test.
 *
 * Starts the built server on a free port and asserts the essentials work.
 * Uses only Node built-ins so it behaves the same on Linux, macOS and Windows —
 * no curl, no bash, no PowerShell.
 *
 *   node scripts/smoke.mjs            # test the repo build
 *   CF_SMOKE_APP=/path/to/app node scripts/smoke.mjs   # test a staged install
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const APP = process.env.CF_SMOKE_APP || path.join(__dirname, "..");
const ENTRY = fs.existsSync(path.join(APP, "server", "dist", "index.js"))
  ? path.join(APP, "server", "dist", "index.js")
  : fs.existsSync(path.join(APP, "server.js"))
    ? path.join(APP, "server.js")
    : null;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (extra ? " -> " + String(extra).slice(0, 200) : ""));
  }
};

if (!ENTRY) {
  console.error("Server build not found. Run `npm run build` first.");
  process.exit(1);
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, type: res.headers["content-type"] || "" }));
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, body: "", type: "" });
    });
    req.on("error", () => resolve({ status: 0, body: "", type: "" }));
  });
}

async function main() {
  const port = await freePort();
  console.log(`smoke: platform=${process.platform} port=${port} app=${APP}`);

  // NEVER inherit the real HOME: the server loads and *rewrites*
  // ~/.claude-free/config.json at startup, so a smoke run pointed at the real
  // home silently overwrites the user's workspace, keys and model settings.
  // Always use a throwaway directory.
  const smokeHome = path.join(APP, ".smoke-home");
  fs.rmSync(smokeHome, { recursive: true, force: true });
  fs.mkdirSync(path.join(smokeHome, ".claude-free"), { recursive: true });
  fs.writeFileSync(
    path.join(smokeHome, ".claude-free", "config.json"),
    JSON.stringify(
      {
        cwd: path.join(APP, ".smoke-workspace"),
        apiKeys: {},
        model: { provider: "openai-compatible", model: "test-model", baseUrl: "http://localhost:9/v1" },
      },
      null,
      2,
    ),
  );

  const child = spawn(process.execPath, [ENTRY], {
    cwd: APP,
    env: {
      ...process.env,
      PORT: String(port),
      HOME: smokeHome,
      // Keep the test from touching the user's real config/session store.
      CLAUDE_FREE_CWD: path.join(APP, ".smoke-workspace"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  // Wait for readiness.
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await get(`http://127.0.0.1:${port}/api/state`);
    if (res.status === 200) {
      ready = true;
      break;
    }
  }

  ok("server starts and answers /api/state", ready, log);
  if (!ready) {
    child.kill("SIGKILL");
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  const base = `http://127.0.0.1:${port}`;

  const root = await get(base + "/");
  ok("GET / serves the app shell", root.status === 200 && /<div id="root">/.test(root.body), root.status);

  const state = await get(base + "/api/state");
  let stateJson = null;
  try {
    stateJson = JSON.parse(state.body);
  } catch {
    /* handled below */
  }
  ok("GET /api/state returns valid JSON", !!stateJson);
  ok("server reports its platform", !!stateJson && typeof stateJson.platform === "string", stateJson && stateJson.platform);
  ok("server reports its shell", !!stateJson && !!stateJson.shell, stateJson && stateJson.shell);
  ok("providers are advertised", !!stateJson && Object.keys(stateJson.providers || {}).length >= 10, stateJson && Object.keys(stateJson.providers || {}).length);
  ok("presets are advertised", !!stateJson && (stateJson.presets || []).length >= 10, stateJson && (stateJson.presets || {}).length);

  const manifest = await get(base + "/manifest.webmanifest");
  ok("PWA manifest served with correct MIME", manifest.status === 200 && /json|manifest/.test(manifest.type), manifest.type);

  const sw = await get(base + "/sw.js");
  ok("service worker served as JS", sw.status === 200 && /javascript/.test(sw.type), sw.type);

  const dragon = await get(base + "/dragon.svg");
  ok("dragon icon served as SVG", dragon.status === 200 && /svg/.test(dragon.type), dragon.type);

  const sandbox = await get(base + "/api/sandbox");
  ok("sandbox status endpoint answers", sandbox.status === 200);

  // Exercise the shell layer directly: this is the part that breaks per-OS.
  const probe = `
    const { ToolRegistry } = require(${JSON.stringify(path.join(APP, "server/dist/tools/index.js").replace(/\.js$/, ".js"))});
    const { TodoStore } = require(${JSON.stringify(path.join(APP, "server/dist/todos.js"))});
    const r = new ToolRegistry();
    const ctx = { cwd: ${JSON.stringify(path.join(APP, ".smoke-workspace"))}, todos: new TodoStore(), protectedDirs: [], emit(){}, approve: async()=>true };
    r.get("bash").execute({ command: "echo SMOKE_SHELL_OK" }, ctx).then((o) => {
      console.log("BASH_OUT:" + o.replace(/\\n/g, "|"));
    }).catch((e) => console.log("BASH_ERR:" + e.message));
  `;
  const probeFile = path.join(APP, ".smoke-probe.cjs");
  fs.writeFileSync(probeFile, probe, "utf8");
  const pr = spawnSync(process.execPath, [probeFile], { cwd: APP, encoding: "utf8", timeout: 60000 });
  const bashOut = (pr.stdout || "").match(/BASH_OUT:([^\n]*)/)?.[1] || "";
  ok(
    "bash tool runs a command through the platform shell",
    bashOut.includes("SMOKE_SHELL_OK"),
    `[shell=${stateJson && stateJson.shell}] ` + (bashOut || pr.stderr || pr.stdout),
  );

  fs.rmSync(probeFile, { force: true });
  fs.rmSync(path.join(APP, ".smoke-workspace"), { recursive: true, force: true });

  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});