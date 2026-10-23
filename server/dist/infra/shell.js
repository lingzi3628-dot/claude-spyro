import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
const IS_WIN = process.platform === "win32";
function which(bin) {
    // A caller may already include the extension (bash.exe, powershell.exe). Only
    // append PATHEXT when the name has none — otherwise `bash.exe` becomes
    // `bash.exe.EXE`, which never exists, and Git Bash is silently missed.
    const hasExt = IS_WIN && /\.[a-z]+$/i.test(bin);
    const exts = IS_WIN && !hasExt ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
    for (const dir of (process.env.PATH || "").split(delimiter)) {
        if (!dir)
            continue;
        for (const ext of exts) {
            const p = join(dir, bin + ext);
            try {
                if (existsSync(p))
                    return p;
            }
            catch {
                // ignore
            }
        }
    }
    return undefined;
}
let cached = null;
/** Resolve (and memoise) the shell to use for this platform. */
export function resolveShell() {
    if (cached)
        return cached;
    if (IS_WIN) {
        // Prefer a POSIX sh if Git Bash or WSL is available.
        for (const cand of ["bash.exe", "sh.exe"]) {
            const found = which(cand);
            if (found) {
                cached = {
                    kind: "bash",
                    command: found,
                    args: [],
                    wrap: (s) => ["-lc", s],
                };
                return cached;
            }
        }
        const ps = which("powershell") || which("pwsh");
        if (ps) {
            cached = {
                kind: "powershell",
                command: ps,
                args: [],
                wrap: (s) => ["-NoProfile", "-NonInteractive", "-Command", s],
            };
            return cached;
        }
        cached = {
            kind: "cmd",
            command: process.env.COMSPEC || "cmd.exe",
            args: [],
            wrap: (s) => ["/d", "/s", "/c", s],
        };
        return cached;
    }
    const posix = [
        { kind: "bash", cands: ["/bin/bash", "/usr/bin/bash"] },
        { kind: "zsh", cands: ["/bin/zsh", "/usr/bin/zsh"] },
        { kind: "sh", cands: ["/bin/sh", "/usr/bin/sh"] },
    ];
    for (const { kind, cands } of posix) {
        for (const c of cands) {
            try {
                if (existsSync(c)) {
                    cached = { kind, command: c, args: [], wrap: (s) => ["-lc", s] };
                    return cached;
                }
            }
            catch {
                // ignore
            }
        }
    }
    cached = { kind: "sh", command: "/bin/sh", args: [], wrap: (s) => ["-lc", s] };
    return cached;
}
export function isPosixShell() {
    const k = resolveShell().kind;
    return k === "bash" || k === "sh" || k === "zsh";
}
/** True when we can meaningfully talk about POSIX paths/shell syntax. */
export function isWindows() {
    return IS_WIN;
}
/**
 * Translate a few extremely common POSIX-isms so simple commands keep working
 * under PowerShell. This is deliberately minimal — it is a convenience shim,
 * not a full translation layer. Anything complex should use POSIX syntax.
 */
/**
 * `cd /some/dir npm run dev` is a very common slip — the model writes it, and
 * the shell answers "cd: too many arguments". Treat it as the obvious intent.
 */
export function chainBareCd(script) {
    const m = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s+(?!&&|\|\||;|&&)(.+)$/s.exec(script);
    if (!m)
        return script;
    return `cd ${m[1]} && ${m[2]}`;
}
export function adaptForShell(script) {
    if (isPosixShell())
        return chainBareCd(script);
    if (resolveShell().kind === "cmd")
        return script;
    script = chainBareCd(script);
    let s = script;
    // `&&` and `||` are fine in PowerShell. Convert `VAR=value cmd` prefixes.
    s = s.replace(/^(\w+)=(\S+)\s+/g, "$env:$1='$2'; ");
    // `ls -la` -> Get-ChildItem -Force, `cat` -> Get-Content, `rm` -> Remove-Item
    s = s.replace(/\bcat\s+([^\s|;&]+)/g, "Get-Content $1");
    s = s.replace(/\bls\s+-la\b/g, "Get-ChildItem -Force");
    return s;
}
/** Build the full argv to run `script` in the platform shell. */
export function shellArgv(script) {
    const spec = resolveShell();
    const body = adaptForShell(script);
    return { command: spec.command, args: spec.args.concat(spec.wrap(body)) };
}
/** Collect every descendant pid of `pid` by walking /proc (no external tools). */
function descendants(root) {
    const children = new Map();
    let entries = [];
    try {
        entries = readdirSync("/proc").filter((n) => /^\d+$/.test(n));
    }
    catch {
        return [];
    }
    for (const name of entries) {
        let ppid = 0;
        try {
            const stat = readFileSync(`/proc/${name}/stat`, "utf8");
            // comm can contain spaces/parens — ppid is the field after the last ')'.
            const tail = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
            ppid = Number(tail[1]);
        }
        catch {
            continue;
        }
        if (!Number.isFinite(ppid) || ppid <= 0)
            continue;
        const list = children.get(ppid);
        if (list)
            list.push(Number(name));
        else
            children.set(ppid, [Number(name)]);
    }
    const out = [];
    const stack = [...(children.get(root) || [])];
    const seen = new Set();
    while (stack.length) {
        const pid = stack.pop();
        if (seen.has(pid))
            continue;
        seen.add(pid);
        out.push(pid);
        for (const c of children.get(pid) || [])
            stack.push(c);
    }
    return out;
}
/**
 * Kill a process and its children in a way that works on every platform.
 *
 * A negative pid signals the whole process GROUP, but only works if the child
 * was spawned detached (i.e. it is a group leader). When that isn't the case
 * we walk /proc and signal each descendant directly — otherwise the shell's
 * children survive and accumulate until the host refuses to fork.
 */
export function killTree(pid, signal = "SIGTERM") {
    if (!pid)
        return;
    try {
        if (IS_WIN) {
            // taskkill kills the whole tree; POSIX signals don't reach children there.
            spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
            return;
        }
        let groupKilled = false;
        try {
            process.kill(-pid, signal);
            groupKilled = true;
        }
        catch {
            groupKilled = false;
        }
        if (!groupKilled) {
            try {
                process.kill(pid, signal);
            }
            catch {
                // already gone
            }
        }
        // Always sweep descendants: the group kill can miss processes that
        // called setsid/setpgid themselves.
        for (const child of descendants(pid)) {
            try {
                process.kill(child, signal);
            }
            catch {
                // already gone
            }
        }
    }
    catch {
        // ignore
    }
}
/** Human-readable name of the shell, for the UI. */
export function shellName() {
    return resolveShell().kind;
}
/** Spawn options helper so callers don't each reinvent env handling. */
export function shellSpawnOptions(cwd) {
    return { cwd, env: { ...process.env } };
}
