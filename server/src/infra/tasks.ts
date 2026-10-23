import { randomUUID } from "node:crypto";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  subject: string;
  description?: string;
  status: TaskStatus;
  /** Optional free-form owner label (e.g. a subagent name). */
  owner?: string;
  /** Notes recorded as the task progresses. */
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskInput {
  subject: string;
  description?: string;
  status?: TaskStatus;
  owner?: string;
}

/**
 * A persistent task board for the agent (distinct from todo_write, which is a
 * lightweight in-prompt checklist). Tasks survive context compaction and can be
 * polled/updated by the agent or subagents.
 */
export class TaskStore {
  private tasks = new Map<string, Task>();

  create(input: TaskInput): Task {
    const id = `task_${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const task: Task = {
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

  get(id: string): Task | undefined {
    const t = this.tasks.get(id);
    return t ? { ...t } : undefined;
  }

  list(): Task[] {
    return [...this.tasks.values()].map((t) => ({ ...t }));
  }

  update(
    id: string,
    patch: Partial<Pick<Task, "subject" | "description" | "status" | "owner" | "result">>,
  ): Task | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    if (patch.subject !== undefined) t.subject = patch.subject;
    if (patch.description !== undefined) t.description = patch.description;
    if (patch.status !== undefined) t.status = patch.status;
    if (patch.owner !== undefined) t.owner = patch.owner;
    if (patch.result !== undefined) t.result = patch.result;
    t.updatedAt = Date.now();
    return { ...t };
  }

  stop(id: string): Task | undefined {
    return this.update(id, { status: "cancelled" });
  }

  clear(): void {
    this.tasks.clear();
  }

  describe(): string {
    const t = this.list();
    if (!t.length) return "";
    const lines = t.map((x) => `- [${x.status}] ${x.id}: ${x.subject}`);
    return `Task board (${t.length}):\n${lines.join("\n")}`;
  }
}
