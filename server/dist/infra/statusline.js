import { spawn } from "node:child_process";
import { shellArgv, killTree } from "./shell.js";
const MAX_OUTPUT = 4_000;
/** Run the configured status-line command. Never throws. */
export function runStatusLine(config, payload, timeoutMs = 5_000) {
    if (!config || config.type !== "command" || !config.command?.trim()) {
        return Promise.resolve({ text: "" });
    }
    return new Promise((resolve) => {
        const sh = shellArgv(config.command);
        let child;
        try {
            child = spawn(sh.command, sh.args, {
                cwd: payload.cwd,
                env: { ...process.env, CLAUDE_PROJECT_DIR: payload.cwd },
                stdio: ["pipe", "pipe", "pipe"],
            });
        }
        catch (err) {
            resolve({ text: "", error: err?.message || String(err) });
            return;
        }
        let out = "";
        let err = "";
        let settled = false;
        const done = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            killTree(child.pid, "SIGKILL");
            done({ text: "", error: "status line command timed out" });
        }, Math.max(500, timeoutMs));
        child.stdout?.on("data", (d) => {
            out += d.toString();
            if (out.length > MAX_OUTPUT * 4)
                killTree(child.pid, "SIGKILL");
        });
        child.stderr?.on("data", (d) => {
            err += d.toString();
        });
        child.on("error", (e) => done({ text: "", error: e?.message || String(e) }));
        child.on("close", (code) => {
            const text = out.trim().split(/\r?\n/)[0] || "";
            if (code !== 0) {
                done({ text, error: err.trim() || `status line exited with code ${code}` });
                return;
            }
            done({ text: text.slice(0, MAX_OUTPUT) });
        });
        try {
            child.stdin?.write(JSON.stringify(payload));
            child.stdin?.end();
        }
        catch {
            // stdin already closed
        }
    });
}
