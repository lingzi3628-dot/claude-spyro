import type { Tool } from "./types.js";
import { isRepo, git } from "../infra/git.js";

const notRepo = "Error: not a git repository. Run `git init` first.";

export const gitBranchTool: Tool = {
  name: "git_branch",
  description:
    "List branches, create a new branch, switch branches, or delete a branch. " +
    "Use action='list' to see all branches, 'create' to make a new one, 'switch' to checkout, 'delete' to remove.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "create", "switch", "delete", "merge"], description: "What to do" },
      name: { type: "string", description: "Branch name (for create/switch/delete/merge)" },
      from: { type: "string", description: "Base branch for create (default: current)" },
    },
    required: ["action"],
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const action = String(args.action || "list");
    switch (action) {
      case "list": {
        const r = await git(ctx.cwd, ["branch", "-a", "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)"]);
        const lines = r.stdout.trim().split("\n").filter(Boolean).map((l) => {
          const [name, head, upstream] = l.split("\t");
          return `${head === "*" ? "● " : "  "}${name}${upstream ? ` → ${upstream}` : ""}`;
        });
        return lines.join("\n") || "(no branches)";
      }
      case "create": {
        if (!args.name) return "Error: name required";
        const base = args.from ? [args.from] : [];
        const r = await git(ctx.cwd, ["branch", args.name, ...base]);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return `Created branch '${args.name}'`;
      }
      case "switch": {
        if (!args.name) return "Error: name required";
        const r = await git(ctx.cwd, ["checkout", args.name]);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return `Switched to branch '${args.name}'`;
      }
      case "delete": {
        if (!args.name) return "Error: name required";
        const r = await git(ctx.cwd, ["branch", "-d", args.name]);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return `Deleted branch '${args.name}'`;
      }
      case "merge": {
        if (!args.name) return "Error: name required";
        const r = await git(ctx.cwd, ["merge", args.name]);
        if (r.code !== 0) {
          // Check for conflicts
          const status = await git(ctx.cwd, ["status", "--porcelain"]);
          const conflicts = status.stdout.split("\n").filter((l) => l.startsWith("UU") || l.startsWith("AA"));
          if (conflicts.length) {
            return `Merge conflict in ${conflicts.length} file(s):\n${conflicts.join("\n")}\n\nResolve conflicts and run git_commit.`;
          }
          return `Error: ${r.stderr.trim() || r.stdout.trim()}`;
        }
        return r.stdout.trim() || `Merged '${args.name}' successfully`;
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};

export const gitCommitTool: Tool = {
  name: "git_commit",
  description:
    "Stage files and create a commit. Pass files as an array of paths, or '.' for all. " +
    "Provide a commit message. Use staged=true to only commit already-staged files.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message" },
      files: { type: "array", items: { type: "string" }, description: "Files to stage (default: all changed)" },
      staged: { type: "boolean", description: "Only commit already-staged files (skip staging)" },
    },
    required: ["message"],
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const message = String(args.message || "").trim();
    if (!message) return "Error: commit message required";

    if (!args.staged) {
      const files = Array.isArray(args.files) && args.files.length ? args.files : ["."];
      const add = await git(ctx.cwd, ["add", ...files.map(String)]);
      if (add.code !== 0) return `Error staging: ${add.stderr.trim()}`;
    }

    const commit = await git(ctx.cwd, ["commit", "-m", message]);
    if (commit.code !== 0) return `Error: ${commit.stderr.trim() || commit.stdout.trim()}`;
    return commit.stdout.trim();
  },
};

export const gitStashTool: Tool = {
  name: "git_stash",
  description:
    "Stash or restore working tree changes. action='save' stashes, 'pop' restores, 'list' shows stashes, 'drop' removes.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["save", "pop", "list", "drop"], description: "What to do" },
      message: { type: "string", description: "Stash message (for save)" },
    },
    required: ["action"],
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const action = String(args.action || "list");
    switch (action) {
      case "save": {
        const r = await git(ctx.cwd, ["stash", "push", "-m", args.message || "WIP"]);
        return r.stdout.trim() || r.stderr.trim() || "Stashed";
      }
      case "pop": {
        const r = await git(ctx.cwd, ["stash", "pop"]);
        return r.stdout.trim() || r.stderr.trim() || "Popped";
      }
      case "list": {
        const r = await git(ctx.cwd, ["stash", "list"]);
        return r.stdout.trim() || "(no stashes)";
      }
      case "drop": {
        const r = await git(ctx.cwd, ["stash", "drop"]);
        return r.stdout.trim() || r.stderr.trim() || "Dropped";
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};

export const gitRemoteTool: Tool = {
  name: "git_remote",
  description:
    "Manage remotes: list, add, remove, or show remote URLs.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "add", "remove", "url"], description: "What to do" },
      name: { type: "string", description: "Remote name" },
      url: { type: "string", description: "Remote URL (for add)" },
    },
    required: ["action"],
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const action = String(args.action || "list");
    switch (action) {
      case "list": {
        const r = await git(ctx.cwd, ["remote", "-v"]);
        return r.stdout.trim() || "(no remotes)";
      }
      case "add": {
        if (!args.name || !args.url) return "Error: name and url required";
        const r = await git(ctx.cwd, ["remote", "add", args.name, args.url]);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return `Added remote '${args.name}'`;
      }
      case "remove": {
        if (!args.name) return "Error: name required";
        const r = await git(ctx.cwd, ["remote", "remove", args.name]);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return `Removed remote '${args.name}'`;
      }
      case "url": {
        if (!args.name) return "Error: name required";
        const r = await git(ctx.cwd, ["remote", "get-url", args.name]);
        return r.stdout.trim() || r.stderr.trim();
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};

export const gitPushTool: Tool = {
  name: "git_push",
  description: "Push commits to a remote. Optionally set upstream.",
  parameters: {
    type: "object",
    properties: {
      remote: { type: "string", description: "Remote name (default: origin)" },
      branch: { type: "string", description: "Branch to push (default: current)" },
      setUpstream: { type: "boolean", description: "Set upstream tracking" },
      force: { type: "boolean", description: "Force push" },
    },
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const remote = args.remote || "origin";
    const branch = args.branch || "";
    const cmd = ["push"];
    if (args.setUpstream) cmd.push("-u");
    if (args.force) cmd.push("--force");
    cmd.push(remote);
    if (branch) cmd.push(branch);
    const r = await git(ctx.cwd, cmd, 120_000);
    if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
    return r.stdout.trim() || r.stderr.trim() || "Pushed successfully";
  },
};

export const gitPullTool: Tool = {
  name: "git_pull",
  description: "Pull changes from a remote. Optionally specify remote and branch.",
  parameters: {
    type: "object",
    properties: {
      remote: { type: "string", description: "Remote name (default: origin)" },
      branch: { type: "string", description: "Branch to pull (default: current)" },
      rebase: { type: "boolean", description: "Rebase instead of merge" },
    },
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const remote = args.remote || "origin";
    const cmd = ["pull"];
    if (args.rebase) cmd.push("--rebase");
    cmd.push(remote);
    if (args.branch) cmd.push(args.branch);
    const r = await git(ctx.cwd, cmd, 120_000);
    if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
    return r.stdout.trim() || r.stderr.trim() || "Pulled successfully";
  },
};

export const gitWorktreeTool: Tool = {
  name: "git_worktree",
  description:
    "Manage git worktrees — extra working directories that share one repository. " +
    "Useful for working on several branches or letting parallel agents work in isolation. " +
    "Actions: list, add, remove, prune.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "add", "remove", "prune"], description: "What to do" },
      path: { type: "string", description: "Worktree directory (for add/remove)" },
      branch: { type: "string", description: "Branch to check out; created if it does not exist (for add)" },
      base: { type: "string", description: "Base revision when creating a new branch (for add)" },
      force: { type: "boolean", description: "Force removal even with local changes (for remove)" },
    },
    required: ["action"],
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const action = String(args.action || "list");
    switch (action) {
      case "list": {
        const r = await git(ctx.cwd, ["worktree", "list", "--porcelain"]);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        const entries = r.stdout.trim().split("\n\n").filter(Boolean).map((block) => {
          const fields: Record<string, string> = {};
          for (const line of block.split("\n")) {
            const i = line.indexOf(" ");
            if (i === -1) fields[line] = "true";
            else fields[line.slice(0, i)] = line.slice(i + 1);
          }
          const flags = [
            fields.bare ? "bare" : "",
            fields.detached ? "detached" : "",
            fields.locked ? "locked" : "",
          ].filter(Boolean).join(", ");
          return `  ${fields.worktree || "(unknown)"}  ${fields.branch || "(no branch)"}${flags ? `  [${flags}]` : ""}`;
        });
        return entries.length ? `Worktrees:\n${entries.join("\n")}` : "(no worktrees)";
      }
      case "add": {
        if (!args.path) return "Error: path required";
        const cmd = ["worktree", "add"];
        if (args.branch) cmd.push("-b", String(args.branch));
        cmd.push(String(args.path));
        if (args.base) cmd.push(String(args.base));
        const r = await git(ctx.cwd, cmd, 120_000);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return r.stdout.trim() || `Created worktree at ${args.path}`;
      }
      case "remove": {
        if (!args.path) return "Error: path required";
        const cmd = ["worktree", "remove"];
        if (args.force) cmd.push("--force");
        cmd.push(String(args.path));
        const r = await git(ctx.cwd, cmd);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return r.stdout.trim() || `Removed worktree ${args.path}`;
      }
      case "prune": {
        const r = await git(ctx.cwd, ["worktree", "prune", "-v"]);
        if (r.code !== 0) return `Error: ${r.stderr.trim()}`;
        return r.stdout.trim() || "Pruned stale worktree metadata.";
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};

export const gitConflictTool: Tool = {
  name: "git_conflicts",
  description:
    "Detect and help resolve merge conflicts. Lists conflicted files, shows conflict markers, " +
    "and can auto-resolve simple conflicts (ours/theirs) for a given file.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "show", "resolve"], description: "What to do" },
      file: { type: "string", description: "File path (for show/resolve)" },
      strategy: { type: "string", enum: ["ours", "theirs"], description: "Resolution strategy (for resolve)" },
    },
    required: ["action"],
  },
  async execute(args, ctx) {
    if (!isRepo(ctx.cwd)) return notRepo;
    const action = String(args.action || "list");
    switch (action) {
      case "list": {
        const r = await git(ctx.cwd, ["diff", "--name-only", "--diff-filter=U"]);
        const files = r.stdout.trim().split("\n").filter(Boolean);
        if (!files.length) return "No merge conflicts.";
        return `Conflicted files:\n${files.map((f) => `  • ${f}`).join("\n")}`;
      }
      case "show": {
        if (!args.file) return "Error: file required";
        const r = await git(ctx.cwd, ["diff", "--cc", "--", args.file]);
        return r.stdout.trim() || "(no conflict markers)";
      }
      case "resolve": {
        if (!args.file || !args.strategy) return "Error: file and strategy required";
        const flag = args.strategy === "ours" ? "--ours" : "--theirs";
        const checkout = await git(ctx.cwd, ["checkout", flag, "--", args.file]);
        if (checkout.code !== 0) return `Error: ${checkout.stderr.trim()}`;
        const add = await git(ctx.cwd, ["add", args.file]);
        if (add.code !== 0) return `Error: ${add.stderr.trim()}`;
        return `Resolved ${args.file} using ${args.strategy}`;
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};
