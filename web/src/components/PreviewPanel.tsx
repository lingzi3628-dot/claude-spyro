import { useEffect, useRef, useState } from "react";

/**
 * An embedded preview of whatever the agent just started.
 *
 * The dev server runs on its own port, so it is a different origin from this
 * UI — we can't touch its DOM (nor should we), but embedding it is exactly
 * what a browser tab would do.
 */
export function PreviewPanel({
  url,
  onClose,
  onUrlChange,
}: {
  url: string;
  onClose: () => void;
  onUrlChange?: (u: string) => void;
}) {
  const [current, setCurrent] = useState(url);
  const [input, setInput] = useState(url);
  const [status, setStatus] = useState<"unknown" | "up" | "down" | "checking">("unknown");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setCurrent(url);
    setInput(url);
  }, [url]);

  const check = async (target: string) => {
    setStatus("checking");
    try {
      const res = await fetch(`/api/probe?url=${encodeURIComponent(target)}`);
      const data = await res.json();
      setStatus(data.up ? "up" : "down");
    } catch {
      setStatus("down");
    }
  };

  useEffect(() => {
    check(current);
    setLoading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reloadKey]);

  const go = (target: string) => {
    const t = target.trim();
    if (!t) return;
    const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t}`;
    setCurrent(withScheme);
    onUrlChange?.(withScheme);
    check(withScheme);
  };

  return (
    <aside className="preview">
      <div className="preview-bar">
        <button className="pv-btn" onClick={() => setReloadKey((k) => k + 1)} title="Reload preview">
          ⟳
        </button>
        <div className="pv-url">
          <span className={`pv-dot ${status}`} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go(input);
            }}
            onBlur={() => input !== current && go(input)}
            spellCheck={false}
          />
        </div>
        <button className="pv-btn" onClick={() => check(current)} title="Check if it's responding">
          {status === "checking" ? "…" : status === "up" ? "up" : status === "down" ? "down" : "check"}
        </button>
        <a className="pv-btn" href={current} target="_blank" rel="noreferrer" title="Open in a real browser">
          ↗
        </a>
        <button className="pv-btn pv-close" onClick={onClose} title="Close preview">
          ✕
        </button>
      </div>

      <div className="preview-frame-wrap">
        {loading && <div className="preview-loading">Loading {current}…</div>}
        {status === "down" && (
          <div className="preview-down">
            <strong>Nothing answering on {current}</strong>
            <p>
              The app may still be starting. Hit ⟳ to retry, or check the terminal output for the
              real port.
            </p>
          </div>
        )}
        <iframe
          key={`${current}-${reloadKey}`}
          ref={frame}
          className="preview-frame"
          src={current}
          title="App preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          onLoad={() => setLoading(false)}
        />
      </div>
    </aside>
  );
}