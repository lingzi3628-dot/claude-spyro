import { randomUUID } from "node:crypto";
/**
 * A persistent task board for the agent (distinct from todo_write, which is a
 * lightweight in-prompt checklist). Tasks survive context compaction and can be
 * polled/updated by the agent or subagents.
 */
export class TaskStore {
    tasks = new Map();
    create(input) {
        const id = `task_${randomUUID().slice(0, 8)}`;
        const now = Date.now();
        const task = {
            id,
            subject: String(input.subject ?? "").trim() || "(untitled)",
            description: input.description,
            status: input.status ?? "pending",
            owner: input.owner,
            createdAt: now,
            updatedAt: now,
        };
        this.tasks.set(id, task);
        return { ...task };
    }
    get(id) {
        const t = this.tasks.get(id);
        return t ? { ...t } : undefined;
    }
    list() {
        return [...this.tasks.values()].map((t) => ({ ...t }));
    }
    update(id, patch) {
        const t = this.tasks.get(id);
        if (!t)
            return undefined;
        if (patch.subject !== undefined)
            t.subject = patch.subject;
        if (patch.description !== undefined)
            t.description = patch.description;
        if (patch.status !== undefined)
            t.status = patch.status;
        if (patch.owner !== undefined)
            t.owner = patch.owner;
        if (patch.result !== undefined)
            t.result = patch.result;
        t.updatedAt = Date.now();
        return { ...t };
    }
    stop(id) {
        return this.update(id, { status: "cancelled" });
    }
    clear() {
        this.tasks.clear();
    }
    describe() {
        const t = this.list();
        if (!t.length)
            return "";
        const lines = t.map((x) => `- [${x.status}] ${x.id}: ${x.subject}`);
        return `Task board (${t.length}):\n${lines.join("\n")}`;
    }
}
