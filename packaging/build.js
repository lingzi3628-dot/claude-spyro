#!/usr/bin/env node
/**
 * Build installable artifacts for Spyro Studio.
 *
 * Produces:
 *   dist-package/claude-free-spyro-<v>-linux-x64.tar.gz   (portable, no dpkg needed)
 *   dist-package/claude-free-<v>.deb                       (Debian/Ubuntu, needs dpkg-deb)
 *   dist-package/claude-free-spyro-<v>-win-x64.zip        (Windows)
 *   dist-package/claude-free-spyro-<v>-macos.zip           (macOS .app bundle)
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "dist-package");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;
const NAME = "claude-free";
const BIN = `claude-free-spyro-${VERSION}`;

fs.mkdirSync(OUT, { recursive: true });

/** Zip a directory using Node (works on every OS, no external zip/tar). */
function zipDir(srcDir, outFile) {
  const { execFileSync } = require("node:child_process");
  // Use the system zip/tar where available (fast, native), else fall back to
  // Compress-Archive on Windows.
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${outFile}' -Force`],
      { stdio: "inherit" },
    );
    return true;
  }
  try {
    execFileSync("zip", ["-qr", outFile, "."], { cwd: srcDir, stdio: "ignore" });
    return true;
  } catch {
    try {
      execFileSync("tar", ["-czf", outFile.replace(/\.zip$/, ".tar.gz"), "-C", srcDir, "."], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

/** Create a .tar.gz using system tar (POSIX only; skipped on Windows). */
function tarGz(srcDir, outFile) {
  if (process.platform === "win32") return false;
  return sh("tar", ["-czf", outFile, "-C", path.dirname(srcDir), path.basename(srcDir)]);
}

function sh(cmd, args, opts = {}) {
  try {
    execFileSync(cmd, args, { stdio: "inherit", ...opts });
    return true;
  } catch {
    return false;
  }
}
function has(cmd) {
  try {
    execFileSync("command", ["-v", cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function cp(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}
function must(src) {
  if (!fs.existsSync(src)) {
    console.error("Missing build output:", src, "\nRun `npm run build` first.");
    process.exit(1);
  }
}

// The payload: launcher + server + web + production node_modules.
const STAGE = path.join(OUT, ".stage", BIN);
const { collectDeps } = require("./deps");

function stage() {
  fs.rmSync(path.join(OUT, ".stage"), { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  // Ship the bundled, minified server — not the readable dev output, and never
  // source maps (those embed the original TypeScript).
  const bundled = path.join(ROOT, "server", "dist-bundle");
  if (fs.existsSync(bundled)) cp(bundled, path.join(STAGE, "server", "dist"));
  else cp(path.join(ROOT, "server", "dist"), path.join(STAGE, "server", "dist"));
  // Belt and braces: no maps in the package, whatever happened above.
  for (const dir of [path.join(STAGE, "server", "dist")]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      if (String(f).endsWith(".map") || String(f).endsWith(".ts")) {
        fs.rmSync(path.join(dir, String(f)), { force: true });
      }
    }
  }
  cp(path.join(ROOT, "web", "dist"), path.join(STAGE, "web", "dist"));
  cp(path.join(ROOT, "launcher"), path.join(STAGE, "launcher"));
  cp(path.join(ROOT, "packaging", "runtime"), path.join(STAGE, "runtime"));
  fs.mkdirSync(path.join(STAGE, "node_modules"), { recursive: true });
  // Use the shared root list. Hardcoding a second copy here is how the two
  // payloads drift apart — a new runtime dependency shipped in the AppImage
  // but not the tarball, and failed only once a user hit that code path.
  const deps = collectDeps();
  for (const dep of deps) {
    cp(path.join(ROOT, "node_modules", dep), path.join(STAGE, "node_modules", dep));
  }
  console.log(`  staged payload (${deps.length} runtime deps)`);
}

// --- Linux portable tarball -------------------------------------------------
function buildLinux() {
  const file = path.join(OUT, `${BIN}-linux-x64.tar.gz`);
  console.log("Linux portable:", path.basename(file));
  cp(path.join(ROOT, "packaging", "linux", "launch.sh"), path.join(STAGE, "launch.sh"));
  fs.chmodSync(path.join(STAGE, "launch.sh"), 0o755);
  cp(path.join(ROOT, "packaging", "linux", "install.sh"), path.join(STAGE, "install.sh"));
  fs.chmodSync(path.join(STAGE, "install.sh"), 0o755);
  cp(path.join(ROOT, "packaging", "linux", "README.md"), path.join(STAGE, "README.md"));
  fs.writeFileSync(path.join(STAGE, "VERSION"), VERSION);
  if (process.platform === "win32") {
    console.log("  ⚠ skipped (tar.gz is POSIX-only; build Linux on Linux CI)");
  } else {
    sh("tar", ["-czf", file, "-C", path.join(OUT, ".stage"), BIN]);
    console.log("  ✓", path.basename(file));
  }
}

// --- Debian package ---------------------------------------------------------
function buildDeb() {
  console.log("Debian package:");
  if (!fs.existsSync("/usr/bin/dpkg-deb")) {
    console.log("  ⚠ dpkg-deb not available here — skipping .deb (run this on a Debian box)");
    return;
  }
  const debRoot = path.join(OUT, ".deb", `claude-free_${VERSION}_amd64`);
  fs.rmSync(path.join(OUT, ".deb"), { recursive: true, force: true });
  cp(path.join(OUT, ".stage", BIN), path.join(debRoot, "opt", "claude-free"));
  cp(path.join(ROOT, "packaging", "linux", "control"), path.join(debRoot, "DEBIAN", "control"));
  cp(path.join(ROOT, "packaging", "linux", "postinst"), path.join(debRoot, "DEBIAN", "postinst"));
  cp(path.join(ROOT, "packaging", "linux", "prerm"), path.join(debRoot, "DEBIAN", "prerm"));
  fs.chmodSync(path.join(debRoot, "DEBIAN", "postinst"), 0o755);
  fs.chmodSync(path.join(debRoot, "DEBIAN", "prerm"), 0o755);
  cp(path.join(ROOT, "packaging", "linux", "claude-free.desktop"),
     path.join(debRoot, "usr", "share", "applications", "claude-free.desktop"));
  fs.mkdirSync(path.join(debRoot, "usr", "bin"), { recursive: true });
  const binScript = "#!/bin/sh\nexec /opt/claude-free/launch.sh \"$@\"\n";
  fs.writeFileSync(path.join(debRoot, "usr", "bin", "claude-free"), binScript);
  fs.chmodSync(path.join(debRoot, "usr", "bin", "claude-free"), 0o755);
  const file = path.join(OUT, `claude-free_${VERSION}_amd64.deb`);
  sh("dpkg-deb", ["--build", "--root-owner-group", debRoot, file]);
  console.log("  ✓", path.basename(file));
}

// --- Windows zip ------------------------------------------------------------
function buildWindows() {
  const file = path.join(OUT, `${BIN}-win-x64.zip`);
  const wstage = path.join(OUT, ".stage-win", BIN);
  console.log("Windows:", path.basename(file));
  fs.rmSync(path.join(OUT, ".stage-win"), { recursive: true, force: true });
  cp(path.join(OUT, ".stage", BIN), wstage);
  cp(path.join(ROOT, "packaging", "windows", "Spyro Studio.cmd"), path.join(wstage, "Spyro Studio.cmd"));
  cp(path.join(ROOT, "packaging", "windows", "install.ps1"), path.join(wstage, "install.ps1"));
  cp(path.join(ROOT, "packaging", "windows", "README.md"), path.join(wstage, "README.txt"));
  fs.writeFileSync(path.join(wstage, "VERSION"), VERSION);
  const okZip = zipDir(wstage, file);
  console.log(okZip ? "  ✓ " + path.basename(file) : "  ⚠ could not create " + path.basename(file));
}

// --- macOS zip --------------------------------------------------------------
function buildMac() {
  const file = path.join(OUT, `${BIN}-macos.zip`);
  const mstage = path.join(OUT, ".stage-mac", BIN);
  console.log("macOS:", path.basename(file));
  fs.rmSync(path.join(OUT, ".stage-mac"), { recursive: true, force: true });
  cp(path.join(OUT, ".stage", BIN), mstage);
  const app = path.join(mstage, "Spyro Studio.app");
  const macos = path.join(app, "Contents", "MacOS");
  fs.mkdirSync(macos, { recursive: true });
  cp(path.join(ROOT, "packaging", "macos", "Info.plist"), path.join(app, "Contents", "Info.plist"));
  const launcher = `#!/bin/sh\nDIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"\nexec "$DIR/launch-mac.sh"\n`;
  fs.writeFileSync(path.join(macos, "Spyro Studio"), launcher);
  fs.chmodSync(path.join(macos, "Spyro Studio"), 0o755);
  cp(path.join(OUT, ".stage", BIN), path.join(app, "Contents", "Resources", "app"));
  fs.writeFileSync(path.join(mstage, "launch-mac.sh"), "#!/bin/sh\nDIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nexec \"$DIR/launch.sh\"\n");
  fs.chmodSync(path.join(mstage, "launch-mac.sh"), 0o755);
  const okZip = zipDir(mstage, file);
  console.log(okZip ? "  ✓ " + path.basename(file) : "  ⚠ could not create " + path.basename(file));
}

const ONLY = process.argv[2] || "native"; // native | linux | windows | macos | all
const ALL = ONLY === "all";

console.log("Building Spyro Studio v" + VERSION + " (target=" + ONLY + ")\n");
must(path.join(ROOT, "server", "dist", "index.js"));
must(path.join(ROOT, "web", "dist", "index.html"));
stage();

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// Build everything by default on a dev box, but in CI each runner builds what
// it can and what it owns.
const nativeLinux = ONLY === "native" && !isWin && !isMac;
if (ALL || ONLY === "linux" || nativeLinux) buildLinux();
if (ALL || ONLY === "deb" || nativeLinux) buildDeb();
if (ALL || ONLY === "windows" || (ONLY === "native" && isWin)) buildWindows();
if (ALL || ONLY === "macos" || (ONLY === "native" && isMac)) buildMac();
fs.rmSync(path.join(OUT, ".stage"), { recursive: true, force: true });
fs.rmSync(path.join(OUT, ".stage-win"), { recursive: true, force: true });
fs.rmSync(path.join(OUT, ".stage-mac"), { recursive: true, force: true });
fs.rmSync(path.join(OUT, ".deb"), { recursive: true, force: true });
console.log("\nDone →", OUT);
