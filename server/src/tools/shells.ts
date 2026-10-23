import type { Tool } from "./types.js";

export const bashOutputTool: Tool = {
  name: "bash_output",
  description:
    "Read the output of a background shell started with bash (run_in_background=true). Returns only " +
    "the new output produced since the last read unless you pass since_offset. Use this to poll long " +
    "builds/servers/installers.",
  parameters: {
    type: "object",
    properties: {
      shell_id: { type: "string", description: "The shell id returned by bash." },
      since_offset: {
        type: "number",
        description: "Byte offset to read from (optional; defaults to where you last read).",
      },
    },
    required: ["shell_id"],
  },
  async execute(args, ctx) {
    if (!ctx.shells) return "Error: background shells are not available.";
    const id = String(args.shell_id || "");
    const since = args.since_offset === undefined ? undefined : Number(args.since_offset);
    const res = ctx.shells.read(id, since);
    if (!res) return `Error: no shell with id "${id}".`;
    const status = res.done
      ? `[finished, exit code ${res.exitCode}]`
      : "[still running]";
    const header = `Shell ${id} ${status} (read offset ${res.readOffset}/${res.totalLength})`;
    return `${header}\n${res.output || "(no new output)"}`;
  },
};

export const killShellTool: Tool = {
  name: "kill_shell",
  description: "Terminate a background shell started with bash (run_in_background=true).",
  parameters: {
    type: "object",
    properties: {
      shell_id: { type: "string", description: "The shell id to kill." },
    },
    required: ["shell_id"],
  },
  async execute(args, ctx) {
    if (!ctx.shells) return "Error: background shells are not available.";
    const id = String(args.shell_id || "");
    const handle = ctx.shells.get?.(id);
    if (handle?.done) return `Shell ${id} already finished (exit code ${handle.exitCode}).`;
    const ok = ctx.shells.kill(id);
    return ok ? `Killed shell ${id}.` : `Error: no running shell with id "${id}".`;
  },
};
