import { join } from "node:path";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
export const multiModelTool = {
    name: "multi_model",
    description: "Multi-model orchestration: configure different models for different tasks. " +
        "Use fast models for simple edits, powerful models for complex reasoning. " +
        "Optimizes cost and speed.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["list", "set", "get", "recommend"],
                description: "What to do",
            },
            task: { type: "string", description: "Task type (coding, review, planning, simple, complex)" },
            model: { type: "string", description: "Model to assign (provider/model)" },
        },
        required: ["action"],
    },
    async execute(args, _ctx) {
        const cwd = _ctx.cwd;
        const action = String(args.action || "list");
        const configPath = join(cwd, ".spyro", "models.json");
        let config = {};
        if (existsSync(configPath)) {
            try {
                config = JSON.parse(readFileSync(configPath, "utf8"));
            }
            catch { }
        }
        const defaults = {
            coding: "openrouter/qwen-2.5-coder-32b",
            review: "openrouter/claude-3.5-sonnet",
            planning: "openrouter/claude-3.5-sonnet",
            simple: "openrouter/llama-3.1-8b",
            complex: "openrouter/claude-3.5-sonnet",
            fast: "openrouter/llama-3.1-8b",
            vision: "openrouter/llama-3.2-90b-vision",
        };
        switch (action) {
            case "list": {
                const lines = ["## Model Configuration", ""];
                for (const [task, model] of Object.entries({ ...defaults, ...config })) {
                    const active = config[task] ? " (custom)" : " (default)";
                    lines.push(`  ${task}: ${model}${active}`);
                }
                return lines.join("\n");
            }
            case "set": {
                if (!args.task || !args.model)
                    return "Error: task and model required";
                config[args.task] = args.model;
                mkdirSync(join(cwd, ".spyro"), { recursive: true });
                writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
                return `Set ${args.task} → ${args.model}`;
            }
            case "get": {
                if (!args.task)
                    return "Error: task required";
                const model = config[args.task] || defaults[args.task] || "default";
                return `${args.task}: ${model}`;
            }
            case "recommend": {
                const recs = [
                    "## Recommended Model Strategy",
                    "",
                    "**Fast/Cheap (simple tasks):**",
                    "  • llama-3.1-8b (OpenRouter) — free, fast",
                    "  • phi-3 (Ollama) — local, instant",
                    "",
                    "**Balanced (coding):**",
                    "  • qwen-2.5-coder-32b (OpenRouter) — strong coding",
                    "  • codellama (Ollama) — local coding",
                    "",
                    "**Powerful (complex reasoning):**",
                    "  • claude-3.5-sonnet (OpenRouter) — best overall",
                    "  • gpt-4o (OpenAI) — strong reasoning",
                    "",
                    "**Vision:**",
                    "  • llama-3.2-90b-vision (OpenRouter)",
                    "  • nemotron-3.5-super-vl (NVIDIA)",
                    "",
                    "Set with: multi_model(action='set', task='coding', model='openrouter/qwen-2.5-coder-32b')",
                ];
                return recs.join("\n");
            }
            default:
                return `Unknown action: ${action}`;
        }
    },
};
