import fg from "fast-glob";
export const globTool = {
    name: "glob",
    description: "Find files by glob pattern (e.g. '**/*.ts', 'src/**/*.tsx'). Returns matching file paths sorted by modification time.",
    parameters: {
        type: "object",
        properties: {
            pattern: { type: "string", description: "Glob pattern to match files against." },
            path: { type: "string", description: "Directory to search in. Defaults to cwd." },
        },
        required: ["pattern"],
    },
    async execute(args, ctx) {
        const cwd = args.path ? String(args.path) : ctx.cwd;
        try {
            const files = await fg(String(args.pattern), {
                cwd,
                dot: false,
                onlyFiles: true,
                ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
                absolute: false,
            });
            if (!files.length)
                return "No files matched.";
            return files.slice(0, 500).join("\n");
        }
        catch (err) {
            return `Error: ${err.message}`;
        }
    },
};
