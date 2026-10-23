import { DEFAULT_BASE_URLS } from "./config.js";

export interface RemoteModel {
  id: string;
  name?: string;
  context?: number;
  free?: boolean;
}

interface ListOpts {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  /** Request timeout in milliseconds (defaults: 15000, Ollama 8000). */
  timeoutMs?: number;
}

function deriveOllamaRoot(baseUrl?: string): string {
  const b = baseUrl || "http://localhost:11434/v1";
  try {
    const u = new URL(b);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:11434";
  }
}

/** Fetch the list of available models from the provider, normalized. */
export async function listModels(opts: ListOpts): Promise<RemoteModel[]> {
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

async function listOpenAICompat({ provider, baseUrl, apiKey, timeoutMs }: ListOpts): Promise<RemoteModel[]> {
  const base = (baseUrl || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");

  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "Spyro Studio";
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/models`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs ?? 15000),
  });
  if (!res.ok) throw new Error(`${provider} models HTTP ${res.status}`);
  const data = (await res.json()) as any;
  const arr: any[] = data.data || data.models || [];

  return arr
    .map((m) => {
      const id: string = m.id || m.name || "";
      const free =
        id.endsWith(":free") ||
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

async function listOllama({ baseUrl, timeoutMs }: ListOpts): Promise<RemoteModel[]> {
  const root = deriveOllamaRoot(baseUrl);
  const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(timeoutMs ?? 8000) });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as any;
  const arr: any[] = data.models || [];
  return arr.map((m) => ({
    id: m.name,
    name: m.name,
    context: m.details?.context_length || undefined,
    free: true,
  }));
}

async function listAnthropic({ baseUrl, apiKey, timeoutMs }: ListOpts): Promise<RemoteModel[]> {
  if (!apiKey) throw new Error("Anthropic requires an API key to list models.");
  const base = (baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(timeoutMs ?? 15000),
  });
  if (!res.ok) throw new Error(`anthropic models HTTP ${res.status}`);
  const data = (await res.json()) as any;
  const arr: any[] = data.data || [];
  return arr.map((m) => ({
    id: m.id,
    name: m.display_name || m.id,
    free: false,
  }));
}
