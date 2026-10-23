import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, renameSync, } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
const MAX_SESSIONS = 200;
/** Persists agent conversations under ~/.claude-free/sessions/<id>.json. */
export class SessionStore {
    dir;
    constructor(dir = join(homedir(), ".claude-free", "sessions")) {
        this.dir = dir;
        try {
            if (!existsSync(this.dir))
                mkdirSync(this.dir, { recursive: true });
        }
        catch {
            // ignore
        }
    }
    pathFor(id) {
        return join(this.dir, `${id}.json`);
    }
    create(cwd) {
        const now = Date.now();
        const session = {
            id: `sess_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
            title: "New session",
            createdAt: now,
            updatedAt: now,
            cwd,
            messageCount: 0,
            messages: [],
            summary: "",
            todos: [],
            diffStats: { added: 0, removed: 0 },
        };
        this.save(session);
        return session;
    }
    save(session) {
        session.messageCount = session.messages.length;
        session.updatedAt = Date.now();
        // Don't persist a session until something was actually said in it —
        // otherwise every app launch leaves a stray empty session on disk.
        if (session.messages.length === 0)
            return;
        if (!session.title || session.title === "New session") {
            session.title = deriveTitle(session.messages) || "New session";
        }
        try {
            const tmp = this.pathFor(session.id) + ".tmp";
            writeFileSync(tmp, JSON.stringify(session), "utf8");
            renameSync(tmp, this.pathFor(session.id));
        }
        catch {
            // ignore write failures (read-only fs, etc.)
        }
        this.prune();
    }
    load(id) {
        const p = this.pathFor(id);
        if (!existsSync(p))
            return undefined;
        try {
            const data = JSON.parse(readFileSync(p, "utf8"));
            if (!data.id)
                return undefined;
            return {
                ...data,
                messages: data.messages || [],
                summary: data.summary || "",
                todos: data.todos || [],
            };
        }
        catch {
            return undefined;
        }
    }
    list() {
        if (!existsSync(this.dir))
            return [];
        const out = [];
        for (const name of readdirSync(this.dir)) {
            if (!name.endsWith(".json"))
                continue;
            const id = name.slice(0, -5);
            try {
                const data = JSON.parse(readFileSync(join(this.dir, name), "utf8"));
                out.push({
                    id: data.id || id,
                    title: data.title || "Untitled",
                    createdAt: data.createdAt || 0,
                    updatedAt: data.updatedAt || 0,
                    cwd: data.cwd || "",
                    messageCount: data.messageCount ?? (data.messages?.length || 0),
                    diffStats: data.diffStats || { added: 0, removed: 0 },
                });
            }
            catch {
                // skip corrupt files
            }
        }
        return out.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    delete(id) {
        const p = this.pathFor(id);
        if (!existsSync(p))
            return false;
        try {
            unlinkSync(p);
            return true;
        }
        catch {
            return false;
        }
    }
    /** Keep the newest MAX_SESSIONS; remove the oldest extras. */
    prune() {
        const all = this.list();
        if (all.length <= MAX_SESSIONS)
            return;
        for (const s of all.slice(MAX_SESSIONS))
            this.delete(s.id);
    }
}
function deriveTitle(messages) {
    const first = messages.find((m) => m.role === "user" && typeof m.content === "string");
    if (!first || typeof first.content !== "string")
        return "";
    const text = first.content.replace(/\s+/g, " ").trim();
    return text.length > 60 ? text.slice(0, 57) + "…" : text;
}
