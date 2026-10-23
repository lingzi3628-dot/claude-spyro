import { useEffect, useMemo, useState } from "react";

export interface FoundUrl {
  url: string;
  label: string;
  /** Where it came from, for context in the card. */
  source: string;
}

/** Local dev servers are worth surfacing; generic links are not. */
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/\S*)?/i;

const NAME_FOR_PORT: Record<string, string> = {
  "3000": "Next.js / React dev server",
  "3001": "second app",
  "4200": "Angular dev server",
  "5173": "Vite dev server",
  "5174": "Vite (second app)",
  "8000": "Python / FastAPI server",
  "8080": "common dev server",
  "5000": "Express / Flask server",
  "4173": "Vite preview",
  "5500": "Live Server",
};

function labelFor(url: string): string {
  const port = (() => {
    const m = url.match(/:(\d+)/);
    return m?.[1] ?? "";
  })();
  return NAME_FOR_PORT[port] || (port ? `Local server on :${port}` : "Local server");
}

function tidy(url: string): string {
  return url.replace(/[.,;:)\]]+$/, "");
}

/**
 * Scan the transcript for local server URLs so the UI can offer a real
 * "open it" link the moment the agent has something running.
 */
export function useFoundUrls(items: unknown[], extraText = ""): FoundUrl[] {
  return useMemo(() => {
    const seen = new Map<string, FoundUrl>();

    const consider = (text: string, source: string) => {
      // CLI output often prints a bare "localhost:3000" with no scheme. Add one
      // — but never to something already prefixed, or "http://localhost:3000"
      // would become "http://http://localhost:3000" and stop matching.
      const withScheme = text.replace(/(?<!:\/\/)\b(?:localhost|127\.0\.0\.1):(\d{2,5})\b/g, "http://localhost:$1");
      const matches = withScheme.match(/https?:\/\/[^\s"'`<>)\]]+/gi) || [];
      for (const raw of matches) {
        const url = tidy(raw);
        if (!LOCAL.test(url)) continue;
        if (seen.has(url)) continue;
        seen.set(url, { url, label: labelFor(url), source });
      }
    };

    for (const it of items as { kind?: string; text?: string; name?: string; result?: unknown }[]) {
      if (!it) continue;
      if (it.kind === "assistant" || it.kind === "system" || it.kind === "plan") {
        if (it.text) consider(it.text, "output");
      }
      if (it.kind === "tool") {
        const name = it.name || "tool";
        const body = typeof it.result === "string" ? it.result : JSON.stringify(it.result ?? "");
        if (body) consider(body, name);
      }
    }
    if (extraText) consider(extraText, "output");

    return [...seen.values()];
  }, [items, extraText]);
}

/** The card shown once something is running. */
export function UrlCards({
  urls,
  onPreview,
}: {
  urls: FoundUrl[];
  /** Open this URL in the docked in-app preview. */
  onPreview?: (url: string) => void;
}) {
  if (urls.length === 0) return null;
  const [state, setState] = useState<Record<string, string>>({});

  const check = async (u: string) => {
    setState((s) => ({ ...s, [u]: "checking" }));
    try {
      const res = await fetch(`/api/probe?url=${encodeURIComponent(u)}`, {
        method: "GET",
      });
      const data = await res.json();
      setState((s) => ({ ...s, [u]: data.up ? "up" : "down" }));
    } catch {
      setState((s) => ({ ...s, [u]: "down" }));
    }
  };

  useEffect(() => {
    if (urls.length) check(urls[urls.length - 1].url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.length]);

  return (
    <div className="url-cards">
      {urls.map((u) => (
        <div key={u.url} className="url-card">
          <div className="url-card-main">
            <span className={`url-dot ${state[u.url] ?? "unknown"}`} />
            <div className="url-card-text">
              <span className="url-card-label">{u.label}</span>
              <code className="url-card-url">{u.url}</code>
            </div>
          </div>
          <div className="url-card-actions">
            <button className="url-open" onClick={() => check(u.url)} title="Check if it's responding">
              {state[u.url] === "checking" ? "checking…" : state[u.url] === "up" ? "up ✓" : state[u.url] === "down" ? "down" : "check"}
            </button>
            {onPreview && (
              <button className="url-open-primary" onClick={() => onPreview(u.url)}>
                Preview ▣
              </button>
            )}
            <a className="url-open-external" href={u.url} target="_blank" rel="noreferrer" title="Open in a real browser">
              ↗
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}