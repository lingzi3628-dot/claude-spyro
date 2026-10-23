import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
async function run(cmd, args) {
    try {
        const r = await exec(cmd, args, { timeout: 30_000 });
        return { stdout: r.stdout, stderr: r.stderr, code: 0 };
    }
    catch (e) {
        return { stdout: e.stdout || "", stderr: e.stderr || e.message, code: e.code || 1 };
    }
}
export const ollamaTool = {
    name: "ollama",
    description: "Manage local Ollama models: list installed, pull new models, check status, and run inference. " +
        "Ollama runs models locally — no API key needed, fully offline.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["status", "list", "pull", "remove", "run", "models"],
                description: "What to do",
            },
            model: { type: "string", description: "Model name (e.g. 'llama3.2', 'codellama', 'mistral')" },
            prompt: { type: "string", description: "Prompt for run action" },
        },
        required: ["action"],
    },
    async execute(args, _ctx) {
        const action = String(args.action || "status");
        switch (action) {
            case "status": {
                const r = await run("ollama", ["--version"]);
                if (r.code !== 0)
                    return "Ollama is not installed or not on PATH. Install from https://ollama.com";
                const ps = await run("ollama", ["ps"]);
                return `Ollama ${r.stdout.trim()}\n\nRunning models:\n${ps.stdout.trim() || "(none)"}`;
            }
            case "list": {
                const r = await run("ollama", ["list"]);
                if (r.code !== 0)
                    return `Error: ${r.stderr.trim()}`;
                return r.stdout.trim() || "(no models installed)";
            }
            case "models": {
                // Common coding models
                const models = [
                    "llama3.2 (3B) — fast, general purpose",
                    "llama3.1 (8B) — balanced",
                    "codellama (7B) — code-focused",
                    "deepseek-coder-v2 (16B) — strong coding",
                    "mistral (7B) — fast, good quality",
                    "qwen2.5-coder (7B) — code-focused, multilingual",
                    "phi3 (3.8B) — small, fast",
                    "gemma2 (9B) — Google, good quality",
                ];
                return `Recommended coding models:\n${models.map((m) => `  • ${m}`).join("\n")}\n\nPull one with: ollama(action="pull", model="llama3.2")`;
            }
            case "pull": {
                if (!args.model)
                    return "Error: model required";
                const r = await run("ollama", ["pull", args.model]);
                if (r.code !== 0)
                    return `Error: ${r.stderr.trim()}`;
                return r.stdout.trim() || `Pulled ${args.model}`;
            }
            case "remove": {
                if (!args.model)
                    return "Error: model required";
                const r = await run("ollama", ["rm", args.model]);
                if (r.code !== 0)
                    return `Error: ${r.stderr.trim()}`;
                return `Removed ${args.model}`;
            }
            case "run": {
                if (!args.model)
                    return "Error: model required";
                if (!args.prompt)
                    return "Error: prompt required";
                const r = await run("ollama", ["run", args.model, args.prompt]);
                if (r.code !== 0)
                    return `Error: ${r.stderr.trim()}`;
                return r.stdout.trim();
            }
            default:
                return `Unknown action: ${action}`;
        }
    },
};
