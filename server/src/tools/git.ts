import type { Tool } from "./types.js";
import { isRepo, gitStatus, gitDiff, gitLog } from "../infra/git.js";

const notRepo =
  "Error: this working directory is not a git repository. Run `git init` first (or open a folder that already is one).";

export const gitStatusTool: Tool = {
  name: "git_status",
  description:
    "Summarise the git working tree: current branch, staged/unstaged/untracked counts, ahead/behind " +
    "the upstream, and the changed file paths. Use this before reviewing or committing changes.",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const s = await gitStatus(ctx.cwd);
    if (!s) return notRepo;
    const lines = [
      `Branch: ${s.branch}`,
      `Staged: ${s.staged}  Unstaged: ${s.unstaged}  Untracked: ${s.untracked}`,
      `Ahead: ${s.ahead}  Behind: ${s.behind}`,
      "",
      "Changed files:",
      ...(s.files.length
        ? s.files.slice(0, 200).map((f) => `  ${f.status}  ${f.path}`)
        : ["  (clean working tree)"]),
    ];
    return lines.join("\n");
  },
};

export const gitDiffTool: Tool = {
  name: "git_diff",
  description:
    "Show the current diff. By default shows unstaged working-tree changes; pass staged=true to see " +
    "what is about to be committed. Optionally limit to a single path. Use this to review your own " +
    "changes before committing or before telling the user what you did.",
  parameters: {
    type: "object",
    properties: {
      staged: { type: "boolean", description: "Show staged changes instead of unstaged." },
      path: { type: "string", description: "Limit the diff to this file or directory." },
    },
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const staged = args.staged === true;
    const path = args.path ? String(args.path) : undefined;
    const out = await gitDiff(ctx.cwd, staged, 2000, path);
    return out.trim() || "(no diff)";
  },
};

export const gitLogTool: Tool = {
  name: "git_log",
  description: "Show recent commits as one-line summaries (hash, subject, author, date).",
  parameters: {
    type: "object",
    properties: {
      count: { type: "number", description: "How many commits to show. Default 20." },
    },
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const out = await gitLog(ctx.cwd, Number(args.count) || 20);
    return out || "(no commits yet)";
  },
};