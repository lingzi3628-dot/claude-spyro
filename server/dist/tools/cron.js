export const cronCreateTool = {
    name: "cron_create",
    description: "Schedule a recurring prompt for yourself. The prompt will be submitted to you automatically on " +
        "the given schedule. Accepts a standard 5-field cron expression (minute hour day-of-month month " +
        "day-of-week) or intervals like 'every 30s', 'every 5m', 'every 2h', or '@hourly'/'@daily'/'@weekly'.",
    parameters: {
        type: "object",
        properties: {
            schedule: { type: "string", description: "Cron expression or interval (e.g. '*/15 * * * *' or 'every 10m')." },
            prompt: { type: "string", description: "The prompt to run on each tick." },
        },
        required: ["schedule", "prompt"],
    },
    async execute(args, ctx) {
        if (!ctx.crons)
            return "Error: the scheduler is not available.";
        const schedule = String(args.schedule || "").trim();
        const prompt = String(args.prompt || "").trim();
        if (!schedule || !prompt)
            return "Error: schedule and prompt are required.";
        const job = ctx.crons.create(schedule, prompt);
        if (!job)
            return `Error: could not parse schedule "${schedule}". Use 5-field cron or 'every Ns/Nm/Nh'.`;
        ctx.emit({ type: "crons", crons: ctx.crons.list() });
        return `Scheduled ${job.id}: "${prompt}" on '${schedule}'. Next run: ${new Date(job.nextRun).toLocaleString()}.`;
    },
};
export const cronListTool = {
    name: "cron_list",
    description: "List scheduled recurring prompts.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx) {
        if (!ctx.crons)
            return "Error: the scheduler is not available.";
        const jobs = ctx.crons.list();
        if (!jobs.length)
            return "No scheduled jobs.";
        return jobs
            .map((j) => `- ${j.id}: '${j.schedule}' -> "${j.prompt}" (runs: ${j.runCount}, next: ${new Date(j.nextRun).toLocaleString()})`)
            .join("\n");
    },
};
export const cronDeleteTool = {
    name: "cron_delete",
    description: "Delete a scheduled recurring prompt by id.",
    parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The cron job id." } },
        required: ["id"],
    },
    async execute(args, ctx) {
        if (!ctx.crons)
            return "Error: the scheduler is not available.";
        const ok = ctx.crons.delete(String(args.id || ""));
        ctx.emit({ type: "crons", crons: ctx.crons.list() });
        return ok ? `Deleted cron job ${args.id}.` : `Error: no cron job with id "${args.id}".`;
    },
};
export const cronTools = [cronCreateTool, cronListTool, cronDeleteTool];
