import { readdir } from "node:fs/promises";
import { safeResolve } from "./types.js";
export const lsTool = {
    name: "list_dir",
    description: "List files and directories at a path. Directories are suffixed with '/'.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Directory path. Defaults to cwd." },
        },
    },
    async execute(args, ctx) {
        const dir = safeResolve(ctx.cwd, String(args.path || "."));
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            return entries
                .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
                .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
                .join("\n");
        }
        catch (err) {
            return `Error: ${err.message}`;
        }
    },
};
