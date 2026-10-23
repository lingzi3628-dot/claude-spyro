import type { Tool } from "./types.js";

function fmt(t: {
  id: string;
  subject: string;
  status: string;
  owner?: string;
  description?: string;
  result?: string;
}): string {
  const bits = [`${t.id} [${t.status}] ${t.subject}`];
  if (t.owner) bits.push(`owner: ${t.owner}`);
  if (t.description) bits.push(`desc: ${t.description}`);
  if (t.result) bits.push(`result: ${t.result}`);
  return "- " + bits.join(" | ");
}

export const taskCreateTool: Tool = {
  name: "task_create",
  description:
    "Create a new task on the persistent task board. Unlike todo_write (a lightweight in-prompt " +
    "checklist), the task board survives context compaction and can be referenced by id later, " +
    "including by subagents.",
  parameters: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Short title of the task." },
      description: { type: "string", description: "Optional longer description." },
      owner: { type: "string", description: "Optional owner label (e.g. subagent name)." },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
        description: "Initial status. Default 'pending'.",
      },
    },
    required: ["subject"],
  },
  async execute(args, ctx) {
    if (!ctx.tasks) return "Error: task board is not available.";
    const task = ctx.tasks.create({
      subject: String(args.subject ?? ""),
      description: args.description !== undefined ? String(args.description) : undefined,
      owner: args.owner !== undefined ? String(args.owner) : undefined,
      status: args.status,
    });
    ctx.emit({ type: "tasks", tasks: ctx.tasks.list() });
    return `Created task ${task.id}: ${task.subject}`;
  },
};

export const taskListTool: Tool = {
  name: "task_list",
  description: "List all tasks on the task board with their ids, statuses, owners, and notes.",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!ctx.tasks) return "Error: task board is not available.";
    const tasks = ctx.tasks.list();
    if (!tasks.length) return "The task board is empty.";
    return tasks.map(fmt).join("\n");
  },
};

export const taskGetTool: Tool = {
  name: "task_get",
  description: "Get the full details of a single task by id.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "The task id." } },
    required: ["id"],
  },
  async execute(args, ctx) {
    if (!ctx.tasks) return "Error: task board is not available.";
    const t = ctx.tasks.get(String(args.id || ""));
    if (!t) return `Error: no task with id "${args.id}".`;
    return fmt(t);
  },
};

export const taskUpdateTool: Tool = {
  name: "task_update",
  description:
    "Update a task's status, subject, description, owner, or result/notes. Use this to mark progress " +
    "as you work (set status to in_progress / completed / failed).",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The task id." },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
        description: "New status.",
      },
      subject: { type: "string", description: "New subject." },
      description: { type: "string", description: "New description." },
      owner: { type: "string", description: "New owner." },
      result: { type: "string", description: "Notes or the outcome/result of the task." },
    },
    required: ["id"],
  },
  async execute(args, ctx) {
    if (!ctx.tasks) return "Error: task board is not available.";
    const patch: Record<string, any> = {};
    for (const k of ["status", "subject", "description", "owner", "result"]) {
      if (args[k] !== undefined) patch[k] = String(args[k]);
    }
    const t = ctx.tasks.update(String(args.id || ""), patch);
    if (!t) return `Error: no task with id "${args.id}".`;
    ctx.emit({ type: "tasks", tasks: ctx.tasks.list() });
    return `Updated ${t.id}: ${fmt(t)}`;
  },
};

export const taskStopTool: Tool = {
  name: "task_stop",
  description: "Stop/cancel a task by marking it cancelled. (Subagent work already launched is not force-killed.)",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "The task id." } },
    required: ["id"],
  },
  async execute(args, ctx) {
    if (!ctx.tasks) return "Error: task board is not available.";
    const t = ctx.tasks.stop(String(args.id || ""));
    if (!t) return `Error: no task with id "${args.id}".`;
    ctx.emit({ type: "tasks", tasks: ctx.tasks.list() });
    return `Stopped ${t.id}.`;
  },
};

export const taskBoardTools: Tool[] = [
  taskCreateTool,
  taskListTool,
  taskGetTool,
  taskUpdateTool,
  taskStopTool,
];
