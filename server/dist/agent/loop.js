import { resolvePermissionMode } from "../config.js";
import { toToolDefs, subsetRegistry } from "../tools/index.js";
import { CORE_TOOLS, makeToolSearch } from "../tools/toolsearch.js";
import { buildSystemPrompt } from "./prompt.js";
import { readAgentsMd, ensureAgentsMd } from "../tools/agents.js";
import { TodoStore } from "../todos.js";
import { TeamBoard } from "../infra/teams.js";
import { unifiedDiff } from "../infra/diff.js";
import { simulateChange } from "../tools/diffutil.js";
const SUBAGENT_BLOCKED = new Set(["task", "team", "exit_plan_mode", "ask_user"]);
export class Agent {
    provider;
    tools;
    opts;
    messages = [];
    todos = new TodoStore();
    summary = "";
    agentsMd = "";
    permissionMode = "default";
    /**
     * Lazily-loaded tool names. Only CORE_TOOLS are advertised until the model
     * asks for more via tool_search — that keeps the per-request schema small
     * enough for small local models to be usable.
     */
    activeTools = new Set(CORE_TOOLS);
    toolSearchTool = makeToolSearch(() => this.tools.all(), (names) => {
        const fresh = [];
        for (const n of names) {
            if (!this.activeTools.has(n) && this.tools.get(n)) {
                this.activeTools.add(n);
                fresh.push(n);
            }
        }
        return fresh;
    });
    /**
     * Fail loudly if a core tool name does not exist.
     *
     * A phantom entry is invisible by construction — the filter below just drops
     * it — which previously left the model unable to read or write files at all,
     * with no error anywhere.
     */
    assertCoreToolsExist() {
        const missing = CORE_TOOLS.filter((n) => !this.tools.get(n));
        if (missing.length) {
            console.error(`[agent] CORE_TOOLS names with no registered tool: ${missing.join(", ")}. ` +
                `The model will be told these exist and never see them.`);
        }
    }
    /** Always available: the core set plus the loader itself. */
    visibleTools() {
        this.assertCoreToolsExist();
        const out = [];
        for (const t of this.tools.all()) {
            if (this.activeTools.has(t.name) || CORE_TOOLS.includes(t.name))
                out.push(t);
        }
        out.push(this.toolSearchTool);
        return out;
    }
    planMode = false;
    /** Reasoning from the most recent assistant turn, surfaced in the UI. */
    lastReasoning = "";
    /**
     * Tools auto-approved by "accept edits" mode: file writes go through without
     * a prompt, while anything that executes (bash, git) still asks.
     */
    autoApproveTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
    /**
     * Whether a given tool skips the approval prompt in the current mode.
     * The mode is the single source of truth — deriving this from a global
     * `autoApprove` flag would let "accept edits" silently approve `bash`.
     */
    autoApprovesTool(name) {
        if (this.permissionMode === "bypass")
            return true;
        if (this.permissionMode === "acceptEdits")
            return this.autoApproveTools.has(name);
        return false;
    }
    setPermissionMode(mode) {
        this.permissionMode = mode;
        const { autoApprove, planMode } = resolvePermissionMode(mode);
        this.planMode = planMode;
        this.opts.autoApprove = autoApprove;
    }
    getPermissionMode() {
        return this.permissionMode;
    }
    /** Tools that remain available while plan mode is on (read-only). */
    static PLAN_MODE_ALLOWED = new Set([
        "read_file",
        "glob",
        "grep",
        "list_dir",
        "bash_output",
        "lsp",
        "notebook_read",
        "webfetch",
        "web_search",
        "task_list",
        "task_read",
        "skill",
        "exit_plan_mode",
    ]);
    setPlanMode(v) {
        this.planMode = v;
    }
    getPlanMode() {
        return this.planMode;
    }
    /** Whether the agent should execute in single-task phases. */
    shouldPhaseExecution() {
        const counts = this.todos.counts();
        return counts.in_progress > 0 && counts.pending > 0;
    }
    constructor(provider, tools, opts) {
        this.provider = provider;
        this.tools = tools;
        this.opts = opts;
    }
    exportState() {
        return {
            messages: this.messages.slice(),
            summary: this.summary,
            todos: this.todos.snapshot(),
        };
    }
    importState(state) {
        this.messages = (state.messages || []).slice();
        this.summary = state.summary || "";
        const inputs = (state.todos || []).map((t) => ({ content: t.content, status: t.status }));
        this.todos.set(inputs);
    }
    reset() {
        this.messages = [];
        this.todos.clear();
        this.summary = "";
    }
    setProvider(provider) {
        this.provider = provider;
    }
    async setCwd(cwd) {
        this.opts.cwd = cwd;
        // Load project context (AGENTS.md) on cwd change
        try {
            this.agentsMd = await ensureAgentsMd(cwd) || readAgentsMd(cwd) || "";
        }
        catch {
            this.agentsMd = "";
        }
    }
    setToolRegistry(registry) {
        this.tools = registry;
    }
    buildContext() {
        const prompt = buildSystemPrompt(this.opts.cwd, 
        // Only names the model can call this turn — listing unloaded tools just
        // invites it to call something it doesn't have.
        [...new Set([...this.visibleTools().map((t) => t.name), "tool_search"])], this.todos.describe(), {
            skills: this.opts.skills?.list().map((s) => `- ${s.name}: ${s.description}`).join("\n"),
            tasks: this.opts.tasks?.describe?.() || undefined,
            memory: this.opts.memory?.combine(),
            commands: this.opts.commands?.catalog?.() || undefined,
            agents: this.opts.agents?.catalog?.() || undefined,
            outputStyle: this.opts.getOutputStyle?.() || undefined,
            extraDirs: (this.opts.extraDirs || []).join("\n"),
            mcpResources: this.opts.mcp?.allResources?.()
                ?.map((r) => `- [${r.server}] ${r.name}: ${r.uri}`)
                .join("\n"),
            mcpPrompts: this.opts.mcp?.allPrompts?.()
                ?.map((p) => `- [${p.server}] ${p.name}${p.description ? `: ${p.description}` : ""}`)
                .join("\n"),
            agentsMd: this.agentsMd,
        });
        const withSummary = this.summary
            ? `${prompt}\n\n# Earlier conversation summary\n${this.summary}`
            : prompt;
        return [{ role: "system", content: withSummary }, ...this.messages];
    }
    buildCtx(events, callId) {
        return {
            cwd: this.opts.cwd,
            todos: this.todos,
            protectedDirs: this.opts.protectedDirs || [],
            approve: events.approve,
            emit: (e) => events.emit(e),
            callId,
            shells: this.opts.shells,
            tasks: this.opts.tasks,
            skills: this.opts.skills,
            mcp: this.opts.mcp,
            crons: this.opts.crons,
            notify: this.opts.notify,
            askUser: (req) => events.ask(req),
            agents: this.opts.agents,
            commands: this.opts.commands,
            markEdit: this.opts.markEdit,
            apiKeys: this.opts.apiKeys,
            board: this.opts.board,
            memberName: this.opts.memberName,
            runSubagent: (o) => this.runSubagent(o, events),
            runTeam: (o) => this.runTeam(o, events),
        };
    }
    /**
     * Run an isolated subagent with its own message history, then return its
     * final textual result. The subagent shares the provider but not the context.
     */
    async runSubagent(opts, events) {
        return this.runMember(opts, events);
    }
    /**
     * Run one team member: an isolated subagent that can post to and read from a
     * shared board so its teammates can pick up its findings.
     */
    async runMember(opts, events) {
        const names = opts.allowedTools?.length
            ? opts.allowedTools.filter((n) => this.tools.get(n) && !SUBAGENT_BLOCKED.has(n))
            : this.tools.names().filter((n) => !SUBAGENT_BLOCKED.has(n));
        if (!names.length)
            return "Error: no usable tools available for the subagent.";
        const registry = subsetRegistry(this.tools, names);
        const sub = new Agent(this.provider, registry, {
            cwd: this.opts.cwd,
            autoApprove: this.opts.autoApprove,
            maxSteps: opts.maxSteps ?? 30,
            compactChars: this.opts.compactChars,
            protectedDirs: this.opts.protectedDirs,
            // Subagents share resources but cannot spawn further subagents.
            shells: this.opts.shells,
            tasks: this.opts.tasks,
            skills: this.opts.skills,
            mcp: this.opts.mcp,
            crons: this.opts.crons,
            notify: this.opts.notify,
            agents: this.opts.agents,
            board: opts.board,
            memberName: opts.memberName,
        });
        const preamble = opts.systemPrompt
            ? opts.systemPrompt
            : `You are a subagent invoked by the main agent to handle one self-contained task. ` +
                `Complete it autonomously using your tools and then reply with a concise result. ` +
                `You cannot ask the user questions.`;
        const prompt = `${preamble}\n\n# Task: ${opts.description}\n\n${opts.prompt}`;
        let text = "";
        await sub.run(prompt, {
            onText: (d) => {
                text += d;
                events.emit({ type: "subagent_text", description: opts.description, text: d });
            },
            onToolStart: events.onToolStart,
            onToolEnd: events.onToolEnd,
            onUsage: events.onUsage,
            onError: events.onError,
            emit: events.emit,
            approve: events.approve,
            ask: events.ask,
        }, undefined);
        if (this.opts.hooks) {
            try {
                await this.opts.hooks.run("SubagentStop", undefined, {
                    cwd: this.opts.cwd,
                    description: opts.description,
                });
            }
            catch { }
        }
        return text.trim();
    }
    /**
     * Run a team of agents in parallel against one shared goal. Each member is an
     * isolated subagent with its own context and a role, and they coordinate by
     * posting to a shared board. Returns each member's result plus a board digest.
     */
    async runTeam(opts, events) {
        const roles = opts.roles.filter((r) => r && r.name && r.focus);
        if (!roles.length)
            return "Error: at least one role with a name and focus is required.";
        const board = new TeamBoard();
        const off = board.onPost((e) => {
            events.emit({
                type: "board_post",
                teamId: board.id,
                author: e.author,
                topic: e.topic,
                body: e.body,
            });
        });
        events.emit({ type: "team_start", teamId: board.id, roles: roles.map((r) => r.name) });
        // Run members with bounded concurrency.
        const limit = Math.max(1, Math.min(opts.concurrency || roles.length, roles.length));
        const queue = [...roles];
        const results = [];
        const worker = async () => {
            for (;;) {
                const role = queue.shift();
                if (!role)
                    return;
                events.emit({ type: "team_member_start", teamId: board.id, member: role.name });
                let output = "";
                try {
                    output = await this.runMember({
                        description: role.name,
                        prompt: `Team goal:\n${opts.task}\n\nYour role: ${role.name}\nYour focus: ${role.focus}\n\nWork on your part and post important findings to the board so other members can use them (board_post). Read the board first to see what others have found (board_read). When you are done, reply with a concise summary of your conclusions.`,
                        maxSteps: opts.maxSteps ?? 25,
                        board,
                        memberName: role.name,
                    }, events);
                }
                catch (err) {
                    output = `Error: ${err?.message || String(err)}`;
                }
                results.push({ name: role.name, output });
                events.emit({ type: "team_member_end", teamId: board.id, member: role.name });
            }
        };
        await Promise.all(Array.from({ length: limit }, worker));
        off();
        events.emit({ type: "team_end", teamId: board.id, results: results.map((r) => r.name) });
        const digest = board.render();
        const sections = results
            .map((r) => `## ${r.name}\n${r.output.trim() || "(no output)"}`)
            .join("\n\n");
        return `# Team results (board had ${board.size} post(s))\n\n${digest}\n\n---\n\n${sections}`;
    }
    /** Snapshot of how full the context is, for /context and status displays. */
    contextInfo() {
        const chars = JSON.stringify(this.messages).length;
        return {
            messages: this.messages.length,
            chars,
            budgetChars: this.contextBudget(),
            summaryChars: this.summary.length,
            compacted: this.summary.length > 0,
        };
    }
    /** Public: force a context compaction now (used by /compact). */
    async forceCompact() {
        const before = this.messages.length;
        await this.maybeCompact(true);
        return this.summary
            ? `Compacted ${before} messages. Summary is now ${this.summary.length} chars.`
            : "Nothing to compact yet.";
    }
    /**
     * Context budget for this model. A fixed 120k budget blows past an 8k model
     * and wastes money on a 1M one, so derive it from what we know about the
     * model, with a conservative default.
     */
    contextBudget() {
        if (this.opts.compactChars)
            return this.opts.compactChars;
        const m = (this.provider.model || "").toLowerCase();
        const window = () => {
            if (/gpt-4o|gpt-4\.1|gpt-5|o[134]/.test(m))
                return 128_000;
            if (/claude-3-5|claude-sonnet-4|claude-opus-4|claude-haiku/.test(m))
                return 200_000;
            if (/deepseek|llama-?3|nemotron|qwen|gemma|mistral|command-r/.test(m))
                return 32_000;
            if (/llama3|qwen2\.5/.test(m))
                return 8_000;
            return 32_000;
        };
        // Reserve room for the reply: compact at ~70% of the window.
        return Math.floor((window() * 0.7) / 4) * 4;
    }
    /**
     * Run read-only tool calls concurrently, bounded so we never spawn a stampede.
     * Results are keyed by tool-call id and consumed by the normal loop, so the
     * conversation history order is unchanged.
     */
    async runReadsConcurrently(calls, events) {
        const out = new Map();
        if (calls.length < 2)
            return out;
        const READONLY = new Set([
            "read_file", "list_dir", "glob", "grep", "read_pdf",
            "lsp_definition", "lsp_references", "lsp_hover", "lsp_diagnostics", "lsp_symbols",
        ]);
        if (this.planMode)
            return out; // plan mode changes behaviour; keep it serial
        const batch = calls.filter((c) => {
            const t = this.tools.get(c.name);
            return t && READONLY.has(c.name) && !t.requiresApproval;
        });
        if (batch.length < 2)
            return out;
        const LIMIT = 4;
        for (let i = 0; i < batch.length; i += LIMIT) {
            const slice = batch.slice(i, i + LIMIT);
            await Promise.all(slice.map(async (call) => {
                const tool = this.tools.get(call.name);
                try {
                    events.onToolStart(call);
                    const r = await tool.execute(call.arguments, this.opts);
                    events.onToolEnd(call, r);
                    out.set(call.id, r);
                }
                catch (err) {
                    out.set(call.id, `Error: ${err?.message || String(err)}`);
                }
            }));
        }
        return out;
    }
    async maybeCompact(force = false) {
        const budget = this.contextBudget();
        const chars = JSON.stringify(this.messages).length;
        const keep = 8;
        if (this.messages.length <= keep + 2)
            return;
        if (!force && chars <= budget)
            return;
        const old = this.messages.slice(0, -keep);
        const recent = this.messages.slice(-keep);
        if (!force && JSON.stringify(old).length < 4000)
            return;
        if (this.opts.hooks) {
            try {
                const h = await this.opts.hooks.run("PreCompact", undefined, {
                    cwd: this.opts.cwd,
                    message_count: this.messages.length,
                });
                if (h.blocked)
                    return;
            }
            catch { }
        }
        const s = await this.summarize(old);
        if (s) {
            this.summary = this.summary ? `${this.summary}\n\n${s}` : s;
            this.messages = recent;
        }
    }
    async summarize(msgs) {
        const transcript = msgs.map(formatMsg).join("\n");
        const sys = "You compress an AI coding agent's conversation into a terse, factual summary. " +
            "Preserve: the user's goal, key decisions, files created/changed, commands run and their outcomes, " +
            "errors and how they were resolved, and any unfinished next steps. Do not add commentary.";
        let out = "";
        try {
            for await (const chunk of this.provider.chat([
                { role: "system", content: sys },
                {
                    role: "user",
                    content: `Summarize this conversation:\n\n${truncate(transcript, 60_000)}`,
                },
            ], [])) {
                if (chunk.type === "text")
                    out += chunk.text;
            }
        }
        catch {
            return "";
        }
        return out.trim();
    }
    async run(userInput, events, signal, clientId) {
        const userText = typeof userInput === "string"
            ? userInput
            : userInput.filter((p) => p.type === "text").map((p) => p.text).join("\n");
        if (this.opts.hooks) {
            try {
                const h = await this.opts.hooks.run("UserPromptSubmit", undefined, {
                    prompt: userText,
                    cwd: this.opts.cwd,
                });
                if (h.blocked) {
                    events.onError(`Prompt blocked by UserPromptSubmit hook: ${h.reason || "blocked"}`);
                    return;
                }
            }
            catch { }
        }
        this.messages.push({ role: "user", content: userInput, client_id: clientId });
        await this.maybeCompact(false);
        const maxSteps = this.opts.maxSteps ?? 60;
        let contextRetried = false;
        for (let step = 0; step < maxSteps; step++) {
            const toolDefs = toToolDefs(this.visibleTools());
            const assistantContent = [];
            const reasoningContent = [];
            let toolCalls = [];
            try {
                for await (const chunk of this.provider.chat(this.buildContext(), toolDefs, signal)) {
                    if (chunk.type === "text") {
                        assistantContent.push(chunk.text);
                        events.onText(chunk.text);
                    }
                    else if (chunk.type === "reasoning") {
                        reasoningContent.push(chunk.text);
                        this.lastReasoning += chunk.text;
                        events.onReasoning?.(chunk.text);
                    }
                    else if (chunk.type === "tool_calls") {
                        toolCalls = chunk.toolCalls;
                    }
                    else if (chunk.type === "usage") {
                        events.onUsage(chunk.usage);
                    }
                }
            }
            catch (err) {
                if (err?.name === "AbortError")
                    return;
                const msg = err?.message || String(err);
                // Context overflow: shrink the history and try once more instead of
                // losing the whole turn. This is the single most common way a long
                // session dies, and it is recoverable.
                if (/context length|maximum context|too many tokens|prompt is too long|context_length_exceeded|reduce the length/i.test(msg)) {
                    await this.maybeCompact(true);
                    if (!contextRetried) {
                        contextRetried = true;
                        continue;
                    }
                }
                events.onError(msg);
                return;
            }
            const content = assistantContent.join("");
            const reasoning = reasoningContent.join("").trim();
            if (reasoning && !this.lastReasoning.startsWith(reasoning))
                this.lastReasoning = reasoning;
            this.messages.push({
                role: "assistant",
                content: content || null,
                tool_calls: toolCalls.length ? toolCalls : undefined,
            });
            if (!toolCalls.length) {
                if (this.opts.hooks) {
                    try {
                        await this.opts.hooks.run("Stop", undefined, { cwd: this.opts.cwd });
                    }
                    catch { }
                }
                return;
            }
            // Speculatively execute read-only calls concurrently. These touch no
            // shared state, need no approval, and produce results the model reads in
            // bulk — so five file reads no longer cost five sequential round trips.
            // Anything mutating (write/edit/bash/...) stays strictly sequential.
            const precomputed = await this.runReadsConcurrently(toolCalls, events);
            // Phase enforcement: if there's an in-progress task with pending tasks,
            // limit to one mutating tool call per turn to force step-by-step execution.
            const phaseMode = this.shouldPhaseExecution();
            let mutatingExecuted = false;
            for (const call of toolCalls) {
                const tool = this.tools.get(call.name);
                events.onToolStart(call);
                let result = precomputed.get(call.id);
                if (result !== undefined) {
                    events.onToolEnd(call, result);
                    this.messages.push({
                        role: "tool",
                        tool_call_id: call.id,
                        name: call.name,
                        content: result,
                    });
                    continue;
                }
                if (!tool) {
                    result = `Error: unknown tool "${call.name}".`;
                }
                else if (this.planMode && !Agent.PLAN_MODE_ALLOWED.has(call.name)) {
                    result =
                        "Blocked: you are in plan mode. Only read-only tools are allowed. " +
                            "Use exit_plan_mode to present your plan for approval.";
                }
                else {
                    // Phase enforcement: skip additional mutating tools if one already ran
                    const isReadOnly = Agent.PLAN_MODE_ALLOWED.has(call.name);
                    if (phaseMode && !isReadOnly && mutatingExecuted) {
                        result = "Blocked: completing current task first. Update todo status to continue.";
                        events.onToolEnd(call, result);
                        this.messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            name: call.name,
                            content: result,
                        });
                        continue;
                    }
                    let blocked = false;
                    if (this.opts.hooks) {
                        try {
                            const h = await this.opts.hooks.run("PreToolUse", call.name, {
                                tool_name: call.name,
                                tool_input: call.arguments,
                                cwd: this.opts.cwd,
                            });
                            if (h.blocked) {
                                result = `Blocked by PreToolUse hook: ${h.reason || "blocked"}`;
                                blocked = true;
                            }
                        }
                        catch { }
                    }
                    if (!blocked) {
                        const decision = this.opts.permissions?.check(call.name, call.arguments) ?? "default";
                        if (decision === "deny") {
                            result = "Blocked by permission rule.";
                        }
                        else {
                            const needsAsk = decision === "ask" ||
                                (decision === "default" &&
                                    tool.requiresApproval &&
                                    !this.autoApprovesTool(call.name));
                            let approved = true;
                            if (needsAsk) {
                                approved = await events.approve({
                                    name: call.name,
                                    args: call.arguments,
                                    preview: await previewOf(call, this.opts.cwd),
                                });
                            }
                            if (!approved) {
                                result = "User denied this action.";
                            }
                            else {
                                try {
                                    result = await tool.execute(call.arguments, this.buildCtx(events, call.id));
                                }
                                catch (err) {
                                    result = `Error: ${err?.message || String(err)}`;
                                }
                            }
                        }
                    }
                    if (!isReadOnly)
                        mutatingExecuted = true;
                    if (this.opts.hooks) {
                        try {
                            await this.opts.hooks.run("PostToolUse", call.name, {
                                tool_name: call.name,
                                tool_input: call.arguments,
                                tool_response: result,
                                cwd: this.opts.cwd,
                            });
                        }
                        catch { }
                    }
                }
                if (result === undefined)
                    result = "Error: tool produced no result.";
                events.onToolEnd(call, result);
                this.messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    name: call.name,
                    content: result,
                });
            }
            // Compact between steps if the context has grown large.
            await this.maybeCompact(false);
        }
        events.onError(`Reached maximum of ${maxSteps} steps without finishing.`);
        if (this.opts.hooks) {
            try {
                await this.opts.hooks.run("Stop", undefined, { cwd: this.opts.cwd });
            }
            catch { }
        }
    }
}
/** Flatten message content (string or multimodal parts) to plain text. */
function contentToText(content) {
    if (content == null)
        return "";
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((p) => (p.type === "text" ? p.text : `[image ${p.media_type}]`))
        .join("\n");
}
function formatMsg(m) {
    const text = contentToText(m.content);
    if (m.role === "system")
        return `[system] ${text}`;
    if (m.role === "user")
        return `[user] ${text}`;
    if (m.role === "tool")
        return `[tool:${m.name}] ${truncate(text, 800)}`;
    const calls = (m.tool_calls || [])
        .map((c) => `${c.name}(${JSON.stringify(c.arguments)})`)
        .join(", ");
    return `[assistant] ${text}${calls ? ` → ${calls}` : ""}`;
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + "…[truncated]" : s;
}
async function previewOf(call, cwd) {
    if (call.name === "bash")
        return String(call.arguments.command || "");
    if (call.name === "write_file" || call.name === "edit_file" || call.name === "multi_edit") {
        try {
            const sim = await simulateChange(call.name, call.arguments, cwd);
            if (sim) {
                const { diff, stats, changed } = unifiedDiff(sim.before, sim.after, sim.path);
                if (changed)
                    return `Edit ${sim.path} (+${stats.added} -${stats.removed})\n\n${diff}`;
                return `Edit ${sim.path} (no change)`;
            }
        }
        catch { }
        if (call.name === "write_file")
            return `Write ${call.arguments.path}`;
        return `Edit ${call.arguments.path}`;
    }
    if (call.name === "notebook_edit")
        return `Edit notebook ${call.arguments.path}`;
    if (call.name === "exit_plan_mode")
        return String(call.arguments.plan || "");
    return JSON.stringify(call.arguments, null, 2).slice(0, 400);
}
