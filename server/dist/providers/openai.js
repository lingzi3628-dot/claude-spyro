/**
 * OpenAI-compatible chat completions provider.
 * Works with: OpenRouter, Ollama, LM Studio, vLLM, OpenAI, Groq,
 * DeepSeek, Together, Fireworks, Cerebras, and any /v1 compatible server.
 */
/** Providers that accept `cache_control` prompt caching. */
const CACHE_CAPABLE = new Set(["anthropic", "openrouter"]);
/** How long to wait for the first byte of a completion. */
const CHAT_TIMEOUT_MS = 15 * 60 * 1000;
export class OpenAICompatibleProvider {
    reasoningEffort = "auto";
    name;
    model;
    baseUrl;
    apiKey;
    extraHeaders;
    constructor(opts) {
        this.name = opts.name;
        this.model = opts.model;
        this.reasoningEffort = opts.reasoningEffort ?? "auto";
        this.baseUrl = opts.baseUrl.replace(/\/$/, "");
        this.apiKey = opts.apiKey;
        this.extraHeaders = opts.headers;
    }
    /** Map our content (string or multimodal parts) into OpenAI's format. */
    toOpenAIContent(content) {
        if (content == null)
            return "";
        if (typeof content === "string")
            return content;
        if (!Array.isArray(content))
            return "";
        return content.map((p) => p.type === "text"
            ? { type: "text", text: p.text }
            : {
                type: "image_url",
                image_url: { url: `data:${p.media_type};base64,${p.data}` },
            });
    }
    toOpenAIMessages(messages) {
        return messages.map((m) => {
            if (m.role === "tool") {
                return {
                    role: "tool",
                    tool_call_id: m.tool_call_id,
                    content: typeof m.content === "string" ? m.content : "",
                };
            }
            if (m.role === "assistant" && m.tool_calls?.length) {
                return {
                    role: "assistant",
                    content: typeof m.content === "string" ? m.content : null,
                    tool_calls: m.tool_calls.map((tc) => ({
                        id: tc.id,
                        type: "function",
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments ?? {}),
                        },
                    })),
                };
            }
            return { role: m.role, content: this.toOpenAIContent(m.content) };
        });
    }
    toOpenAITools(tools) {
        return tools.map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
    }
    async *chat(messages, tools, signal) {
        const cacheable = CACHE_CAPABLE.has(this.name);
        const converted = this.toOpenAIMessages(messages);
        const msgs = [...converted];
        // Prompt caching: the system prompt and tool schemas are identical on every
        // turn, so they should be billed at the cache-read rate instead of re-sent
        // in full. Marking them lets Anthropic (and OpenRouter, which fronts it)
        // serve the prefix from cache — typically a 90% discount on the bulk of the
        // request. Older OpenAI-shaped endpoints reject the field, so it is opt-in
        // per provider.
        if (cacheable) {
            const sysIdx = msgs.findIndex((m) => m.role === "system");
            if (sysIdx >= 0) {
                const m = msgs[sysIdx];
                // Anthropic-style content blocks with a cache breakpoint.
                const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
                msgs[sysIdx] = { role: "system", content: [{ type: "text", text, cache_control: { type: "ephemeral" } }] };
            }
        }
        const body = {
            model: this.model,
            messages: msgs,
            stream: true,
        };
        if (tools.length) {
            body.tools = this.toOpenAITools(tools);
            body.tool_choice = "auto";
            if (cacheable && body.tools.length) {
                // Last tool is the cache breakpoint; everything before it is reused.
                body.tools[body.tools.length - 1].cache_control = { type: "ephemeral" };
            }
        }
        // Reasoning effort. OpenAI/OpenRouter use `reasoning_effort`; Anthropic's
        // OpenAI-compatible endpoint and DeepSeek use `thinking`. Send whichever
        // the endpoint understands and stay silent for models that support neither.
        const effort = this.reasoningEffort;
        if (effort && effort !== "auto" && !/^(ollama|openai-compatible)$/.test(this.name)) {
            const wantsReasoning = /^(openai|openrouter|deepseek|xai)$/.test(this.name);
            const wantsThinking = this.name === "anthropic";
            if (wantsReasoning) {
                body.reasoning_effort = effort === "medium" ? "medium" : effort;
            }
            else if (wantsThinking) {
                const budget = effort === "low" ? 2048 : effort === "high" ? 24576 : 8192;
                body.thinking = { type: "enabled", budget_tokens: budget };
            }
        }
        const headers = {
            "Content-Type": "application/json",
            ...(this.extraHeaders || {}),
        };
        if (this.apiKey)
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        if (this.name === "openrouter") {
            headers["HTTP-Referer"] = "http://localhost";
            headers["X-Title"] = "Spyro Studio";
        }
        // `timeoutMs` is our shim's own option (see infra/http.ts); the DOM
        // RequestInit type doesn't know about it.
        // Transient upstream failures are common: free and gateway tiers return
        // sporadic 5xx ("Failed to generate completions") and 429s under load.
        // Backing off and retrying turns a dead run into a slightly slower one.
        const ATTEMPTS = 3;
        let res = null;
        let lastText = "";
        let bodyConsumed = false;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal,
                // Generous first-byte budget. A cold local model can take minutes to
                // start generating once a large tool prompt is loaded; the old implicit
                // 5 s default cut that off and surfaced as a bare "request timed out".
                timeoutMs: CHAT_TIMEOUT_MS,
            });
            if (res.ok) {
                bodyConsumed = false;
                break;
            }
            // Read the failure body once, here. Reading it again in the error handler
            // below would hit an already-consumed stream and throw
            // "Invalid state: ReadableStream is locked".
            lastText = await res.text().catch(() => "");
            bodyConsumed = true;
            // 4xx other than 429 means the request itself is wrong; retrying is futile.
            const retryable = res.status === 429 || res.status >= 500;
            if (!retryable || attempt === ATTEMPTS)
                break;
            const wait = 700 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 350);
            await new Promise((r) => setTimeout(r, wait));
        }
        if (!res)
            throw new Error(`${this.name} gave no response.`);
        if (!res.ok || !res.body) {
            const text = bodyConsumed ? lastText : await res.text().catch(() => "");
            // Gateways often return an HTML error/login page instead of JSON.
            if (/^\s*<(?:!doctype|html)/i.test(text)) {
                throw new Error(res.status === 401 || res.status === 403
                    ? `${this.name} rejected the request (HTTP ${res.status}). Check the API key for ${this.name} in Settings.`
                    : `${this.name} returned an HTML page (HTTP ${res.status}) instead of an API response.`);
            }
            if (res.status === 429) {
                throw new Error(`${this.name} is rate-limiting this key (HTTP 429). Wait a moment, or switch to another provider in Settings.`);
            }
            if (res.status >= 500) {
                throw new Error(`${this.name} had a server error (HTTP ${res.status}) after ${ATTEMPTS} attempts — this is usually temporary. Retry, or switch model in Settings.\n${text.slice(0, 300)}`);
            }
            throw new Error(`${this.name} HTTP ${res.status}: ${text.slice(0, 500)}`);
        }
        // Some gateways (e.g. Hugging Face behind a bot check) answer 200 with an
        // HTML page instead of SSE. Peek at the first chunk so the user gets a
        // clear message instead of markup rendered as assistant text.
        const { first, stream } = await peekStream(res.body);
        if (/^\s*<(?:!doctype|html)/i.test(first)) {
            stream.cancel().catch(() => { });
            throw new Error(`${this.name} returned an HTML page instead of a streaming response. ` +
                `This usually means an API key is required — add one for ${this.name} in Settings.`);
        }
        const sseBody = first ? prependChunk(stream, first) : stream;
        const toolAcc = new Map();
        let sawText = false;
        let textBuf = "";
        let reasoningSeen = "";
        for await (const line of this.readSSE(sseBody)) {
            if (line === "[DONE]")
                break;
            let json;
            try {
                json = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (json.usage) {
                // Normalise Anthropic-style cache counters onto one shape so the UI
                // (and cost maths) can see what the cache saved.
                const u = json.usage;
                const cached = u.cache_read_input_tokens ??
                    u.prompt_cache_hit_tokens ??
                    u.cached_tokens ??
                    0;
                const written = u.cache_creation_input_tokens ?? 0;
                if (cached || written) {
                    u.cache_read_tokens = cached;
                    u.cache_write_tokens = written;
                }
                yield { type: "usage", usage: u };
            }
            const choice = json.choices?.[0];
            if (!choice)
                continue;
            const delta = choice.delta || {};
            // Reasoning models stream their thinking separately from the answer.
            // Different vendors name it differently; surface all of them.
            const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? null;
            if (typeof reasoning === "string" && reasoning) {
                // Providers disagree on whether reasoning arrives as a delta or as the
                // whole text-so-far resent on each chunk. Emitting the raw value made
                // the UI append it to what it already had, producing duplicated words
                // ("TheThe user is"). Emit a true delta either way.
                if (reasoningSeen.startsWith(reasoning)) {
                    // A snapshot older than what we already emitted.
                    continue;
                }
                const add = reasoning.startsWith(reasoningSeen) ? reasoning.slice(reasoningSeen.length) : reasoning;
                reasoningSeen = reasoningSeen + add;
                if (add)
                    yield { type: "reasoning", text: add };
            }
            if (delta.content) {
                sawText = true;
                textBuf += delta.content;
                yield { type: "text", text: delta.content };
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    const existing = toolAcc.get(idx) || { id: "", name: "", args: "" };
                    if (tc.id)
                        existing.id = tc.id;
                    if (tc.function?.name)
                        existing.name = tc.function.name;
                    if (tc.function?.arguments)
                        existing.args += tc.function.arguments;
                    toolAcc.set(idx, existing);
                }
            }
        }
        if (toolAcc.size) {
            const toolCalls = [...toolAcc.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([idx, t]) => ({
                id: t.id || `call_${idx}_${Date.now()}`,
                name: t.name,
                arguments: safeParse(t.args),
            }));
            yield { type: "tool_calls", toolCalls };
            return;
        }
        // Some local models emit the tool call as JSON in the text body instead of
        // a structured tool_calls delta. Recover it if the text is a clean call.
        if (tools.length && textBuf.trim()) {
            const synth = parseToolCallFromText(textBuf, tools.map((t) => t.name));
            if (synth) {
                yield { type: "tool_calls", toolCalls: [synth] };
                return;
            }
        }
        if (!sawText) {
            // Some local models return nothing; surface empty tool list so the loop ends.
            yield { type: "tool_calls", toolCalls: [] };
        }
    }
    async *readSSE(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n");
            buffer = parts.pop() || "";
            for (const raw of parts) {
                const line = raw.trim();
                if (!line.startsWith("data:"))
                    continue;
                yield line.slice(5).trim();
            }
        }
    }
}
function safeParse(s) {
    if (!s)
        return {};
    try {
        return JSON.parse(s);
    }
    catch {
        return {};
    }
}
/**
 * Recover a tool call that a local model wrote as plain JSON in its text.
 * Accepts {"name":..., "arguments":{...}} shapes and rejects malformed /
 * schema-like arguments so a weak model can't trigger a bogus tool call.
 */
function parseToolCallFromText(text, toolNames) {
    const t = (text || "").trim();
    if (!t.startsWith("{") || !t.endsWith("}"))
        return null;
    let obj;
    try {
        obj = JSON.parse(t);
    }
    catch {
        return null;
    }
    if (!obj || typeof obj.name !== "string")
        return null;
    if (toolNames.length && !toolNames.includes(obj.name))
        return null;
    let args = obj.arguments ?? obj.args ?? {};
    if (typeof args === "string") {
        try {
            args = JSON.parse(args);
        }
        catch {
            args = {};
        }
    }
    if (!args || typeof args !== "object" || Array.isArray(args))
        args = {};
    // Reject schema-like values such as { city: { type: "string", value: "Paris" } }.
    for (const v of Object.values(args)) {
        if (v && typeof v === "object" && !Array.isArray(v) && "type" in v && "value" in v) {
            return null;
        }
    }
    return { id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: obj.name, arguments: args };
}
/** Read the first chunk of a stream, returning it plus the remaining stream. */
async function peekStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
        const { done, value } = await reader.read();
        if (done)
            return { first: "", stream: body };
        const first = decoder.decode(value, { stream: true });
        const rest = new ReadableStream({
            start(c) {
                if (value)
                    c.enqueue(value);
                const pump = async () => {
                    try {
                        while (true) {
                            const r = await reader.read();
                            if (r.done)
                                break;
                            c.enqueue(r.value);
                        }
                        c.close();
                    }
                    catch (e) {
                        c.error(e);
                    }
                };
                void pump();
            },
            cancel(reason) {
                return reader.cancel(reason);
            },
        });
        return { first, stream: rest };
    }
    catch {
        return { first: "", stream: body };
    }
}
/** Re-attach a previously read chunk to the front of a stream. */
function prependChunk(stream, firstText) {
    return new ReadableStream({
        start(c) {
            c.enqueue(new TextEncoder().encode(firstText));
            const reader = stream.getReader();
            const pump = async () => {
                try {
                    while (true) {
                        const r = await reader.read();
                        if (r.done)
                            break;
                        c.enqueue(r.value);
                    }
                    c.close();
                }
                catch (e) {
                    c.error(e);
                }
            };
            void pump();
        },
        cancel(reason) {
            return stream.cancel(reason);
        },
    });
}
