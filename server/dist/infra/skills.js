import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
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
/** Load every skill (a folder with a SKILL.md, or a bare *.md file). */
export class SkillLoader {
    skills = new Map();
    /** Candidate directories to search for skills, in priority order. */
    dirs(cwd, extra = []) {
        return [
            join(cwd, ".claude", "skills"),
            join(homedir(), ".claude", "skills"),
            join(homedir(), ".claude-free", "skills"),
            ...extra,
        ];
    }
    async load(cwd, extra = []) {
        this.skills.clear();
        const seen = new Set();
        for (const dir of this.dirs(cwd, extra)) {
            if (!existsSync(dir))
                continue;
            let entries;
            try {
                entries = await readdir(dir);
            }
            catch {
                continue;
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
                let file = null;
                if (s.isDirectory()) {
                    const candidate = join(full, "SKILL.md");
                    if (existsSync(candidate))
                        file = candidate;
                }
                else if (entry.toLowerCase().endsWith(".md")) {
                    file = full;
                }
                if (!file)
                    continue;
                try {
                    const skill = await this.readSkill(file);
                    if (seen.has(skill.name))
                        continue;
                    seen.add(skill.name);
                    this.skills.set(skill.name, skill);
                }
                catch {
                    // ignore malformed skills
                }
            }
        }
        return this.list();
    }
    async readSkill(file) {
        const raw = await readFile(file, "utf8");
        const { meta, body } = parseFrontmatter(raw);
        const dir = file.replace(/\/[^/]+$/, "");
        const name = meta.name || basename(file).replace(/\.md$/i, "");
        const firstLine = (body.split(/\r?\n/).find((l) => l.trim()) || "").replace(/^#+\s*/, "");
        return {
            name,
            description: meta.description || firstLine || "No description.",
            path: file,
            body,
            dir,
        };
    }
    list() {
        return [...this.skills.values()];
    }
    get(name) {
        return this.skills.get(name);
    }
    /** Compact catalog for the system prompt. */
    catalog() {
        const all = this.list();
        if (!all.length)
            return "";
        return all.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    }
}
