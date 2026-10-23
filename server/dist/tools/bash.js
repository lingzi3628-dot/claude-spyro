import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { planCommand, } from "../infra/sandbox.js";
import { killTree } from "../infra/shell.js";
export const bashTool = {
    name: "bash",
    description: "Execute a shell command on the user's machine and return its stdout/stderr. " +
        "Use for running tests, installing packages, git operations, and inspecting the environment. " +
        "Prefer dedicated tools (read_file, edit_file, glob, grep) for file operations.",
    parameters: {
        type: "object",
        properties: {
            command: { type: "string", description: "The bash command to run." },
            description: {
                type: "string",
                description: "A short human-readable description of what the command does.",
            },
            timeout_ms: {
                type: "number",
                description: "Optional timeout in milliseconds. Default 600000 (10 minutes). " +
                    "Raise it for long builds (npm install, next build, tsc on a large project), " +
                    "or use run_in_background for anything longer.",
            },
            run_in_background: {
                type: "boolean",
                description: "Run the command in the background and return a shell id immediately. Poll its output " +
                    "with bash_output and stop it with kill_shell. Use for long-running servers/watchers.",
            },
            allow_network: {
                type: "boolean",
                description: "Allow network access for this command. When the host supports namespace isolation the " +
                    "network is blocked by default; set this for installs, git clone, curl, etc.",
            },
        },
        required: ["command"],
    },
    requiresApproval: true,
    execute(args, ctx) {
        const command = String(args.command || "");
        const lower = command.toLowerCase();
        // Block any command that references the app's own install directory.
        const targetsSelf = ctx.protectedDirs.some((dir) => dir && lower.includes(dir.toLowerCase()));
        if (targetsSelf) {
            return Promise.resolve("Blocked: this command targets Spyro Studio's own installation folder. The agent cannot modify its own source. Work in a different folder instead.");
        }
        if (args.run_in_background) {
            if (!ctx.shells)
                return Promise.resolve("Error: background shells are not available.");
            const timeout = Number(args.timeout_ms) || 600_000;
            const handle = ctx.shells.start(command, ctx.cwd, timeout);
            return Promise.resolve(`Started background shell ${handle.id} (pid ${handle.pid ?? "?"}). ` +
                `Poll output with bash_output(shell_id="${handle.id}").`);
        }
        const timeout = Number(args.timeout_ms) || 120000;
        /** Run one plan; report a spawn-level failure so we can degrade. */
        const run = (exclude) => new Promise((resolve) => {
            const plan = planCommand(command, ctx.cwd, {
                workspace: ctx.cwd,
                allowNetwork: args.allow_network === true,
                limits: { cpuSeconds: Math.max(1, Math.ceil(timeout / 1000)) },
                exclude: exclude,
            });
            if (plan.blocked.length) {
                resolve({
                    text: `Blocked by sandbox policy: ${plan.blocked.join("; ")}. ` +
                        `If this is genuinely safe, run it yourself in a terminal.`,
                });
                return;
            }
            if (plan.warnings.length)
                console.warn(`[sandbox] ${plan.warnings.join("; ")}`);
            // ENOENT is ambiguous: it can mean the sandbox wrapper vanished OR the
            // working directory doesn't exist. Distinguish them, otherwise a typo'd
            // cwd gets misreported as "no usable sandbox layer".
            if (!existsSync(plan.command)) {
                resolve({ text: `Error: sandbox wrapper not found: ${plan.command}`, failed: Object.assign(new Error("wrapper missing"), { code: "ENOENT" }) });
                return;
            }
            if (!existsSync(plan.opts.cwd || "")) {
                resolve({ text: `Error: working directory does not exist: ${plan.opts.cwd}` });
                return;
            }
            const child = spawn(plan.command, plan.args, {
                ...plan.opts,
                // Own process group, so a timeout can signal the whole tree
                // (killTree uses process.kill(-pid)). Without this the shell's
                // children survive and leak until the host refuses to fork.
                detached: true,
            });
            let out = "";
            let timedOut = false;
            let settled = false;
            const timer = setTimeout(() => {
                timedOut = true;
                // Kill the whole tree: without this the wrapper dies but the real
                // shell keeps running, and those orphans pile up until the host
                // refuses to fork ("Resource temporarily unavailable").
                killTree(child.pid, "SIGKILL");
            }, timeout);
            const finish = (text, failed) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve({ text, failed });
            };
            child.stdout?.on("data", (d) => {
                out += d.toString();
                if (out.length > 200_000)
                    out = out.slice(-200_000);
            });
            child.stderr?.on("data", (d) => {
                out += d.toString();
                if (out.length > 200_000)
                    out = out.slice(-200_000);
            });
            child.on("error", (err) => {
                // ENOENT: the sandbox wrapper we detected is not actually runnable.
                finish(`Error: ${err.message}`, err);
            });
            child.on("close", (code) => {
                const status = timedOut ? `\n[timed out after ${timeout}ms]` : `\n[exit code: ${code}]`;
                // A sandbox wrapper that dies instantly while naming itself
                // ("bwrap: execvp ...") is unusable here — degrade instead of
                // surfacing a confusing failure to the model.
                const wrapperDied = code !== 0 &&
                    !timedOut &&
                    out.length < 400 &&
                    /\b(bwrap|bubblewrap)\b/.test(out) &&
                    /execvp|No such file|not found/i.test(out);
                finish((out || "(no output)") + status, wrapperDied ? new Error("sandbox wrapper unusable") : undefined);
            });
        });
        return (async () => {
            let failed = [];
            for (let attempt = 0; attempt < 3; attempt++) {
                const { text, failed: err } = await run(failed);
                if (!err)
                    return text;
                if (err.code === "EAGAIN") {
                    // Fork pressure: retrying immediately makes it worse. Stop and say so.
                    return (`Error: the system is out of process slots (fork: Resource temporarily unavailable). ` +
                        `Close other heavy programs and try again.`);
                }
                if (err.code === "ENOENT" || /sandbox wrapper unusable/.test(err.message)) {
                    failed = [...failed, "bwrap", "rlimits", "policy-only"].slice(0, attempt + 1);
                    // Back off so repeated retries don't add to fork pressure.
                    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
                    continue;
                }
                return text;
            }
            return `Error: no usable sandbox layer on this host (tried: ${failed.join(" → ") || "default"}).`;
        })();
    },
};
