import { DEFAULT_BASE_URLS } from "./config.js";
function deriveOllamaRoot(baseUrl) {
    const b = baseUrl || "http://localhost:11434/v1";
    try {
        const u = new URL(b);
        return `${u.protocol}//${u.host}`;
    }
    catch {
        return "http://localhost:11434";
    }
}
/** Fetch the list of available models from the provider, normalized. */
export async function listModels(opts) {
    const { provider } = opts;
    if (provider === "ollama") {
        return listOllama(opts);
    }
    if (provider === "anthropic") {
        return listAnthropic(opts);
    }
    // openrouter / openai / openai-compatible → OpenAI /models convention
    return listOpenAICompat(opts);
}
async function listOpenAICompat({ provider, baseUrl, apiKey, timeoutMs }) {
    const base = (baseUrl || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
    const headers = {};
    if (apiKey)
        headers["Authorization"] = `Bearer ${apiKey}`;
    if (provider === "openrouter") {
        headers["HTTP-Referer"] = "http://localhost";
        headers["X-Title"] = "Spyro Studio";
    }
    const res = await fetch(`${base.replace(/\/$/, "")}/models`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs ?? 15000),
    });
    if (!res.ok)
        throw new Error(`${provider} models HTTP ${res.status}`);
    const data = (await res.json());
    const arr = data.data || data.models || [];
    return arr
        .map((m) => {
        const id = m.id || m.name || "";
        const free = id.endsWith(":free") ||
            m.pricing?.prompt === "0" ||
            m.pricing?.prompt === 0 ||
            m.free === true;
        return {
            id,
            name: m.name || id,
            context: m.context_length || m.context || undefined,
            free,
        };
    })
        .filter((m) => m.id);
}
async function listOllama({ baseUrl, timeoutMs }) {
    const root = deriveOllamaRoot(baseUrl);
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(timeoutMs ?? 8000) });
    if (!res.ok)
        throw new Error(`Ollama HTTP ${res.status}`);
    const data = (await res.json());
    const arr = data.models || [];
    return arr.map((m) => ({
        id: m.name,
        name: m.name,
        context: m.details?.context_length || undefined,
        free: true,
    }));
}
async function listAnthropic({ baseUrl, apiKey, timeoutMs }) {
    if (!apiKey)
        throw new Error("Anthropic requires an API key to list models.");
    const base = (baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/models`, {
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(timeoutMs ?? 15000),
    });
    if (!res.ok)
        throw new Error(`anthropic models HTTP ${res.status}`);
    const data = (await res.json());
    const arr = data.data || [];
    return arr.map((m) => ({
        id: m.id,
        name: m.display_name || m.id,
        free: false,
    }));
}
