import { resolve, join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const perfProfilerTool = {
    name: "perf_profiler",
    description: "Performance profiling: memory usage, CPU, bundle size analysis, and Lighthouse audits. " +
        "Use this to find performance bottlenecks and optimize your app.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["memory", "bundle_size", "lighthouse", "analyze", "node_profile"],
                description: "What to profile",
            },
            url: { type: "string", description: "URL for Lighthouse audit" },
            path: { type: "string", description: "Project path or file to analyze" },
        },
        required: ["action"],
    },
    async execute(args, _ctx) {
        const cwd = _ctx.cwd;
        const action = String(args.action || "memory");
        switch (action) {
            case "memory": {
                const mem = process.memoryUsage();
                const lines = [
                    "## Memory Usage",
                    "",
                    `  RSS:          ${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
                    `  Heap Total:   ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
                    `  Heap Used:    ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
                    `  External:     ${(mem.external / 1024 / 1024).toFixed(1)} MB`,
                    `  Array Buffers: ${(mem.arrayBuffers / 1024 / 1024).toFixed(1)} MB`,
                    "",
                    "### System",
                    `  Platform: ${process.platform}`,
                    `  Node: ${process.version}`,
                    `  Uptime: ${Math.floor(process.uptime())}s`,
                ];
                return lines.join("\n");
            }
            case "bundle_size": {
                const target = args.path ? resolve(cwd, args.path) : cwd;
                const dirs = ["dist", "build", ".next", "out"];
                const results = [];
                for (const d of dirs) {
                    const p = join(target, d);
                    if (!existsSync(p))
                        continue;
                    const size = dirSize(p);
                    results.push(`  ${d}/: ${formatBytes(size)}`);
                    // List largest files
                    const files = listFiles(p, 5);
                    for (const f of files)
                        results.push(`    ${f.name} (${formatBytes(f.size)})`);
                }
                if (!results.length)
                    return "No build output found. Run a build first.";
                return `## Bundle Size\n\n${results.join("\n")}`;
            }
            case "lighthouse": {
                if (!args.url)
                    return "Error: url required for lighthouse";
                try {
                    const r = await exec("npx", ["lighthouse", args.url, "--output=json", "--quiet", "--chrome-flags=--headless"], { timeout: 120_000 });
                    const data = JSON.parse(r.stdout);
                    const cats = data.categories || {};
                    const lines = ["## Lighthouse Scores", ""];
                    for (const [_key, cat] of Object.entries(cats)) {
                        const score = Math.round((cat.score || 0) * 100);
                        lines.push(`  ${cat.title}: ${score}/100`);
                    }
                    return lines.join("\n");
                }
                catch (e) {
                    return `Error running Lighthouse: ${e.message}\n\nInstall: npm install -g lighthouse`;
                }
            }
            case "analyze": {
                const target = args.path ? resolve(cwd, args.path) : cwd;
                const lines = ["## Project Analysis", ""];
                // Count files by type
                const counts = {};
                function walk(dir, depth) {
                    if (depth > 4)
                        return;
                    try {
                        for (const e of readdirSync(dir, { withFileTypes: true })) {
                            if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "build" || e.name === ".git")
                                continue;
                            if (e.isDirectory())
                                walk(join(dir, e.name), depth + 1);
                            else {
                                const ext = e.name.split(".").pop() || "other";
                                counts[ext] = (counts[ext] || 0) + 1;
                            }
                        }
                    }
                    catch { }
                }
                walk(target, 0);
                lines.push("### File counts");
                for (const [ext, count] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
                    lines.push(`  .${ext}: ${count} files`);
                }
                // Check for large files
                lines.push("");
                lines.push("### Large files (>100KB)");
                const largeFiles = findLargeFiles(target, 100 * 1024);
                if (largeFiles.length) {
                    for (const f of largeFiles.slice(0, 10))
                        lines.push(`  ${f.path} (${formatBytes(f.size)})`);
                }
                else {
                    lines.push("  (none)");
                }
                return lines.join("\n");
            }
            case "node_profile": {
                // Profile Node.js process
                const pid = process.pid;
                return `## Node Profile\n\n  PID: ${pid}\n  Platform: ${process.platform}\n  Node: ${process.version}\n  Uptime: ${Math.floor(process.uptime())}s\n  Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB heap used\n\nFor detailed profiling, use: node --prof <script> or node --inspect`;
            }
            default:
                return `Unknown action: ${action}`;
        }
    },
};
function dirSize(dir) {
    let size = 0;
    try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory())
                size += dirSize(p);
            else {
                try {
                    size += statSync(p).size;
                }
                catch { }
            }
        }
    }
    catch { }
    return size;
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
function listFiles(dir, limit) {
    const files = [];
    try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isFile()) {
                const p = join(dir, e.name);
                try {
                    files.push({ name: e.name, size: statSync(p).size });
                }
                catch { }
            }
        }
    }
    catch { }
    return files.sort((a, b) => b.size - a.size).slice(0, limit);
}
function findLargeFiles(dir, minSize, prefix = "") {
    const result = [];
    try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "build" || e.name === ".git")
                continue;
            const p = join(dir, e.name);
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory()) {
                result.push(...findLargeFiles(p, minSize, rel));
            }
            else {
                try {
                    const size = statSync(p).size;
                    if (size >= minSize)
                        result.push({ path: rel, size });
                }
                catch { }
            }
        }
    }
    catch { }
    return result.sort((a, b) => b.size - a.size);
}
