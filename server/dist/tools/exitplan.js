export const exitPlanModeTool = {
    name: "exit_plan_mode",
    description: "Use this when you are in planning mode and have finished writing a plan. Presents the plan to " +
        "the user and asks for approval to start implementing. Do NOT use for trivial tasks; only when a " +
        "plan needs user sign-off.",
    parameters: {
        type: "object",
        properties: {
            plan: {
                type: "string",
                description: "The full plan in markdown: what you will do, in order.",
            },
        },
        required: ["plan"],
    },
    async execute(args, ctx) {
        const plan = String(args.plan || "").trim();
        if (!plan)
            return "Error: plan is required.";
        ctx.emit({ type: "plan_ready", plan });
        const approved = await ctx.approve({
            name: "exit_plan_mode",
            args: { plan },
            preview: plan,
        });
        return approved
            ? "User approved the plan. Proceed with implementation."
            : "User rejected the plan. Revise it and try again.";
    },
};
