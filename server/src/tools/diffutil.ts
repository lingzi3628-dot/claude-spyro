import { readFile } from "node:fs/promises";
import { unifiedDiff } from "../infra/diff.js";
import { safeResolve, type ToolContext } from "./types.js";

export interface SimulatedChange {
  path: string;
  before: string;
  after: string;
}

async function readMaybe(abs: string): Promise<string> {
  try {
    return await readFile(abs, "utf8");
  } catch {
    return "";
  }
}

/**
 * Best-effort prediction of the before/after content for a file-modifying tool
 * call, WITHOUT writing anything. Used for diff previews and approval dialogs.
 */
export async function simulateChange(
  name: string,
  args: Record<string, any>,
  cwd: string,
): Promise<SimulatedChange | null> {
  const rel = args.path !== undefined ? String(args.path) : "";
  if (!rel) return null;
  const abs = safeResolve(cwd, rel);

  if (name === "write_file") {
    const before = await readMaybe(abs);
    return { path: rel, before, after: String(args.content ?? "") };
  }

  if (name === "edit_file") {
    const before = await readMaybe(abs);
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    let after = before;
    if (oldStr && oldStr !== newStr && before.includes(oldStr)) {
      after = args.replace_all
        ? before.split(oldStr).join(newStr)
        : before.replace(oldStr, newStr);
    }
    return { path: rel, before, after };
  }

  if (name === "multi_edit") {
    const before = await readMaybe(abs);
    let after = before;
    const edits = Array.isArray(args.edits) ? args.edits : [];
    for (const e of edits) {
      const oldStr = String(e?.old_string ?? "");
      const newStr = String(e?.new_string ?? "");
      if (!oldStr || oldStr === newStr || !after.includes(oldStr)) continue;
      after = e?.replace_all ? after.split(oldStr).join(newStr) : after.replace(oldStr, newStr);
    }
    return { path: rel, before, after };
  }

  return null;
}

/** Emit a diff event for a file change (no-op if nothing changed). */
export function emitDiff(ctx: ToolContext, path: string, before: string, after: string): void {
  const { diff, stats, changed } = unifiedDiff(before, after, path);
  if (!changed) return;
  ctx.emit({ type: "diff", callId: ctx.callId, path, diff, stats });
}
