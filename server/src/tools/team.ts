import type { Tool } from "./types.js";

/** Post a finding to the team board so other members can use it. */
export const boardPostTool: Tool = {
  name: "board_post",
  description:
    "Post a finding, question, or blocker to the shared team board. Other agents running in the same " +
    "team can read it. Use short topics so others can filter by topic.",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Short label, e.g. 'api', 'schema', 'blocker'." },
      body: { type: "string", description: "The finding or question." },
    },
    required: ["body"],
  },
  async execute(args, ctx) {
    if (!ctx.board) return "Error: you are not running as part of a team.";
    const author = ctx.memberName || "agent";
    const body = String(args.body || "").trim();
    if (!body) return "Error: body is required.";
    ctx.board.post(author, String(args.topic || "note"), body);
    return `Posted to the board under [${args.topic || "note"}].`;
  },
};

/** Read what the rest of the team has posted. */
export const boardReadTool: Tool = {
  name: "board_read",
  description:
    "Read the shared team board to see what the other agents have found. Optionally filter by topic.",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Only show entries with this topic." },
    },
  },
  async execute(args, ctx) {
    if (!ctx.board) return "Error: you are not running as part of a team.";
    const me = ctx.memberName || "agent";
    if (args.topic) {
      const items = ctx.board.read({ topic: String(args.topic) }) as any[];
      const mine = items.filter((e) => e.author !== me);
      return mine.length ? mine.map((e) => `[${e.topic}] ${e.author}: ${e.body}`).join("\n") : "(nothing on this topic yet)";
    }
    return ctx.board.render(me);
  },
};

export const teamTool: Tool = {
  name: "team",
  description:
    "Run a team of specialized agents in PARALLEL against one shared goal. Each member gets its own " +
    "isolated context and a role, and they coordinate by posting findings to a shared board that " +
    "others read. Use this for work that splits into independent fronts (e.g. 'audit the codebase for " +
    "security and performance'). Returns each member's result plus a board digest.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "The shared goal every member works toward." },
      roles: {
        type: "array",
        description: "2-6 roles to run in parallel. Each is an independent focus area.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short name for this member (e.g. 'security')." },
            focus: { type: "string", description: "What this member should investigate or build." },
          },
          required: ["name", "focus"],
        },
      },
      concurrency: {
        type: "number",
        description: "Max members to run at once (default: all of them).",
      },
      max_steps: { type: "number", description: "Max steps per member (default 25)." },
    },
    required: ["task", "roles"],
  },
  async execute(args, ctx) {
    if (!ctx.runTeam) return "Error: teams are not available in this context.";
    const task = String(args.task || "").trim();
    if (!task) return "Error: task is required.";
    const roles = Array.isArray(args.roles)
      ? args.roles.map((r: any) => ({ name: String(r.name || ""), focus: String(r.focus || "") }))
      : [];
    if (!roles.length) return "Error: at least one role is required.";
    return await ctx.runTeam({
      task,
      roles,
      maxSteps: Number(args.max_steps) || undefined,
      concurrency: Number(args.concurrency) || undefined,
    });
  },
};