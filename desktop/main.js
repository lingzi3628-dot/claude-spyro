"use strict";
/**
 * Spyro Studio — native desktop shell.
 *
 * Runs the local Node server as a child process and shows it in a real OS
 * window. No browser, no "open a link". Everything stays on this machine.
 */
const { app, BrowserWindow, Menu, shell, dialog, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");

const APP_NAME = "Spyro Studio";
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

/* ---- GPU handling ------------------------------------------------------ */
/**
 * Disable GPU acceleration on Linux by default (fixes Haswell/Broadwell crash).
 * Users can override via:
 *   - env var: SPYRO_STUDIO_GPU=1  (force GPU on)
 *   - env var: SPYRO_STUDIO_GPU=0  (force GPU off)
 *   - CLI flag: --disable-gpu or --safe
 *   - Settings UI (persisted in localStorage via web UI)
 */
function configureGPU() {
  const forceGPU = process.env.SPYRO_STUDIO_GPU === "1";
  const disableGPU =
    process.env.SPYRO_STUDIO_GPU === "0" ||
    process.argv.includes("--disable-gpu") ||
    process.argv.includes("--safe") ||
    IS_LINUX; // Linux default: disable (fixes Haswell/Broadwell Vulkan crash)

  if (disableGPU && !forceGPU) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("disable-gpu-compositing");
    app.commandLine.appendSwitch("use-gl", "swiftshader");
    app.commandLine.appendSwitch("disable-features", "Vulkan,VaapiVideoDecoder,VaapiVideoEncoder");
    app.commandLine.appendSwitch("use-angle", "swiftshader");
    if (process.env.CLAUDE_FREE_DEBUG) {
      console.log("[GPU] Hardware acceleration DISABLED (Linux default / --disable-gpu / --safe)");
    }
  } else if (IS_LINUX && forceGPU) {
    // On Linux with GPU forced on, still disable Vulkan specifically
    app.commandLine.appendSwitch("disable-features", "Vulkan");
  }

  // macOS: disable GPU compositing only (safer default)
  if (IS_MAC) {
    app.commandLine.appendSwitch("disable-gpu-compositing");
  }

  // Windows: default to GPU on, but allow override
  if (IS_WIN && disableGPU) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("disable-gpu-compositing");
    app.commandLine.appendSwitch("use-gl", "swiftshader");
  }
}

// Configure GPU BEFORE app.whenReady()
configureGPU();

/* ------------------------------------------------------------------ paths */

function resource(...p) {
  return path.join(process.resourcesPath || path.join(__dirname, ".."), ...p);
}

function serverEntry() {
  const packaged = resource("app", "server", "dist", "index.js");
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, "..", "server", "dist", "index.js");
  if (fs.existsSync(dev)) return dev;
  return null;
}

/**
 * Pick the Node used to run the Spyro Studio server.
 *
 * Preference order:
 *   1. a Node runtime shipped inside the package (if one was bundled)
 *   2. Electron itself in Node mode — no extra 50 MB download, and it is
 *      already on disk, so the app has zero runtime dependencies
 *   3. whatever `node` is on PATH
 */
function nodeBinary() {
  const candidates = IS_WIN
    ? [resource("runtime", "node.exe"), resource("node.exe")]
    : [resource("runtime", "bin", "node"), resource("bin", "node"), resource("node")];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  if (app.isPackaged) return process.execPath; // Electron-as-Node
  return "node";
}

function iconPath() {
  const cands = IS_MAC
    ? [resource("app", "build", "icon.icns"), path.join(__dirname, "build", "icon.icns")]
    : IS_WIN
      ? [resource("app", "build", "icon.ico"), path.join(__dirname, "build", "icon.ico")]
      : [resource("app", "build", "icon.png"), path.join(__dirname, "build", "icon.png")];
  return cands.find((c) => fs.existsSync(c)) || null;
}

/* ------------------------------------------------------------------ state */

let server = null;
let win = null;
let quitting = false;
let port = 0;

/* ---------------------------------------------------------------- helpers */

function probe(url, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await probe(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * If the preferred port is already taken (another copy of Spyro Studio, or the
 * browser version), walk forward until we find a free one. Starting on a busy
 * port would make our own child crash with EADDRINUSE.
 */
async function findFreePort(preferred) {
  if (!(await probe(`http://127.0.0.1:${preferred}/api/state`, 800))) return preferred;
  for (let p = preferred + 1; p < preferred + 40; p++) {
    if (!(await probe(`http://127.0.0.1:${p}/api/state`, 400))) return p;
  }
  return preferred;
}

let serverErrorLog = "";

function startServer() {
  const entry = serverEntry();
  if (!entry) {
    dialog.showErrorBox(
      APP_NAME,
      "Could not find the Spyro Studio server.\n\nExpected it at:\n" + entry,
    );
    app.quit();
    return;
  }

  const args = [entry];

  server = spawn(nodeBinary(), args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // The server reads its port from PORT (config.ts), not from argv.
      PORT: String(port),
      CLAUDE_FREE_DESKTOP: "1",
      ELECTRON_RUN_AS_NODE: "1",
    },
    windowsHide: true,
  });

  server.stdout.on("data", (d) => {
    const s = d.toString();
    if (process.env.CLAUDE_FREE_DEBUG) process.stdout.write("[server] " + s);
  });
  server.stderr.on("data", (d) => {
    const s = d.toString();
    serverErrorLog += s;
    if (serverErrorLog.length > 4000) serverErrorLog = serverErrorLog.slice(-4000);
    if (process.env.CLAUDE_FREE_DEBUG) process.stderr.write("[server!] " + s);
  });

  server.on("exit", (code) => {
    server = null;
    if (!quitting && code !== 0) {
      // Show why. "Stopped unexpectedly (code 1)" on its own tells the user
      // nothing at all, which is exactly when they need the reason.
      const tail = serverErrorLog
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-8)
        .join("\n");
      dialog.showErrorBox(
        APP_NAME,
        "The Spyro Studio server stopped unexpectedly (code " + code + ")." +
          (tail ? "\n\nLast output:\n" + tail : ""),
      );
      app.quit();
    }
  });
}

function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  try {
    if (IS_WIN) spawn("taskkill", ["/pid", String(s.pid), "/T", "/F"], { windowsHide: true });
    else s.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ window */

function createWindow() {
  const icon = iconPath();

  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: APP_NAME,
    backgroundColor: "#1f1e1d",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // The UI is served from localhost. Anything trying to navigate elsewhere
  // (or open a window) gets handed to the real browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`) && !url.startsWith(`http://localhost:${port}`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.on("closed", () => {
    win = null;
  });

  win.loadURL(`http://127.0.0.1:${port}/`);
}

function buildMenu() {
  const isMac = IS_MAC;
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: () => win && win.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('cf:new-chat'))"),
        },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => win && win.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('cf:open-settings'))"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "Quit " + APP_NAME },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About " + APP_NAME,
          click: () =>
            dialog.showMessageBox(win, {
              type: "info",
              title: "About " + APP_NAME,
              message: APP_NAME,
              detail:
                "Version " + app.getVersion() +
                "\n\nA free, provider-agnostic AI coding agent.\nSpyro Technologies — AI & software development studio.\n\nEverything runs locally on this machine.",
              buttons: ["OK"],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------- boot */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // Ask the server which port it wants; fall back to its own default.
    const preferred = Number(process.env.CLAUDE_FREE_PORT || process.env.PORT) || 8791;
    port = await findFreePort(preferred);
    if (port !== preferred) {
      process.stdout.write(`Port ${preferred} is busy — using ${port} instead.\n`);
    }

    startServer();

    const ready = await waitForServer(`http://127.0.0.1:${port}/api/state`);
    if (!ready) {
      dialog.showErrorBox(
        APP_NAME,
        "Spyro Studio did not start.\n\nPort " + port + " may already be in use by another copy.\n" +
          "Set CLAUDE_FREE_PORT to a free port and try again.",
      );
      app.quit();
      return;
    }

    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  stopServer();
  if (!IS_MAC) app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  stopServer();
});

process.on("exit", stopServer);