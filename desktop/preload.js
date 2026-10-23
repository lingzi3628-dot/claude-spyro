"use strict";
/**
 * Minimal, locked-down bridge. The renderer gets no filesystem, no shell,
 * no Node — just a few read-only facts about where it is running.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("cfDesktop", {
  desktop: true,
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version || "0.1.0",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});