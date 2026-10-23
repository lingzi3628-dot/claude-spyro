import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./types.js";
import { safeResolve, isProtected } from "./types.js";
import { emitDiff } from "./diffutil.js";

export const editTool: Tool = {
  name: "edit_file",
  description:
    "Replace an exact string in a file with a new string. The old_string must match exactly " +
    "(including whitespace/indentation) and must be unique in the file unless replace_all is true.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path (absolute or relative to cwd)." },
      old_string: { type: "string", description: "Exact text to replace." },
      new_string: { type: "string", description: "Replacement text (must differ from old_string)." },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences instead of requiring a unique match.",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
  requiresApproval: true,
  async execute(args, ctx) {
    const abs = safeResolve(ctx.cwd, String(args.path));
    if (isProtected(ctx, abs)) {
      return `Error: ${args.path} is inside Spyro Studio's own source and cannot be modified. Change to a different working folder first.`;
    }
    ctx.markEdit?.(abs);
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    if (oldStr === newStr) return "Error: old_string and new_string are identical.";

    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch (err: any) {
      return `Error reading ${args.path}: ${err.message}`;
    }

    const count = content.split(oldStr).length - 1;
    if (count === 0) return `Error: old_string not found in ${args.path}.`;
    if (count > 1 && !args.replace_all) {
      return `Error: old_string appears ${count} times in ${args.path}. Add more context or set replace_all.`;
    }

    const updated = args.replace_all
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr);

    try {
      await writeFile(abs, updated, "utf8");
    } catch (err: any) {
      return `Error writing ${args.path}: ${err.message}`;
    }
    emitDiff(ctx, String(args.path), content, updated);
    return `Edited ${args.path} (${count} replacement${count > 1 ? "s" : ""}).`;
  },
};
