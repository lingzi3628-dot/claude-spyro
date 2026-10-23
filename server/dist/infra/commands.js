import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
function parseFrontmatter(raw) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    if (!match)
        return { meta: {}, body: raw };
    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx === -1)
            continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key)
            meta[key] = value;
    }
    return { meta, body: (match[2] || "").trim() };
}
function toPosix(p) {
    return p.split(sep).join("/");
}
function splitList(raw) {
    if (!raw)
        return undefined;
    const out = raw
        .split(/[,\n]/)
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    return out.length ? out : undefined;
}
/**
 * Load custom slash commands from `<cwd>/.claude/commands`, `~/.claude/commands`,
 * `~/.claude-free/commands`, plus plugin command dirs. Each `.md` file is a command;
 * subdirectories produce namespaced names (e.g. `frontend/component`).
 */
export class CommandLoader {
    commands = new Map();
    dirs(cwd, extra = []) {
        return [
            join(cwd, ".claude", "commands"),
            join(homedir(), ".claude", "commands"),
            join(homedir(), ".claude-free", "commands"),
            ...extra,
        ];
    }
    async load(cwd, extra = []) {
        this.commands.clear();
        const seen = new Set();
        for (const dir of this.dirs(cwd, extra)) {
            if (!existsSync(dir))
                continue;
            await this.loadDir(dir, dir, seen);
        }
        return this.list();
    }
    async loadDir(dir, root, seen) {
        let entries;
        try {
            entries = await readdir(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry);
            let s;
            try {
                s = await stat(full);
            }
            catch {
                continue;
            }
            if (s.isDirectory()) {
                await this.loadDir(full, root, seen);
                continue;
            }
            if (!entry.toLowerCase().endsWith(".md"))
                continue;
            try {
                const raw = await readFile(full, "utf8");
                const { meta, body } = parseFrontmatter(raw);
                const rel = relative(root, full).replace(/\.md$/i, "");
                if (!rel)
                    continue;
                const name = toPosix(rel);
                if (seen.has(name))
                    continue;
                seen.add(name);
                const description = meta.description || meta.desc || name;
                this.commands.set(name, {
                    name,
                    description,
                    argumentHint: meta["argument-hint"] || meta.argumentHint || undefined,
                    allowedTools: splitList(meta["allowed-tools"] || meta.allowedTools),
                    model: meta.model || undefined,
                    body: body.trim(),
                    path: full,
                });
            }
            catch {
                // ignore malformed command files
            }
        }
    }
    list() {
        return [...this.commands.values()];
    }
    get(name) {
        return this.commands.get(name);
    }
    /** Compact catalog for the system prompt. */
    catalog() {
        const all = this.list();
        if (!all.length)
            return "";
        return all.map((c) => `- /${c.name}: ${c.description}${c.argumentHint ? ` (args: ${c.argumentHint})` : ""}`).join("\n");
    }
    /**
     * Substitute arguments into a command body. Supports `$ARGUMENTS`, `$1`…`$9`,
     * and `${ARGUMENTS}`. Unknown positional placeholders become empty strings.
     */
    expand(name, args) {
        const cmd = this.commands.get(name);
        if (!cmd)
            return args;
        const tokens = args.split(/\s+/).filter(Boolean);
        let out = cmd.body.replace(/\$\{?ARGUMENTS\}?/g, () => args);
        out = out.replace(/\$(\d)/g, (_m, d) => {
            const i = Number(d) - 1;
            return i >= 0 && i < tokens.length ? tokens[i] : "";
        });
        return out;
    }
}
export { toPosix };
