import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
/** Run a git command in `cwd`, returning stdout/stderr and exit code. */
export function git(cwd, args, timeoutMs = 30_000) {
    return new Promise((resolve) => {
        execFile("git", args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
            resolve({ code, stdout: stdout || "", stderr: stderr || "" });
        });
    });
}
export function isRepo(cwd) {
    return existsSync(join(cwd, ".git"));
}
/** Summarise the working tree status. */
export async function gitStatus(cwd) {
    if (!isRepo(cwd))
        return null;
    const branchRes = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchRes.stdout.trim() || "HEAD";
    const porcelain = await git(cwd, ["status", "--porcelain=v1"]);
    const files = [];
    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    for (const line of porcelain.stdout.split("\n")) {
        if (!line.trim())
            continue;
        const x = line[0];
        const y = line[1];
        const path = line.slice(3).trim();
        if (x === "?" && y === "?") {
            untracked++;
            files.push({ path, status: "untracked", staged: false });
            continue;
        }
        if (x !== " ")
            staged++;
        if (y !== " ")
            unstaged++;
        const flags = `${x}${y}`.trim();
        files.push({ path, status: flags, staged: x !== " " });
    }
    let ahead = 0;
    let behind = 0;
    const counts = await git(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if (counts.code === 0) {
        const parts = counts.stdout.trim().split(/\s+/);
        ahead = Number(parts[0]) || 0;
        behind = Number(parts[1]) || 0;
    }
    return { branch, staged, unstaged, untracked, files, ahead, behind };
}
/** Produce a review-friendly diff (staged, or all working-tree changes). */
export async function gitDiff(cwd, staged = false, maxLines = 2000, path) {
    const args = ["diff", "--no-color"];
    if (staged)
        args.push("--cached");
    if (path)
        args.push("--", path);
    const res = await git(cwd, args);
    const out = res.stdout || res.stderr;
    const lines = out.split("\n");
    if (lines.length > maxLines) {
        return (lines.slice(0, maxLines).join("\n") +
            `\n… [truncated, ${lines.length - maxLines} more lines — narrow the diff with a path]`);
    }
    return out;
}
/** Recent commit log in oneline form. */
export async function gitLog(cwd, count = 20) {
    const res = await git(cwd, ["log", `--max-count=${count}`, "--pretty=format:%h %s (%an, %ad)", "--date=short"]);
    return res.stdout.trim();
}
