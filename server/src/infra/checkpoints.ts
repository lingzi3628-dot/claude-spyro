import { randomUUID } from "node:crypto";
import type { FileManifest } from "./snapshot.js";

export interface Checkpoint {
  id: string;
  sessionId: string;
  createdAt: number;
  label: string;
  messages: any[];
  summary: string;
  todos: any[];
  diffStats?: { added: number; removed: number };
  /** Snapshot of agent-touched files at this point (path -> blob hash or null). */
  files?: FileManifest;
  /** How many files this checkpoint tracks. */
  fileCount?: number;
}

const MAX_CHECKPOINTS = 50;

/** Stores conversation-level checkpoints so the user can rewind the agent. */
export class CheckpointStore {
  private checkpoints = new Map<string, Checkpoint[]>();

  private key(sessionId: string): string {
    return sessionId || "default";
  }

  create(sessionId: string, state: Omit<Checkpoint, "id" | "sessionId" | "createdAt">): Checkpoint {
    const cp: Checkpoint = {
      id: `cp_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      sessionId,
      createdAt: Date.now(),
      ...state,
    };
    const k = this.key(sessionId);
    const list = this.checkpoints.get(k) || [];
    list.push(cp);
    // keep only the newest MAX_CHECKPOINTS
    while (list.length > MAX_CHECKPOINTS) list.shift();
    this.checkpoints.set(k, list);
    return cp;
  }

  list(sessionId: string): Checkpoint[] {
    return [...(this.checkpoints.get(this.key(sessionId)) || [])].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(sessionId: string, id: string): Checkpoint | undefined {
    return this.list(sessionId).find((c) => c.id === id);
  }

  delete(sessionId: string, id: string): boolean {
    const k = this.key(sessionId);
    const list = this.checkpoints.get(k) || [];
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.checkpoints.set(k, list);
    return true;
  }
}
