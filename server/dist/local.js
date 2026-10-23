import { listModels } from "./models.js";
/**
 * Well-known local model servers we can auto-detect. All speak either the
 * Ollama API or an OpenAI-compatible /v1 API, so no API key is required.
 */
export const LOCAL_SERVERS = [
    {
        id: "ollama",
        label: "Ollama",
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1",
        hint: "Install from ollama.com, then run `ollama serve`.",
    },
    {
        id: "lmstudio",
        label: "LM Studio",
        provider: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        hint: "In LM Studio, start the Local Server (OpenAI-compatible).",
    },
    {
        id: "llamacpp",
        label: "llama.cpp",
        provider: "openai-compatible",
        baseUrl: "http://localhost:8080/v1",
        hint: "Run `llama-server -m model.gguf --port 8080`.",
    },
    {
        id: "vllm",
        label: "vLLM",
        provider: "openai-compatible",
        baseUrl: "http://localhost:8000/v1",
        hint: "Run `vllm serve <model>` (serves an OpenAI-compatible API).",
    },
    {
        id: "jan",
        label: "Jan",
        provider: "openai-compatible",
        baseUrl: "http://localhost:1337/v1",
        hint: "Enable the Jan local API server in Settings.",
    },
];
/** Probe every known local server in parallel and report which are reachable. */
export async function scanLocalServers(timeoutMs = 2500) {
    return Promise.all(LOCAL_SERVERS.map(async (s) => {
        try {
            const models = await listModels({
                provider: s.provider,
                baseUrl: s.baseUrl,
                timeoutMs,
            });
            return { ...s, reachable: models.length > 0, models };
        }
        catch (err) {
            return { ...s, reachable: false, models: [], error: err?.message || String(err) };
        }
    }));
}
