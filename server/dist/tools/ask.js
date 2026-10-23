function normalizeOption(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const label = String(raw.label ?? "").trim();
    if (!label)
        return null;
    return { label, description: raw.description ? String(raw.description) : undefined };
}
function normalizeQuestions(raw) {
    const arr = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const q of arr) {
        if (!q || typeof q !== "object")
            continue;
        const question = String(q.question ?? "").trim();
        if (!question)
            continue;
        const header = q.header ? String(q.header).trim().slice(0, 24) : undefined;
        let options;
        if (Array.isArray(q.options)) {
            const opts = [];
            for (const o of q.options) {
                const no = normalizeOption(o);
                if (no)
                    opts.push(no);
            }
            if (opts.length)
                options = opts;
        }
        out.push({ question, header, options, multiple: q.multiple === true });
    }
    return out;
}
function formatAnswers(questions, answers) {
    if (!answers || !answers.length)
        return "User skipped the question.";
    return questions
        .map((q, i) => {
        const a = answers[i];
        const label = q.header || q.question.slice(0, 40);
        const text = a?.answers?.length ? a.answers.join(", ") : "(no answer)";
        return `${label}: ${text}`;
    })
        .join("\n");
}
export const askUserTool = {
    name: "ask_user",
    description: "Ask the user one or more clarifying questions and wait for their answer. Use when you need a " +
        "decision, preference, or missing detail before proceeding. Give 2-5 concrete options per question " +
        "so the user can click one (or type their own).",
    parameters: {
        type: "object",
        properties: {
            questions: {
                type: "array",
                description: "One or more questions to ask the user.",
                items: {
                    type: "object",
                    properties: {
                        question: { type: "string", description: "The question text." },
                        header: {
                            type: "string",
                            description: "Short label shown above the options (max ~12 characters).",
                        },
                        options: {
                            type: "array",
                            description: "2-5 clickable options.",
                            items: {
                                type: "object",
                                properties: {
                                    label: { type: "string" },
                                    description: { type: "string" },
                                },
                                required: ["label"],
                            },
                        },
                        multiple: {
                            type: "boolean",
                            description: "Allow selecting more than one option.",
                        },
                    },
                    required: ["question"],
                },
            },
        },
        required: ["questions"],
    },
    async execute(args, ctx) {
        if (!ctx.askUser)
            return "Error: asking questions is not available in this context.";
        const questions = normalizeQuestions(args?.questions);
        if (!questions.length)
            return "Error: at least one question is required.";
        const answers = await ctx.askUser({ questions });
        return formatAnswers(questions, answers || []);
    },
};
