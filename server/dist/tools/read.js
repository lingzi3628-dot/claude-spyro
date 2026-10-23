import { readFile } from "node:fs/promises";
import { safeResolve } from "./types.js";
export const readTool = {
    name: "read_file",
    description: "Read the contents of a file. Returns text with line numbers. Supports an optional line offset/limit for large files.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File path (absolute or relative to cwd)." },
            offset: { type: "number", description: "1-indexed line to start from." },
            limit: { type: "number", description: "Max number of lines to read." },
        },
        required: ["path"],
    },
    async execute(args, ctx) {
        const abs = safeResolve(ctx.cwd, String(args.path));
        let content;
        try {
            content = await readFile(abs, "utf8");
        }
        catch (err) {
            return `Error reading ${args.path}: ${err.message}`;
        }
        const lines = content.split("\n");
        const offset = Math.max(1, Number(args.offset) || 1);
        const limit = Number(args.limit) || 2000;
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        return slice
            .map((l, i) => `${String(offset + i).padStart(5)}: ${l}`)
            .join("\n");
    },
};
