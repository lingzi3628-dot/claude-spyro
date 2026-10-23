export const todoTool = {
    name: "todo_write",
    description: "Create or replace the structured task list for the current job. Use this to break a complex, " +
        "multi-step task into an ordered plan, then work through it. Call it again to update statuses " +
        "(pending / in_progress / completed) as you progress. Mark exactly ONE task in_progress at a time.",
    parameters: {
        type: "object",
        properties: {
            todos: {
                type: "array",
                description: "The full ordered task list (replaces the previous one).",
                items: {
                    type: "object",
                    properties: {
                        content: { type: "string", description: "Short, specific description of the task." },
                        status: {
                            type: "string",
                            enum: ["pending", "in_progress", "completed"],
                            description: "Current status of the task.",
                        },
                    },
                    required: ["content", "status"],
                },
            },
        },
        required: ["todos"],
    },
    async execute(args, ctx) {
        const input = Array.isArray(args.todos) ? args.todos : [];
        const todos = ctx.todos.set(input);
        ctx.emit({ type: "todos", todos });
        const c = ctx.todos.counts();
        return `Task list updated. ${c.completed} completed, ${c.in_progress} in progress, ${c.pending} remaining.`;
    },
};
