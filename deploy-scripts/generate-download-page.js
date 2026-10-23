#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DIST_DESKTOP = resolve(PROJECT_ROOT, "dist-desktop");
const DIST_PACKAGE = resolve(PROJECT_ROOT, "dist-package");
const DEPLOY_DIR = resolve(PROJECT_ROOT, "deploy");
const PUBLIC_DIR = join(DEPLOY_DIR, "public");
const TEMPLATE = resolve(PROJECT_ROOT, "deploy-scripts", "index.template.html");

function readVersion() {
  const pkgPath = resolve(PROJECT_ROOT, "package.json");
  if (existsSync(pkgPath)) {
    return JSON.parse(readFileSync(pkgPath, "utf8")).version;
  }
  return "0.1.0";
}

const version = readVersion();
const APP_IMAGE_NAME = `Spyro Studio-${version}-x86_64.AppImage`;
const TARBALL_NAME = `claude-free-spyro-${version}-linux-x64.tar.gz`;
// AppImage is hosted on GitHub Releases (too big for git).
// Uses the main spyro-studio repo for releases.
const APP_IMAGE_URL =
  `https://github.com/lingzi3628-dot/claude-spyro/releases/download/v${version}/${APP_IMAGE_NAME.replace(" ", ".")}`;
// GitHub turns spaces into dots in release asset names.
const APP_IMAGE_FILE = APP_IMAGE_NAME.replace(" ", ".");

function sha256(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function generate() {
  console.log("Generating download page...");

  const date = new Date().toISOString().slice(0, 10);

  const appImagePath = join(DIST_DESKTOP, APP_IMAGE_NAME);
  const tarballPath = join(DIST_PACKAGE, TARBALL_NAME);

  if (!existsSync(appImagePath)) {
    console.error("AppImage not found:", appImagePath);
    process.exit(1);
  }
  if (!existsSync(tarballPath)) {
    console.error("Tarball not found:", tarballPath);
    process.exit(1);
  }
  if (!existsSync(TEMPLATE)) {
    console.error("Template not found:", TEMPLATE);
    process.exit(1);
  }

  const appImageSha256 = sha256(appImagePath);
  const tarballSha256 = sha256(tarballPath);
  const appImageSize = formatBytes(readFileSync(appImagePath).length);
  const tarballSize = formatBytes(readFileSync(tarballPath).length);

  mkdirSync(PUBLIC_DIR, { recursive: true });

  // The tarball is small enough to ship in git; the AppImage is not.
  cpSync(tarballPath, join(PUBLIC_DIR, TARBALL_NAME), { force: true });

  const template = readFileSync(TEMPLATE, "utf8");
  const html = template
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{DATE}}", date)
    .replaceAll("{{APP_IMAGE_URL}}", APP_IMAGE_URL)
    .replaceAll("{{APP_IMAGE_FILE}}", APP_IMAGE_FILE)
    .replaceAll("{{APP_IMAGE_SIZE}}", appImageSize)
    .replaceAll("{{APP_IMAGE_SHA}}", appImageSha256)
    .replaceAll("{{TARBALL_FILE}}", TARBALL_NAME)
    .replaceAll("{{TARBALL_SIZE}}", tarballSize)
    .replaceAll("{{TARBALL_SHA}}", tarballSha256);

  writeFileSync(join(PUBLIC_DIR, "index.html"), html);
  writeFileSync(
    join(PUBLIC_DIR, "SHA256SUMS"),
    `${appImageSha256}  ${APP_IMAGE_NAME}\n${tarballSha256}  ${TARBALL_NAME}\n`,
  );

  console.log("Download page generated at:", PUBLIC_DIR);
  console.log("  index.html + tarball + SHA256SUMS");
  console.log("  AppImage URL:", APP_IMAGE_URL);
}

generate();
