#!/usr/bin/env node
/**
 * Spyro Studio — cross-platform launcher.
 *
 * Starts the bundled server, waits for it to answer, opens the user's browser,
 * and shuts the server down cleanly when the launcher exits. Works on Linux,
 * macOS and Windows from the same file.
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const APP_ROOT = resolveAppRoot();
const IS_WIN = process.platform === "win32";
const NO_BROWSER = process.argv.includes("--no-browser");

// Headless: `claude-free -p "..."`. Run the CLI instead of starting a server.
const HEADLESS = process.argv.includes("-p") || process.argv.includes("--print") ||
  process.argv.includes("--json") || process.argv.includes("--help") ||
  process.argv.includes("-h") || process.argv.includes("--version") ||
  process.argv.includes("-v");
if (HEADLESS) {
  const entry = path.join(__dirname, "..", "server", "dist", "cli-main.js");
  if (!fs.existsSync(entry)) {
    console.error("Spyro Studio is not built yet — run `npm run build`.");
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  process.exit(r.status ?? 1);
}

// --- locate the app ---------------------------------------------------------

function resolveAppRoot() {
  // Packaged layouts put the server next to this file; in the repo it is
  // <root>/launcher/launcher.js.
  const candidates = [
    path.join(__dirname, ".."), // launcher/ -> root
    path.join(__dirname, "..", ".."), // <root>/lib/launcher -> root
    __dirname,
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "server", "dist", "index.js"))) return dir;
  }
  // Last resort: walk up looking for the marker file.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "server", "dist", "index.js"))) return dir;
    dir = path.dirname(dir);
  }
  console.error("Could not locate Spyro Studio's server build (server/dist/index.js).");
  process.exit(1);
}

function findServerEntry() {
  const direct = path.join(APP_ROOT, "server", "dist", "index.js");
  if (fs.existsSync(direct)) return direct;
  const flat = path.join(APP_ROOT, "server.js");
  if (fs.existsSync(flat)) return flat; // SEA / single-file build
  console.error("Server build not found.");
  process.exit(1);
}

// --- port handling ----------------------------------------------------------

function findFreePort(start) {
  return new Promise((resolve) => {
    const net = require("node:net");
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once("error", () => tryPort(port + 1));
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

function probe(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

// --- browser ----------------------------------------------------------------

function openBrowser(url) {
  if (NO_BROWSER) return;
  try {
    if (IS_WIN) {
      // `start` needs an empty title argument or it treats the URL as a window title.
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    console.log("Could not open a browser automatically — open this URL yourself:\n  " + url);
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  const entry = findServerEntry();
  // Honour PORT as well as CLAUDE_FREE_PORT so service files and scripts agree.
  const preferred = Number(process.env.CLAUDE_FREE_PORT || process.env.PORT) || 8791;

  // If something is already serving Spyro Studio on the preferred port, just
  // open it instead of fighting over the port.
  if (await probe(`http://127.0.0.1:${preferred}/api/state`)) {
    const url = `http://127.0.0.1:${preferred}`;
    console.log(`Spyro Studio is already running at ${url}`);
    openBrowser(url);
    return;
  }

  const port = await findFreePort(preferred);
  const url = `http://127.0.0.1:${port}`;

  console.log("Spyro Studio");
  console.log(`  workspace : ${process.env.CLAUDE_FREE_CWD || "(default)"}`);
  console.log(`  url       : ${url}`);
  console.log("  press Ctrl+C to stop\n");

  const server = spawn(process.execPath, [entry], {
    cwd: APP_ROOT,
    env: { ...process.env, PORT: String(port), CLAUDE_FREE_LAUNCHED: "1" },
    stdio: "inherit",
  });

  let opened = false;
  const watcher = setInterval(async () => {
    if (opened) return;
    if (await probe(`${url}/api/state`)) {
      opened = true;
      openBrowser(url);
    }
  }, 700);

  const stop = (code) => {
    clearInterval(watcher);
    if (!server.killed) {
      try {
        server.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    process.exit(code ?? 0);
  };

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  server.on("exit", (code) => {
    clearInterval(watcher);
    process.exit(code ?? 0);
  });
  server.on("error", (err) => {
    console.error("Failed to start the server:", err.message);
    process.exit(1);
  });
}

main();