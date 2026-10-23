import { DEFAULT_BASE_URLS } from "../config.js";
const PROBE_TIMEOUT_MS = 6000;
/**
 * Providers whose OpenAI-compatible endpoint is known not to implement
 * `/models`. Probing those returns 404 even though the provider is fine, so we
 * fall back to a tiny `/chat/completions` probe (which fails with 400/401 —
 * both meaning "reachable") instead of reporting them as down.
 */
const NO_MODELS_ENDPOINT = new Set(["gemini"]);
async function probeViaChat(id, baseUrl, latencyStart) {
    const base = baseUrl.replace(/\/$/, "");
    try {
        const res = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "probe",
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1,
            }),
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const latencyMs = Date.now() - latencyStart;
        // 400 (bad model) / 401 (no key) / 404 (no route) all mean the host
        // answered — i.e. the provider is reachable.
        if (res.status === 401 || res.status === 403 || res.status === 400) {
            return { id, baseUrl, health: "needs-key", latencyMs };
        }
        if (res.ok)
            return { id, baseUrl, health: "ok", latencyMs };
        return { id, baseUrl, health: "down", latencyMs, error: `HTTP ${res.status}` };
    }
    catch (err) {
        return {
            id,
            baseUrl,
            health: "down",
            latencyMs: Date.now() - latencyStart,
            error: shortError(err),
        };
    }
}
async function probe(id, baseUrl, apiKey) {
    const base = baseUrl.replace(/\/$/, "");
    const started = Date.now();
    const headers = {};
    if (apiKey)
        headers["Authorization"] = `Bearer ${apiKey}`;
    if (id === "openrouter") {
        headers["HTTP-Referer"] = "http://localhost";
        headers["X-Title"] = "Spyro Studio";
    }
    try {
        const res = await fetch(`${base}/models`, {
            headers,
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const latencyMs = Date.now() - started;
        if (res.status === 401 || res.status === 403) {
            return { id, baseUrl, health: "needs-key", latencyMs };
        }
        // Some gateways (e.g. Gemini's OpenAI-compat layer) have no /models route.
        if (!res.ok && NO_MODELS_ENDPOINT.has(id)) {
            return probeViaChat(id, base, started);
        }
        if (!res.ok) {
            return {
                id,
                baseUrl,
                health: "down",
                latencyMs,
                error: `HTTP ${res.status}`,
            };
        }
        // Try to read a model count; some gateways omit /models support entirely.
        let models;
        try {
            const data = await res.json();
            const arr = data?.data || data?.models;
            if (Array.isArray(arr))
                models = arr.length;
        }
        catch {
            // ignore
        }
        return { id, baseUrl, health: "ok", latencyMs, models };
    }
    catch (err) {
        return {
            id,
            baseUrl,
            health: "down",
            latencyMs: Date.now() - started,
            error: shortError(err),
        };
    }
}
function shortError(err) {
    const msg = err?.message || String(err);
    const cause = err?.cause?.code || err?.cause?.message;
    const text = cause ? `${msg} (${cause})` : msg;
    return text.slice(0, 120);
}
/** Probe every provider concurrently. Never throws. */
export async function checkProviders(ids, apiKeys = {}, baseUrls = DEFAULT_BASE_URLS) {
    const list = (ids && ids.length ? ids : Object.keys(baseUrls)).filter((id) => id !== "ollama" && id !== "openai-compatible");
    return Promise.all(list.map((id) => probe(id, baseUrls[id] || "", apiKeys[id])));
}
