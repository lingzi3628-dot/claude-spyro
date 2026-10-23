/** Session-scoped task list the agent maintains via the todo tool. */
export class TodoStore {
    todos = [];
    set(inputs) {
        this.todos = inputs.map((t, i) => ({
            id: String(i + 1),
            content: String(t.content),
            status: t.status,
        }));
        return this.snapshot();
    }
    clear() {
        this.todos = [];
    }
    snapshot() {
        return this.todos.map((t) => ({ ...t }));
    }
    counts() {
        const c = { pending: 0, in_progress: 0, completed: 0 };
        for (const t of this.todos)
            c[t.status]++;
        return c;
    }
    /** Compact text summary of current progress, for the system prompt. */
    describe() {
        if (!this.todos.length)
            return "";
        const lines = this.todos.map((t) => {
            const mark = t.status === "completed" ? "x" : t.status === "in_progress" ? ">" : " ";
            return `- [${mark}] ${t.content}`;
        });
        const c = this.counts();
        return `Current task list (${c.completed} done, ${c.in_progress} in progress, ${c.pending} remaining):\n${lines.join("\n")}`;
    }
}
