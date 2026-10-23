import { useEffect } from "react";
import { DragonMark } from "./DragonMark";

export type ErrorKind = "rate_limit" | "auth" | "quota" | "network" | "model" | "unknown";

export interface ErrorInfo {
  kind: ErrorKind;
  title: string;
  detail: string;
  /** What the user can actually do about it. */
  actions: string[];
  provider?: string;
  retryAfter?: string;
  raw?: string;
}

/**
 * Turn a raw provider/runtime error into something a person can act on.
 * A bare "HTTP 429" tells the user nothing; naming the cause and the fix does.
 */
export function classifyError(raw: string, provider?: string): ErrorInfo {
  const s = raw || "";
  const lower = s.toLowerCase();

  // Providers report resets differently: "resets 14:32", "2026-10-19T00:00:00Z",
  // or a unix epoch. Prefer a full timestamp, then a clock time.
  const iso = s.match(/reset[^0-9]{0,20}(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/i);
  const clock = s.match(/reset[^0-9]{0,20}(\d{1,2}:\d{2}(?::\d{2})?)/i);
  const retry = iso?.[1] || clock?.[1];

  if (/\b429\b|rate.?limit|too many requests|quota|insufficient_quota|free-models-per-day|monthly limit|daily limit/i.test(lower)) {
    const isQuota = /quota|insufficient|credit|billing|plan|exceeded your current quota/i.test(lower);
    const isDaily = /per-day|per day|daily|free-models-per-day/i.test(lower);
    return {
      kind: isQuota ? "quota" : "rate_limit",
      title: isQuota ? "Out of credit" : isDaily ? "Daily free limit reached" : "Rate limited",
      detail: isQuota
        ? `${provider || "The provider"} says this account has no remaining credit. Free plans stop here.`
        : isDaily
          ? `${provider || "The provider"} allows a limited number of free requests per day, and that quota is used up.`
          : `Too many requests to ${provider || "the provider"} in a short window. It usually clears in seconds.`,
      actions: isQuota
        ? [
            "Add credit to this provider, or",
            "Switch to a provider with free credits (Groq, Gemini, Cerebras, NVIDIA, GitHub)",
            "Or use Ollama for a local model with no limits at all",
          ]
        : isDaily
          ? [
              "Wait for the daily reset",
              "Switch provider in Settings (Groq, Gemini and Cerebras have generous free tiers)",
              "Or run a local model with Ollama — unlimited and offline",
            ]
          : ["Wait a few seconds and retry", "Switch provider if it keeps happening"],
      provider,
      retryAfter: retry,
      raw: s,
    };
  }

  if (/\b401\b|\b403\b|unauthorized|forbidden|invalid api key|invalid_api_key|authentication|permission denied/i.test(lower)) {
    return {
      kind: "auth",
      title: "API key rejected",
      detail: `${provider || "The provider"} did not accept the key. It is usually copied wrong, revoked, or missing a prefix.`,
      actions: [
        `Re-enter the key in Settings for ${provider || "this provider"}`,
        "Check you copied the whole key with no spaces or line breaks",
        "Confirm the key is for the API (not the web dashboard)",
      ],
      provider,
      raw: s,
    };
  }

  if (/econnrefused|etimedout|enotfound|network|fetch failed|socket hang up|dns/i.test(lower)) {
    return {
      kind: "network",
      title: "Can't reach the provider",
      detail: "The request never got through. That's usually the network, a proxy, or a wrong base URL.",
      actions: [
        "Check your internet connection",
        "Check the base URL in Settings matches this provider",
        "If you use Ollama locally, make sure it's running",
      ],
      provider,
      raw: s,
    };
  }

  if (/context length|too many tokens|maximum context|token limit|prompt is too long/i.test(lower)) {
    return {
      kind: "model",
      title: "Conversation too long",
      detail: "This model has a context limit and the conversation has filled it.",
      actions: ["Run /compact to summarise the conversation", "Or /clear to start fresh"],
      provider,
      raw: s,
    };
  }

  if (/model .*not found|no such model|unknown model|does not exist/i.test(lower)) {
    return {
      kind: "model",
      title: "Model not found",
      detail: `${provider || "The provider"} does not recognise that model id.`,
      actions: [
        "Open /model and use Browse models to pick from the real list",
        "Model ids are case- and spelling-sensitive",
      ],
      provider,
      raw: s,
    };
  }

  if (/sandbox|no usable sandbox|permission denied by sandbox|blocked by sandbox/i.test(lower)) {
    return {
      kind: "model",
      title: "Blocked by the sandbox",
      detail: "The command was stopped by the safety policy or the isolation layer.",
      actions: [
        "Run it yourself in a terminal if it's genuinely safe",
        "Adjust the rules in Settings → Permissions",
      ],
      raw: s,
    };
  }

  return {
    kind: "unknown",
    title: "Something went wrong",
    detail: s.length > 240 ? s.slice(0, 240) + "…" : s,
    actions: ["Try again", "Check the log in ~/.claude-free if it keeps happening"],
    provider,
    raw: s,
  };
}

const ICON: Record<ErrorKind, string> = {
  rate_limit: "⏳",
  quota: "💳",
  auth: "🔑",
  network: "📡",
  model: "⚙",
  unknown: "⚠",
};

export function ErrorDialog({ info, onClose }: { info: ErrorInfo | null; onClose: () => void }) {
  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [info, onClose]);

  if (!info) return null;

  return (
    <div className="modal-overlay err-overlay" onClick={onClose}>
      <div className="modal err-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`err-head ${info.kind}`}>
          <span className="err-icon">{ICON[info.kind]}</span>
          <div className="err-head-text">
            <h2>{info.title}</h2>
            {info.provider && <span className="err-provider">{info.provider}</span>}
          </div>
          <button className="guide-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="err-detail">{info.detail}</p>

        {info.retryAfter && (
          <div className="err-retry">
            <strong>Resets at {info.retryAfter}</strong>
            <span>No action needed before then — free daily quotas roll over automatically.</span>
          </div>
        )}

        <div className="err-actions">
          <div className="err-actions-title">What to do</div>
          <ul>
            {info.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>

        {info.raw && (
          <details className="err-raw">
            <summary>Technical detail</summary>
            <pre>{info.raw}</pre>
          </details>
        )}

        <div className="err-foot">
          <span className="err-brand">
            <DragonMark size={16} /> Spyro Technologies
          </span>
          <button className="btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}