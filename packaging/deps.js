"use strict";
/**
 * Resolve the full transitive runtime-dependency closure of `roots` by walking
 * each package's "dependencies". Computed from the installed tree so it can
 * never drift out of sync with package.json.
 *
 * Shared by packaging/build.js (tarball/zip/deb) and
 * desktop/build-desktop.js (Electron AppImage/NSIS/dmg) so the two payloads
 * can never drift apart.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** Runtime deps the server actually needs at import time. */
const RUNTIME_ROOTS = ["ws", "fast-glob", "qrcode"];

function collectDeps(roots = RUNTIME_ROOTS) {
  const found = new Set();
  const visit = (name) => {
    if (found.has(name)) return;
    const pkgPath = path.join(ROOT, "node_modules", name, "package.json");
    if (!fs.existsSync(pkgPath)) {
      console.warn("  ⚠ missing runtime dependency:", name);
      return;
    }
    found.add(name);
    const meta = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    for (const dep of Object.keys(meta.dependencies || {})) visit(dep);
  };
  roots.forEach(visit);
  return [...found];
}

module.exports = { collectDeps, RUNTIME_ROOTS };
