import { randomUUID } from "node:crypto";
const MAX_CHECKPOINTS = 50;
/** Stores conversation-level checkpoints so the user can rewind the agent. */
export class CheckpointStore {
    checkpoints = new Map();
    key(sessionId) {
        return sessionId || "default";
    }
    create(sessionId, state) {
        const cp = {
            id: `cp_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
            sessionId,
            createdAt: Date.now(),
            ...state,
        };
        const k = this.key(sessionId);
        const list = this.checkpoints.get(k) || [];
        list.push(cp);
        // keep only the newest MAX_CHECKPOINTS
        while (list.length > MAX_CHECKPOINTS)
            list.shift();
        this.checkpoints.set(k, list);
        return cp;
    }
    list(sessionId) {
        return [...(this.checkpoints.get(this.key(sessionId)) || [])].sort((a, b) => b.createdAt - a.createdAt);
    }
    get(sessionId, id) {
        return this.list(sessionId).find((c) => c.id === id);
    }
    delete(sessionId, id) {
        const k = this.key(sessionId);
        const list = this.checkpoints.get(k) || [];
        const idx = list.findIndex((c) => c.id === id);
        if (idx === -1)
            return false;
        list.splice(idx, 1);
        this.checkpoints.set(k, list);
        return true;
    }
}
