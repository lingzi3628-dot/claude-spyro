/**
 * Bundles the server into one minified file for distribution.
 *
 * The development build stays as separate, readable modules; what ships is a
 * single bundle with identifiers mangled and comments stripped, which makes the
 * internals substantially harder to follow and stops source maps from handing
 * over the original source.
 *
 * This raises the cost of inspection. It cannot make it impossible: code the
 * browser and the server execute is, by definition, readable by whoever runs it.
 */
import { build } from "esbuild";
import { rmSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "server", "dist-bundle");

rmSync(OUT, { recursive: true, force: true });

const result = await build({
  entryPoints: [
    path.join(ROOT, "server/src/index.ts"),
    path.join(ROOT, "server/src/cli-main.ts"),
  ],
  outdir: OUT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  // Only our own source is bundled. Third-party packages stay external so they
  // resolve from node_modules at runtime — several are CommonJS and use
  // dynamic require(), which does not survive being inlined into an ESM file.
  // They are separate, separately-licensed libraries, so bundling them buys
  // nothing for protecting this code.
  packages: "external",
  banner: {
    js: "// Spyro Studio - closed source. Licensed to Spyro Technologies. Unauthorised use or redistribution is prohibited.",
  },
  metafile: true,
});

const total = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`server bundled -> ${OUT}  (${Math.round(total / 1024)} KB)`);
if (!existsSync(path.join(OUT, "index.js"))) {
  console.error("bundle did not produce index.js");
  process.exit(1);
}
