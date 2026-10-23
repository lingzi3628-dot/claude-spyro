import { DEFAULT_BASE_URLS } from "../config.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
export function createProvider(cfg, reasoningEffort = "auto") {
    if (cfg.provider === "anthropic") {
        if (!cfg.apiKey)
            throw new Error("Anthropic requires an API key.");
        return new AnthropicProvider({
            model: cfg.model,
            baseUrl: cfg.baseUrl || "https://api.anthropic.com/v1",
            apiKey: cfg.apiKey,
        });
    }
    // Every other provider speaks the OpenAI chat-completions protocol, so we
    // only need to resolve the right base URL for the chosen provider id.
    const baseUrl = cfg.baseUrl ||
        DEFAULT_BASE_URLS[cfg.provider] ||
        DEFAULT_BASE_URLS["openai-compatible"] ||
        "http://localhost:8000/v1";
    return new OpenAICompatibleProvider({
        name: cfg.provider,
        model: cfg.model,
        reasoningEffort,
        baseUrl,
        apiKey: cfg.apiKey,
        headers: cfg.headers,
    });
}
export { OpenAICompatibleProvider, AnthropicProvider };
