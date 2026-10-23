import { readFile, writeFile } from "node:fs/promises";
import { safeResolve, isProtected } from "./types.js";
import { emitDiff } from "./diffutil.js";
export const multiEditTool = {
    name: "multi_edit",
    description: "Apply multiple exact-string edits to a single file in one call, in order. Each edit has an " +
        "old_string/new_string pair; old_string must match exactly. Edits are applied sequentially and " +
        "refer to the file content after the previous edits. Fails atomically (writes nothing) if any " +
        "edit cannot be applied.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File path (absolute or relative to cwd)." },
            edits: {
                type: "array",
                description: "Ordered list of edits to apply.",
                items: {
                    type: "object",
                    properties: {
                        old_string: { type: "string", description: "Exact text to replace." },
                        new_string: { type: "string", description: "Replacement text." },
                        replace_all: {
                            type: "boolean",
                            description: "Replace all occurrences of old_string. Default false.",
                        },
                    },
                    required: ["old_string", "new_string"],
                },
            },
        },
        required: ["path", "edits"],
    },
    requiresApproval: true,
    async execute(args, ctx) {
        const abs = safeResolve(ctx.cwd, String(args.path));
        if (isProtected(ctx, abs)) {
            return `Error: ${args.path} is inside Spyro Studio's own source and cannot be modified.`;
        }
        ctx.markEdit?.(abs);
        const edits = Array.isArray(args.edits) ? args.edits : [];
        if (!edits.length)
            return "Error: no edits provided.";
        let content;
        try {
            content = await readFile(abs, "utf8");
        }
        catch (err) {
            return `Error reading ${args.path}: ${err.message}`;
        }
        const applied = edits.map((e) => ({
            old_string: String(e?.old_string ?? ""),
            new_string: String(e?.new_string ?? ""),
            replace_all: Boolean(e?.replace_all),
        }));
        // Validate all edits against a working copy first (atomic).
        let working = content;
        for (let i = 0; i < applied.length; i++) {
            const { old_string, new_string, replace_all } = applied[i];
            if (old_string === new_string) {
                return `Error: edit #${i + 1} has identical old_string and new_string.`;
            }
            const count = working.split(old_string).length - 1;
            if (count === 0) {
                return `Error: edit #${i + 1}: old_string not found in ${args.path}.`;
            }
            if (count > 1 && !replace_all) {
                return `Error: edit #${i + 1}: old_string appears ${count} times. Set replace_all or add context.`;
            }
            working = replace_all
                ? working.split(old_string).join(new_string)
                : working.replace(old_string, new_string);
        }
        try {
            await writeFile(abs, working, "utf8");
        }
        catch (err) {
            return `Error writing ${args.path}: ${err.message}`;
        }
        emitDiff(ctx, String(args.path), content, working);
        return `Applied ${applied.length} edit${applied.length > 1 ? "s" : ""} to ${args.path}.`;
    },
};
