import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { shellArgv, killTree } from "./shell.js";
export const HOOK_EVENTS = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "SubagentStop",
    "SessionStart",
    "SessionEnd",
    "PreCompact",
    "Notification",
];
/**
 * Runs user-configured lifecycle hooks. Hooks are shell commands that receive a
 * JSON payload on stdin. A hook that exits with code 2 blocks the action, and
 * its stderr is surfaced as the reason (mirrors Claude Code semantics).
 *
 * Config is read from `<cwd>/.claude/settings.json` and
 * `~/.claude-free/settings.json` under the `hooks` key, e.g.
 *   { "hooks": { "PreToolUse": [{ "matcher": "bash", "command": "..." }] } }
 */
export class HookRunner {
    hooks = {};
    cwd;
    constructor(cwd) {
        this.cwd = cwd;
        this.load(cwd);
    }
    load(cwd, extraFiles = []) {
        this.cwd = cwd;
        const merged = {};
        const paths = [
            join(homedir(), ".claude-free", "settings.json"),
            join(homedir(), ".claude", "settings.json"),
            join(cwd, ".claude", "settings.json"),
            ...extraFiles,
        ];
        for (const p of paths) {
            if (!existsSync(p))
                continue;
            try {
                const raw = JSON.parse(readFileSync(p, "utf8"));
                const hooks = raw.hooks || {};
                for (const event of HOOK_EVENTS) {
                    const defs = hooks[event];
                    if (!Array.isArray(defs))
                        continue;
                    const valid = [];
                    for (const d of defs) {
                        if (!d)
                            continue;
                        const matcher = typeof d.matcher === "string" ? d.matcher : undefined;
                        // Flat form: { matcher, command }
                        if (typeof d.command === "string") {
                            valid.push({ matcher, command: d.command, timeout: Number(d.timeout) || 30_000 });
                            continue;
                        }
                        // Claude Code nested form: { matcher, hooks: [{ type, command }] }
                        if (Array.isArray(d.hooks)) {
                            for (const h of d.hooks) {
                                if (h && typeof h.command === "string") {
                                    valid.push({
                                        matcher,
                                        command: h.command,
                                        timeout: Number(h.timeout) || 30_000,
                                    });
                                }
                            }
                        }
                    }
                    if (valid.length)
                        merged[event] = [...(merged[event] || []), ...valid];
                }
            }
            catch {
                // ignore malformed settings
            }
        }
        this.hooks = merged;
    }
    list() {
        return this.hooks;
    }
    has(event) {
        return (this.hooks[event] || []).length > 0;
    }
    matching(event, matcherValue) {
        const defs = this.hooks[event] || [];
        return defs.filter((d) => {
            if (!d.matcher || d.matcher === "*")
                return true;
            if (matcherValue === undefined)
                return true;
            return globMatch(d.matcher, matcherValue);
        });
    }
    /** Run all matching hooks for the event. Returns the first blocking result. */
    async run(event, matcherValue, payload) {
        const defs = this.matching(event, matcherValue);
        let lastStdout = "";
        for (const def of defs) {
            const res = await this.exec(def, event, payload);
            if (res.stdout)
                lastStdout = res.stdout;
            if (res.blocked)
                return res;
        }
        return { blocked: false, stdout: lastStdout || undefined };
    }
    exec(def, event, payload) {
        return new Promise((resolve) => {
            const body = JSON.stringify({ event, ...payload });
            const sh = shellArgv(def.command);
            const child = spawn(sh.command, sh.args, {
                cwd: this.cwd,
                env: { ...process.env, CLAUDE_PROJECT_DIR: this.cwd },
            });
            let out = "";
            let err = "";
            const timer = setTimeout(() => {
                killTree(child.pid, "SIGKILL");
                resolve({ blocked: false, reason: "hook timed out" });
            }, def.timeout || 30_000);
            child.stdout?.on("data", (d) => (out += d.toString()));
            child.stderr?.on("data", (d) => (err += d.toString()));
            child.on("error", () => {
                clearTimeout(timer);
                resolve({ blocked: false });
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                if (code === 2) {
                    resolve({ blocked: true, reason: err.trim() || out.trim() || "Blocked by hook", stdout: out });
                }
                else {
                    // Some hooks express a block decision via JSON on stdout.
                    const decision = parseDecision(out);
                    if (decision?.decision === "block") {
                        resolve({ blocked: true, reason: decision.reason || "Blocked by hook", stdout: out });
                    }
                    else {
                        resolve({ blocked: false, stdout: out || undefined, reason: err.trim() || undefined });
                    }
                }
            });
            try {
                child.stdin?.write(body);
                child.stdin?.end();
            }
            catch {
                // stdin already closed
            }
        });
    }
}
function globMatch(pattern, value) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$").test(value);
}
function parseDecision(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed.startsWith("{"))
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
