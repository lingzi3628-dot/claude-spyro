import { useState, useEffect } from "react";
import type { ModelConfig, PermissionRules, DetectedServer, ProviderStatus } from "../types";

interface SandboxSupport {
  bwrap: boolean;
  unshare: boolean;
  prlimit: boolean;
  strongest: string;
}
import { ModelBrowser } from "./ModelBrowser";

function parseRules(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const PROVIDER_HELP: Record<string, { label: string; keyHint: string; keyUrl?: string; needsKey: boolean }> = {
  openrouter: {
    label: "OpenRouter",
    keyHint: "One key → Claude, GPT, Llama, and free models (50 free req/day).",
    keyUrl: "https://openrouter.ai/keys",
    needsKey: true,
  },
  huggingface: {
    label: "Hugging Face",
    keyHint: "Free credits on a free account. Routes to 100+ open models.",
    keyUrl: "https://huggingface.co/settings/tokens",
    needsKey: true,
  },
  groq: {
    label: "Groq",
    keyHint: "Free tier — extremely fast inference on open models.",
    keyUrl: "https://console.groq.com/keys",
    needsKey: true,
  },
  cerebras: {
    label: "Cerebras",
    keyHint: "Free tier — very fast wafer-scale inference.",
    keyUrl: "https://cloud.cerebras.ai",
    needsKey: true,
  },
  gemini: {
    label: "Google Gemini",
    keyHint: "Free tier via Google AI Studio.",
    keyUrl: "https://aistudio.google.com/apikey",
    needsKey: true,
  },
  mistral: {
    label: "Mistral",
    keyHint: "Free tier on the smaller Mistral models.",
    keyUrl: "https://console.mistral.ai/api-keys",
    needsKey: true,
  },
  nvidia: {
    label: "NVIDIA NIM",
    keyHint: "Free developer credits for NVIDIA-hosted open models.",
    keyUrl: "https://build.nvidia.com",
    needsKey: true,
  },
  together: {
    label: "Together AI",
    keyHint: "Free trial credits; strong open-model catalog.",
    keyUrl: "https://api.together.ai/settings/api-keys",
    needsKey: true,
  },
  github: {
    label: "GitHub Models",
    keyHint: "Free with a GitHub personal access token.",
    keyUrl: "https://github.com/settings/tokens",
    needsKey: true,
  },
  deepseek: {
    label: "DeepSeek",
    keyHint: "Very low cost; strong coding models.",
    keyUrl: "https://platform.deepseek.com/api_keys",
    needsKey: true,
  },
  xai: {
    label: "xAI (Grok)",
    keyHint: "Your xAI API key (paid).",
    keyUrl: "https://console.x.ai",
    needsKey: true,
  },
  ollama: {
    label: "Ollama (local)",
    keyHint: "No API key needed. Run `ollama serve` and pull a model.",
    needsKey: false,
  },
  openai: {
    label: "OpenAI",
    keyHint: "Your OpenAI secret key.",
    keyUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
  },
  anthropic: {
    label: "Anthropic",
    keyHint: "Your Anthropic API key.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    needsKey: true,
  },
  "openai-compatible": {
    label: "OpenAI-compatible (custom)",
    keyHint: "Any /v1 compatible server (LM Studio, llama.cpp, vLLM, …).",
    needsKey: true,
  },
};


export function SettingsPanel({
  model,
  presets,
  apiKeys,
  onSave,
  onClose,
  permissionRules,
  onSavePermissions,
  account,
  onChangePassword,
  onSignOut,
}: {
  model: ModelConfig | null;
  presets: ModelConfig[];
  apiKeys: Record<string, string>;
  onSave: (cfg: ModelConfig) => void;
  onClose: () => void;
  permissionRules?: PermissionRules;
  onSavePermissions?: (r: PermissionRules) => void;
  /** The local account this device is signed in to. */
  account?: { name: string; email: string; createdAt: number } | null;
  onChangePassword?: (current: string, next: string) => Promise<any>;
  onSignOut?: () => void;
}) {
  const initialProvider = model?.provider || "openrouter";
  const [provider, setProvider] = useState(initialProvider);
  const [health, setHealth] = useState<Record<string, ProviderStatus>>({});
  const [checking, setChecking] = useState(true);
  const [showDown, setShowDown] = useState(false);
  const [sandbox, setSandbox] = useState<SandboxSupport | null>(null);
  const [showAcct, setShowAcct] = useState(false);
  const [pwNow, setPwNow] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwOk, setPwOk] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const savePw = async () => {
    setPwErr("");
    setPwOk("");
    setPwBusy(true);
    try {
      const j = await onChangePassword?.(pwNow, pwNext);
      if (j?.error) setPwErr(j.error);
      else {
        setPwOk("Password updated. Other sessions were signed out.");
        setPwNow("");
        setPwNext("");
        setShowAcct(false);
      }
    } catch {
      setPwErr("Could not reach the local server.");
    } finally {
      setPwBusy(false);
    }
  };

  const refreshHealth = () => {
    setChecking(true);
    fetch("/api/providers/health")
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, ProviderStatus> = {};
        for (const p of j.providers || []) map[p.id] = p;
        setHealth(map);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    refreshHealth();
    fetch("/api/sandbox")
      .then((r) => r.json())
      .then(setSandbox)
      .catch(() => {});
  }, []);

  const healthOf = (id: string): ProviderStatus | undefined => health[id];
  // A provider is hidden when it is unreachable — unless it is the one the
  // user already has selected, so the current choice never disappears.
  const reachable = (id: string) => {
    const h = healthOf(id);
    if (!h || h.health !== "down") return true;
    return id === provider;
  };
  const [modelName, setModelName] = useState(model?.model || "");
  const [apiKey, setApiKey] = useState(apiKeys?.[initialProvider] || model?.apiKey || "");
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl || "");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [allow, setAllow] = useState((permissionRules?.allow || []).join("\n"));
  const [deny, setDeny] = useState((permissionRules?.deny || []).join("\n"));
  const [ask, setAsk] = useState((permissionRules?.ask || []).join("\n"));
  const [localServers, setLocalServers] = useState<DetectedServer[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const scanLocal = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch("/api/local/scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLocalServers(data.servers || []);
    } catch (err: any) {
      setScanError(err.message || "Scan failed");
      setLocalServers([]);
    } finally {
      setScanning(false);
    }
  };

  const pickLocalModel = (s: DetectedServer, modelId: string) => {
    setProvider(s.provider);
    setModelName(modelId);
    setBaseUrl(s.baseUrl);
    setApiKey("");
  };

  const hasDown = Object.values(health).some((h) => h.health === "down");
  const downProviders = Object.values(health)
    .filter((h) => h.health === "down")
    .map((h) => h.id);
  const dot = (id: string) => {
    const h = healthOf(id);
    if (!h) return "○";
    return h.health === "ok" ? "●" : h.health === "needs-key" ? "◐" : "○";
  };

  const help = PROVIDER_HELP[provider];

  const applyPreset = (p: ModelConfig) => {
    setProvider(p.provider);
    setModelName(p.model);
    setBaseUrl(p.baseUrl || "");
    // Load the key remembered for this provider (empty if none).
    setApiKey(apiKeys?.[p.provider] || "");
  };

  const switchProvider = (p: string) => {
    setProvider(p);
    const preset = presets.find((x) => x.provider === p);
    const localDefault =
      p === "ollama"
        ? "http://localhost:11434/v1"
        : p === "openai-compatible"
          ? "http://localhost:1234/v1"
          : "";
    setBaseUrl(preset?.baseUrl || localDefault);
    // Show the key saved for the new provider; never carry the old one over.
    setApiKey(apiKeys?.[p] || "");
  };

  const save = () => {
    onSave({
      provider,
      model: modelName,
      // Always send a string: "" clears the provider's key, a value sets it.
      // (Switching providers without touching the field keeps the saved key.)
      apiKey: apiKey,
      baseUrl: baseUrl || undefined,
    });
    onSavePermissions?.({
      allow: parseRules(allow),
      deny: parseRules(deny),
      ask: parseRules(ask),
    });
    setSaved(true);
    setTimeout(onClose, 500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {account && (
          <div className="acct-box">
            <div className="acct-row">
              <div className="acct-id">
                <span className="acct-avatar">{(account.name || "?").trim().charAt(0).toUpperCase()}</span>
                <div>
                  <div className="acct-name">{account.name}</div>
                  <div className="acct-email">
                    {account.email} · local account on this device
                  </div>
                </div>
              </div>
              <button className="acct-btn" onClick={() => setShowAcct((v) => !v)}>
                {showAcct ? "Cancel" : "Change password"}
              </button>
            </div>

            {showAcct && (
              <div className="acct-form">
                <label>
                  Current password
                  <input
                    type="password"
                    value={pwNow}
                    onChange={(e) => setPwNow(e.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    value={pwNext}
                    onChange={(e) => setPwNext(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                </label>
                {pwErr && <div className="acct-err">{pwErr}</div>}
                {pwOk && <div className="acct-ok">{pwOk}</div>}
                <div className="acct-actions">
                  <button className="acct-btn primary" disabled={pwBusy || !pwNow || !pwNext} onClick={savePw}>
                    {pwBusy ? "Updating…" : "Update password"}
                  </button>
                </div>
              </div>
            )}

            <div className="acct-foot">
              <span>Spyro Studio is free and closed-source. Your account, keys and code never leave this machine.</span>
              <button className="acct-btn danger" onClick={() => onSignOut?.()}>
                Sign out
              </button>
            </div>
          </div>
        )}

        <h2>Model &amp; API Settings</h2>

        <label>Provider</label>
        <div className="prov-health">
          <span className="prov-health-counts">
            {checking
              ? "Checking provider availability…"
              : `${Object.values(health).filter((h) => h.health === "ok").length} ready · ${
                  Object.values(health).filter((h) => h.health === "needs-key").length
                } need a key · ${downProviders.length} down`}
          </span>
          <button className="composer-chip" onClick={refreshHealth} title="Re-check providers">
            {checking ? "…" : "Recheck"}
          </button>
          {hasDown && (
            <label className="prov-showdown">
              <input
                type="checkbox"
                checked={showDown}
                onChange={(e) => setShowDown(e.target.checked)}
              />
              show down
            </label>
          )}
        </div>
        <select value={provider} onChange={(e) => switchProvider(e.target.value)}>
          {(["openrouter", "huggingface", "groq", "cerebras", "gemini", "mistral", "nvidia", "together", "github"] as string[])
            .filter((id) => showDown || reachable(id))
            .map((id) => (
              <option key={id} value={id}>
                {dot(id)} {PROVIDER_HELP[id]?.label || id}
              </option>
            ))}
          <optgroup label="Local">
            <option value="ollama">● Ollama (local)</option>
            <option value="openai-compatible">
              ● OpenAI-compatible (LM Studio, llama.cpp, vLLM…)
            </option>
          </optgroup>
          {(["anthropic", "openai", "deepseek", "xai"] as string[])
            .filter((id) => showDown || reachable(id))
            .map((id) => (
              <option key={id} value={id}>
                {dot(id)} {PROVIDER_HELP[id]?.label || id}
              </option>
            ))}
          {hasDown && (
            <optgroup label="Unreachable">
              {downProviders.map((id) => (
                <option key={id} value={id}>
                  ○ {PROVIDER_HELP[id]?.label || id} — unreachable
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {sandbox && (
          <div className="sandbox-card">
            <div className="sandbox-head">
              <span>Command sandbox</span>
              <span className="sandbox-layer">
                {sandbox.strongest === "bwrap"
                  ? "bubblewrap (full isolation)"
                  : sandbox.strongest === "netns"
                    ? "network namespace"
                    : sandbox.strongest === "rlimits"
                      ? "kernel resource limits"
                      : "policy only"}
              </span>
            </div>
            <div className="sandbox-body">
              {sandbox.strongest === "bwrap" ? (
                <>Commands run in an isolated namespace: the filesystem is read-only except your
                workspace, and the network is blocked unless a command opts in.</>
              ) : sandbox.strongest === "netns" ? (
                <>No bubblewrap here, so the network is isolated and destructive commands are
                blocked by policy.</>
              ) : sandbox.strongest === "rlimits" ? (
                <>This host blocks namespace creation, so isolation is limited to kernel resource
                limits (CPU time, process and file counts) plus policy blocking of destructive
                commands. Filesystem and network isolation are <strong>not</strong> enforced.</>
              ) : (
                <>Only policy checks are active — no kernel isolation available on this host.</>
              )}
            </div>
          </div>
        )}

        {/* ── API Settings ─────────────────────────────── */}
        <div className="api-section">
          <div className="api-section-title">API Settings</div>

          <label>
            API Key
            {help && !help.needsKey && <span className="badge-none">not required</span>}
            {help?.needsKey && apiKeys?.[provider] && (
              <span className="badge-none">saved for {provider}</span>
            )}
          </label>
          <div className="key-row">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={help?.needsKey ? "Paste your API key" : "Leave empty"}
              disabled={!help?.needsKey}
            />
            {help?.needsKey && (
              <>
                <button className="btn-eye" onClick={() => setShowKey((s) => !s)}>
                  {showKey ? "Hide" : "Show"}
                </button>
                <button
                  className="btn-eye"
                  onClick={() => setApiKey("")}
                  title="Forget the saved key for this provider"
                >
                  Clear
                </button>
              </>
            )}
          </div>
          {help && (
            <div className="api-hint">
              {help.keyHint}
              {help.needsKey && (
                <> Keys are stored per provider, so you can switch anytime.</>
              )}
              {help.keyUrl && (
                <>
                  {" "}
                  <a href={help.keyUrl} target="_blank" rel="noreferrer">
                    Get a key →
                  </a>
                </>
              )}
            </div>
          )}

          <label>
            Base URL
            <span className="badge-none">already set</span>
          </label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://..."
          />
          <div className="api-hint">
            Pre-filled automatically for {provider} — you normally don&apos;t need to touch this.
            Only change it for self-hosted or proxy endpoints.
          </div>
          {provider === "openai-compatible" && (
            <div className="api-hint">
              Example: <code>https://api.groq.com/openai/v1</code> or{" "}
              <code>http://localhost:1234/v1</code>
            </div>
          )}

          {/* Model picker lives below the key: browsing a provider's model list
              needs the key, and this ordering stops people guessing model ids. */}
          <ModelBrowser
            value={modelName}
            onChange={setModelName}
            provider={provider}
            baseUrl={baseUrl}
            apiKey={apiKey}
          />
        </div>

        <div className="api-section">
          <div className="api-section-title">
            Local models
            <button className="btn-browse" onClick={scanLocal} disabled={scanning}>
              {scanning ? "Scanning…" : "Scan for local models"}
            </button>
          </div>
          <div className="api-hint">
            Run a local server (Ollama, LM Studio, llama.cpp, vLLM, Jan) and we'll
            detect it automatically. Local models need no API key.
          </div>
          {scanError && <div className="model-status model-error">{scanError}</div>}
          {localServers && localServers.length === 0 && !scanning && (
            <div className="model-status">No local servers found.</div>
          )}
          {localServers && localServers.length > 0 && (
            <div className="local-list">
              {localServers.map((s) => (
                <div key={s.id} className={`local-server ${s.reachable ? "on" : "off"}`}>
                  <div className="local-server-head">
                    <span className={`local-dot ${s.reachable ? "on" : "off"}`} />
                    <span className="local-label">{s.label}</span>
                    <span className="local-url">{s.baseUrl}</span>
                    {!s.reachable && <span className="local-off-tag">not running</span>}
                  </div>
                  {s.reachable && s.models.length > 0 && (
                    <div className="local-models">
                      {s.models.map((m) => (
                        <button
                          key={m.id}
                          className="local-model-btn"
                          onClick={() => pickLocalModel(s, m.id)}
                        >
                          {m.name || m.id}
                          {m.context ? ` ${(m.context / 1000).toFixed(0)}k` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {!s.reachable && <div className="local-hint">{s.hint}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="presets">
          <div className="presets-label">Quick presets (includes free models)</div>
          <div className="preset-list">
            {presets.map((p, i) => (
              <button key={i} className="preset-btn" onClick={() => applyPreset(p)}>
                {p.model}
                {p.provider !== "openrouter" ? ` (${p.provider})` : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="api-section">
          <div className="api-section-title">Permissions</div>
          <div className="api-hint">
            One rule per line. A rule is a tool name (<code>bash</code>) or a tool with a
            pattern (<code>bash(rm:*)</code>, <code>write_file(src/*)</code>). Deny wins
            over ask, and ask wins over allow.
          </div>
          <label>Deny (always blocked)</label>
          <textarea
            rows={2}
            value={deny}
            onChange={(e) => setDeny(e.target.value)}
            placeholder="bash(rm:*), write_file(/etc/*)"
          />
          <label>Ask (always confirm)</label>
          <textarea
            rows={2}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="bash(git push:*), edit_file(**) "
          />
          <label>Allow (never confirm)</label>
          <textarea
            rows={2}
            value={allow}
            onChange={(e) => setAllow(e.target.value)}
            placeholder="read_file, grep, glob"
          />
        </div>

        {/* Discord Community */}
        <div className="api-section">
          <div className="api-section-title">Community</div>
          <div className="api-hint">
            Join our Discord for updates, support, and to invite friends for extra benefits.
          </div>
          <label>Discord Status</label>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <span style={{ fontSize: "24px" }}>💬</span>
            <div>
              <strong>Spyro Studio Discord</strong>
              <br />
              <small style={{ color: "var(--text-dim)" }}>Get updates, ask questions, share projects</small>
            </div>
          </div>
          <button className="btn-secondary" style={{ width: "100%" }} onClick={() => {
            window.open("https://discord.com/invite/QZQ27rFVn", "_blank", "noopener");
          }}>
            Open Discord →
          </button>
          <div className="api-hint" style={{ marginTop: "12px" }}>
            <strong>Invite Friends:</strong> Share <code>https://discord.com/invite/QZQ27rFVn</code> with others.
            When they join, you both get early access to new features and priority support.
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
