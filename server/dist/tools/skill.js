export const skillTool = {
    name: "skill",
    description: "Load a specialized skill by name and get its full instructions, then follow them. Skills are " +
        "reusable procedures defined in SKILL.md files (in .claude/skills). The available skills are " +
        "listed in your system prompt — only invoke a skill when the task clearly matches its description.",
    parameters: {
        type: "object",
        properties: {
            name: { type: "string", description: "The name of the skill to load." },
        },
        required: ["name"],
    },
    async execute(args, ctx) {
        if (!ctx.skills)
            return "Error: skills are not available.";
        const name = String(args.name || "").trim();
        const skill = ctx.skills.get(name);
        if (!skill) {
            const names = ctx.skills.list().map((s) => s.name);
            return `Error: unknown skill "${name}". Available skills: ${names.length ? names.join(", ") : "(none)"}.`;
        }
        return `# Skill: ${skill.name}\n\n${skill.body}\n\n(Skill files are in ${skill.dir}. Follow the instructions above.)`;
    },
};
export const notifyTool = {
    name: "notify",
    description: "Send a short notification to the user's interface. Use sparingly for important milestones, " +
        "questions, or when a long task finishes.",
    parameters: {
        type: "object",
        properties: {
            title: { type: "string", description: "Notification title." },
            body: { type: "string", description: "Optional longer message." },
            level: {
                type: "string",
                enum: ["info", "success", "warning", "error"],
                description: "Severity. Default 'info'.",
            },
        },
        required: ["title"],
    },
    async execute(args, ctx) {
        const title = String(args.title || "").trim();
        if (!title)
            return "Error: title is required.";
        const level = (["info", "success", "warning", "error"].includes(String(args.level))
            ? String(args.level)
            : "info");
        ctx.notify?.({ title, body: args.body !== undefined ? String(args.body) : undefined, level });
        return `Notified user: ${title}`;
    },
};
