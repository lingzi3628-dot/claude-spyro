import { useEffect, useRef, useState } from "react";

interface RemoteModel {
  id: string;
  name?: string;
  context?: number;
  free?: boolean;
}

/**
 * Sensible starting model per provider. OpenRouter alone lists hundreds of
 * models, so without a recommendation people just stare at the list.
 */
const RECOMMENDED: Record<string, string[]> = {
  openrouter: ["qwen/qwen3-coder:free", "z-ai/glm-4.5-air:free", "deepseek/deepseek-chat-v3-0324:free"],
  huggingface: ["meta-llama/Llama-3.1-8B-Instruct"],
  groq: ["llama-3.3-70b-versatile"],
  gemini: ["gemini-2.0-flash"],
  cerebras: ["llama-3.3-70b"],
  mistral: ["mistral-small-latest"],
  nvidia: ["nvidia/llama-3.1-nemotron-ultra-253b-v1"],
  together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  github: ["openai/gpt-4o-mini"],
  deepseek: ["deepseek-chat"],
  xai: ["grok-2-latest"],
  openai: ["gpt-4o-mini"],
  anthropic: ["claude-sonnet-4-5"],
  ollama: ["qwen2.5-coder", "llama3.2"],
  "openai-compatible": [],
};

const HINTS: Record<string, string> = {
  openrouter: "One key reaches 300+ models. Free ones are marked “free”.",
  huggingface: "Free credits on a free account.",
  groq: "Free tier, very fast inference.",
  gemini: "Generous free tier.",
  cerebras: "Free developer credits.",
  mistral: "Free tier on the smaller models.",
  nvidia: "Free credits for open models.",
  together: "Low cost, strong coding models.",
  github: "Works with GitHub Copilot subscriptions.",
};

export function ModelBrowser({
  value,
  onChange,
  provider,
  baseUrl,
  apiKey,
}: {
  value: string;
  onChange: (v: string) => void;
  provider: string;
  baseUrl: string;
  apiKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<RemoteModel[]>([]);
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(provider === "openrouter");
  const lastFetch = useRef("");

  const suggestion = RECOMMENDED[provider]?.[0] || "";
  const hint = HINTS[provider];

  const fetchModels = async (auto = false) => {
    setOpen(true);
    const sig = `${provider}|${baseUrl}|${apiKey ? "key" : ""}`;
    if (auto && lastFetch.current === sig) return;
    lastFetch.current = sig;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ provider, baseUrl, apiKey });
      const res = await fetch(`/api/models?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const list: RemoteModel[] = data.models || [];
      setModels(list);
      // Nothing chosen yet (or the current one isn't available) → use the
      // recommended model so the app is usable immediately.
      if (list.length) {
        const ids = new Set(list.map((m) => m.id));
        const want = suggestion && ids.has(suggestion)
          ? suggestion
          : (RECOMMENDED[provider] || []).find((r) => ids.has(r));
        if (want && (!value || !ids.has(value))) onChange(want);
      }
    } catch (err: any) {
      if (!auto) setError(err.message || "Failed to load models");
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  // Once a key is present, load the provider's models automatically so the
  // list is ready before the user asks for it.
  useEffect(() => {
    if (apiKey || provider === "ollama" || provider === "openai-compatible") {
      const t = setTimeout(() => fetchModels(true), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, baseUrl, apiKey]);

  useEffect(() => {
    setFreeOnly(provider === "openrouter");
    lastFetch.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const filtered = models.filter((m) => {
    if (freeOnly && !m.free) return false;
    const q = query.toLowerCase();
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q);
  });

  return (
    <div className="mb-wrap">
      <label>
        Model
        <button className="btn-browse" onClick={() => (open ? setOpen(false) : fetchModels(false))}>
          {open ? "Close" : loading ? "Loading…" : "Browse models"}
        </button>
      </label>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={suggestion || "model id, e.g. qwen/qwen3-coder:free"}
      />

      {!value && suggestion && (
        <div className="mb-hint">
          {hint ? hint + " " : ""}
          Suggested: <button className="mb-suggest" onClick={() => onChange(suggestion)}>{suggestion}</button>
        </div>
      )}

      {open && (
        <div className="model-panel">
          <div className="model-panel-controls">
            <input
              className="model-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={freeOnly}
                onChange={(e) => setFreeOnly(e.target.checked)}
              />
              <span>Free only</span>
            </label>
          </div>

          {loading && <div className="model-status">Loading models…</div>}
          {error && <div className="model-status model-error">{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="model-status">
              {models.length === 0
                ? "No models returned. Check the API key and base URL."
                : "No matches."}
            </div>
          )}

          <ul className="model-list">
            {filtered.map((m) => {
              const rec = RECOMMENDED[provider]?.includes(m.id);
              return (
                <li
                  key={m.id}
                  className={`model-item ${m.id === value ? "selected" : ""}`}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <span className="model-id">
                    {rec && <span className="rec-badge">recommended</span>}
                    {m.name || m.id}
                  </span>
                  <span className="model-meta">
                    {m.free && <span className="free-badge">free</span>}
                    {m.context && <span className="ctx-badge">{(m.context / 1000).toFixed(0)}k</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {open && !loading && models.length > 0 && (
        <div className="model-count">{filtered.length} of {models.length} models</div>
      )}
    </div>
  );
}
