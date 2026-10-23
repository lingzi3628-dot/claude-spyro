import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeResolve, isProtected } from "./types.js";
import { emitDiff } from "./diffutil.js";
export const writeTool = {
    name: "write_file",
    description: "Write content to a file, creating parent directories as needed. Overwrites the file if it exists.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File path (absolute or relative to cwd)." },
            content: { type: "string", description: "The full file content to write." },
        },
        required: ["path", "content"],
    },
    requiresApproval: true,
    async execute(args, ctx) {
        const abs = safeResolve(ctx.cwd, String(args.path));
        if (isProtected(ctx, abs)) {
            return `Error: ${args.path} is inside Spyro Studio's own source and cannot be modified. Change to a different working folder first.`;
        }
        ctx.markEdit?.(abs);
        const content = String(args.content ?? "");
        let before = "";
        try {
            before = await readFile(abs, "utf8");
        }
        catch {
            // new file
        }
        try {
            await mkdir(dirname(abs), { recursive: true });
            await writeFile(abs, content, "utf8");
            emitDiff(ctx, String(args.path), before, content);
            return `Wrote ${args.path} (${content.length} bytes).`;
        }
        catch (err) {
            return `Error writing ${args.path}: ${err.message}`;
        }
    },
};
