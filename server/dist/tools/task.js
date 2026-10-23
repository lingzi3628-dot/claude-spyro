export const taskTool = {
    name: "task",
    description: "Launch a subagent to work on a complex, multi-step task autonomously. The subagent runs in an " +
        "isolated context and returns only its final answer, keeping your own context clean. Use this for " +
        "open-ended research/exploration or a self-contained chunk of work. Provide a thorough, specific " +
        "prompt (the subagent does NOT see your conversation). Optionally restrict its tools with allowed_tools.",
    parameters: {
        type: "object",
        properties: {
            description: { type: "string", description: "A short (3-5 word) description of the task." },
            prompt: {
                type: "string",
                description: "The complete task for the subagent, including all context it needs (it cannot see this conversation).",
            },
            allowed_tools: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of tool names the subagent may use (e.g. [\"read_file\",\"glob\",\"grep\"]). " +
                    "Defaults to a read/explore-focused set.",
            },
            max_steps: {
                type: "number",
                description: "Maximum number of agent steps for the subagent. Default 30.",
            },
            subagent_type: {
                type: "string",
                description: "Optional name of a user-defined subagent (from .claude/agents/*.md). Uses that agent's " +
                    "system instructions and tool list instead of the default subagent.",
            },
        },
        required: ["description", "prompt"],
    },
    async execute(args, ctx) {
        if (!ctx.runSubagent) {
            return "Error: subagents are not available in this context.";
        }
        const prompt = String(args.prompt || "").trim();
        if (!prompt)
            return "Error: prompt is required.";
        let allowed = Array.isArray(args.allowed_tools)
            ? args.allowed_tools.map((t) => String(t))
            : undefined;
        const maxSteps = Number(args.max_steps) || undefined;
        // A named subagent overrides the default system prompt and tool list.
        let systemPrompt;
        if (args.subagent_type) {
            const name = String(args.subagent_type).trim();
            const def = ctx.agents?.get(name);
            if (!def) {
                const names = ctx.agents?.list().map((a) => a.name) || [];
                return `Error: unknown subagent_type "${name}". Available: ${names.length ? names.join(", ") : "(none)"}.`;
            }
            systemPrompt = def.body;
            if (!allowed && def.tools?.length)
                allowed = def.tools.slice();
        }
        ctx.emit({ type: "subagent_start", description: String(args.description || "subagent") });
        try {
            const result = await ctx.runSubagent({
                description: String(args.description || "subagent"),
                prompt,
                allowedTools: allowed,
                maxSteps,
                systemPrompt,
            });
            ctx.emit({ type: "subagent_end", description: String(args.description || "subagent") });
            return result || "(subagent finished with no output)";
        }
        catch (err) {
            ctx.emit({ type: "subagent_end", description: String(args.description || "subagent") });
            return `Error running subagent: ${err?.message || String(err)}`;
        }
    },
};
