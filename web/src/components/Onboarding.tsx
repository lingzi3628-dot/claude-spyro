import { useEffect, useMemo, useState } from "react";
import { DragonMark } from "./DragonMark";

interface ProviderInfo {
  label: string;
  keyUrl?: string;
  freeTier?: string;
}

/** Local options first — they need no key and no signup. */
const LOCAL: { id: string; label: string; hint: string; baseUrl?: string }[] = [
  {
    id: "ollama",
    label: "Ollama (local)",
    hint: "Runs on this machine. Free and offline. Install from ollama.com, then `ollama pull qwen2.5-coder`.",
  },
];

interface Props {
  providers: Record<string, string>;
  freeProviders: Record<string, ProviderInfo>;
  savedKeys: Record<string, string>;
  onSave: (cfg: { provider: string; model: string; baseUrl?: string; apiKey?: string }) => void;
  onSkip: () => void;
  initialProvider?: string;
  initialBaseUrl?: string;
  initialModel?: string;
}

const SUGGESTED_MODELS: Record<string, string> = {
  huggingface: "meta-llama/Llama-3.1-8B-Instruct",
  groq: "llama-3.3-70b-versatile",
  cerebras: "llama-3.3-70b",
  gemini: "gemini-2.0-flash",
  mistral: "mistral-small-latest",
  nvidia: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  together: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  github: "openai/gpt-4o-mini",
  openrouter: "qwen/qwen3-coder:free",
  deepseek: "deepseek-chat",
  xai: "grok-2-latest",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  ollama: "qwen2.5-coder",
};

const CLOUD_ORDER = [
  "openrouter",
  "huggingface",
  "groq",
  "gemini",
  "cerebras",
  "mistral",
  "nvidia",
  "together",
  "github",
  "anthropic",
  "openai",
  "deepseek",
  "xai",
];

export function Onboarding(props: Props) {
  const { providers, freeProviders, onSave, onSkip } = props;

  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<string>(props.initialProvider || "ollama");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(props.initialModel || "");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");

  const info = provider ? freeProviders?.[provider] : undefined;
  const needsKey = provider !== "ollama" && provider !== "openai-compatible";

  // Fetch the provider's model list once we have a key (or for local).
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    setLoadingModels(true);
    setModelError("");
    const base = providers?.[provider] || "";
    const url =
      `/api/models?provider=${encodeURIComponent(provider)}` +
      `&baseUrl=${encodeURIComponent(base)}` +
      (apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : "");
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const ids: string[] = (j.models || []).map((m: any) => m.id).filter(Boolean);
        setModels(ids);
        if (!model && ids.length) setModel(ids[0]);
      })
      .catch(() => {
        if (!cancelled) setModelError("Could not reach that provider. You can still type a model name.");
      })
      .finally(() => !cancelled && setLoadingModels(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, apiKey]);

  const cloudProviders = useMemo(
    () => CLOUD_ORDER.filter((id) => providers?.[id]),
    [providers],
  );

  const canFinish = !!provider && !!model && (!needsKey || apiKey.trim().length > 0);

  const finish = () => {
    const base = providers?.[provider];
    onSave({
      provider,
      model,
      baseUrl: base,
      apiKey: needsKey ? apiKey.trim() : "",
    });
  };

  const steps = ["Welcome", "Choose", "Key", "Model"];

  return (
    <div className="onboard-backdrop">
      <div className="onboard">
        {/* progress */}
        <div className="onboard-progress">
          {steps.map((s, i) => (
            <div key={s} className={`ob-dot${i <= step ? " on" : ""}`} />
          ))}
          <span className="ob-step-name">{steps[step]}</span>
        </div>

        {step === 0 && (
          <div className="ob-body">
            <div className="ob-hero">
              <span className="ob-mark">
                <DragonMark size={56} />
              </span>
              <h1>Spyro Studio</h1>
              <p className="ob-tag">A free, provider-agnostic AI coding agent.</p>
              <p className="ob-sub">
                Three quick steps and you're building. Nothing is uploaded anywhere unless you
                choose a cloud model — pick a local model and it never leaves this machine.
              </p>
            </div>
            <div className="ob-actions">
              <button className="btn-primary" onClick={() => setStep(1)}>
                Get started
              </button>
              <button className="btn-ghost" onClick={onSkip}>
                I'll set it up later
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="ob-body">
            <h2>How should it run?</h2>
            <div className="ob-local">
              {LOCAL.map((l) => (
                <button
                  key={l.id}
                  className={`ob-card${provider === l.id ? " sel" : ""}`}
                  onClick={() => setProvider(l.id)}
                >
                  <span className="ob-card-title">{l.label}</span>
                  <span className="ob-card-hint">{l.hint}</span>
                  <span className="ob-badge-free">no key needed</span>
                </button>
              ))}
            </div>
            <div className="ob-label">Or a free cloud model</div>
            <div className="ob-grid">
              {cloudProviders.map((id) => (
                <button
                  key={id}
                  className={`ob-card small${provider === id ? " sel" : ""}`}
                  onClick={() => setProvider(id)}
                >
                  <span className="ob-card-title">{freeProviders?.[id]?.label || id}</span>
                  {freeProviders?.[id]?.freeTier && (
                    <span className="ob-badge-free">{freeProviders[id].freeTier}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="ob-actions">
              <button className="btn-ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn-primary" onClick={() => setStep(2)} disabled={!provider}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="ob-body">
            <h2>{needsKey ? "Add your API key" : "Local model — no key needed"}</h2>
            {needsKey ? (
              <>
                <p className="ob-sub">
                  {info?.freeTier ? `${info.label} offers a ${info.freeTier}.` : `Paste your ${info?.label || provider} key.`}
                  {info?.keyUrl && (
                    <>
                      {" "}
                      <a href={info.keyUrl} target="_blank" rel="noreferrer">
                        Get a free key ↗
                      </a>
                    </>
                  )}
                </p>
                <input
                  className="ob-input"
                  type="password"
                  autoFocus
                  placeholder={info?.label ? `${info.label} API key` : "API key"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && apiKey.trim()) setStep(3);
                  }}
                />
                <p className="ob-hint">
                  Stored only in <code>~/.claude-free/config.json</code> on this machine. Never
                  sent anywhere except your chosen provider.
                </p>
              </>
            ) : (
              <p className="ob-sub">
                Spyro Studio will use your local Ollama server. Make sure it's running and you've
                pulled a model (<code>ollama pull qwen2.5-coder</code>), then continue.
              </p>
            )}
            <div className="ob-actions">
              <button className="btn-ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="btn-primary"
                onClick={() => setStep(3)}
                disabled={needsKey && !apiKey.trim()}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="ob-body">
            <h2>Pick a model</h2>
            {loadingModels && <p className="ob-sub">Fetching models…</p>}
            {modelError && <p className="ob-sub warn">{modelError}</p>}
            {!loadingModels && models.length > 0 && (
              <select
                className="ob-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                autoFocus
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            {!loadingModels && models.length === 0 && (
              <input
                className="ob-input"
                placeholder={
                  SUGGESTED_MODELS[provider] || "model name"
                }
                value={model}
                autoFocus
                onChange={(e) => setModel(e.target.value)}
              />
            )}
            <p className="ob-hint">
              Not sure? <code>{SUGGESTED_MODELS[provider] || "the default"}</code> is a good
              starting point. You can switch models any time.
            </p>
            <div className="ob-actions">
              <button className="btn-ghost" onClick={() => setStep(2)}>
                Back
              </button>
              <button className="btn-primary" onClick={finish} disabled={!canFinish}>
                {needsKey && !apiKey.trim() ? "Add a key first" : "Start building"}
              </button>
            </div>
          </div>
        )}

        <div className="ob-foot">
          Spyro Technologies · AI &amp; software development studio · Lewis Kariuki, Senior
          Developer &amp; Owner
        </div>
      </div>
    </div>
  );
}