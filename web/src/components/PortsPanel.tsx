import { useCallback, useEffect, useRef, useState } from "react";

interface Port {
  port: number;
  url: string;
  label: string;
  process: string;
  up: boolean;
}

/**
 * The Ports panel.
 *
 * Servers are discovered from what the agent and terminal actually printed —
 * a URL means "this process serves something" — then confirmed against the
 * kernel's listening sockets so the panel never shows a dead link as if it
 * were alive.
 */
export function PortsPanel({
  onOpen,
  onAdd,
}: {
  /** Open a server URL in the editor's preview tab. */
  onOpen: (url: string, label: string) => void;
  /** Run a command that starts a server (used by the quick-start buttons). */
  onAdd?: (command: string) => void;
}) {
  const [ports, setPorts] = useState<Port[]>([]);
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState("");
  const timer = useRef<number | null>(null);

  const load = useCallback(() => {
    fetch("/api/ports")
      .then((r) => r.json())
      .then((j) => setPorts(Array.isArray(j?.ports) ? j.ports : []))
      .catch(() => setPorts([]));
  }, []);

  useEffect(() => {
    load();
    // Poll rather than push: a port can come up from outside Spyro entirely.
    timer.current = window.setInterval(load, 3000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  const close = async (port: number) => {
    await fetch("/api/ports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ close: port }),
    });
    load();
  };

  const addManual = async () => {
    const p = manual.trim().replace(/\D/g, "");
    if (!p) return;
    await fetch("/api/ports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port: Number(p), manual: true }),
    });
    setManual("");
    load();
  };

  const QUICK = [
    { cmd: "npx vite --port 5173", label: "Vite", port: 5173 },
    { cmd: "python3 -m http.server 8000", label: "Static server", port: 8000 },
    { cmd: "npx next dev", label: "Next.js", port: 3000 },
  ];

  return (
    <div className="ports">
      <div className="ports-head">
        <span>Forwarded ports</span>
        <button className="find-btn" onClick={load} title="Refresh">
          ⟳
        </button>
      </div>

      <div className="ports-list">
        {ports.map((p) => (
          <div key={p.port} className={`port${p.up ? " up" : ""}`}>
            <span className={`port-dot${p.up ? " on" : ""}`} title={p.up ? "Listening" : "Not listening"} />
            <div className="port-main">
              <button className="port-name" onClick={() => onOpen(p.url, p.label)} title={p.url}>
                {p.label}
              </button>
              <button
                className="port-url"
                onClick={() => {
                  navigator.clipboard?.writeText(p.url);
                  setCopied(String(p.port));
                  setTimeout(() => setCopied(""), 1500);
                }}
                title="Copy URL"
              >
                {copied === String(p.port) ? "copied" : p.url}
              </button>
              {p.process && p.process !== "manual" && <div className="port-cmd">{p.process}</div>}
            </div>
            <div className="port-actions">
              <button className="find-btn" onClick={() => onOpen(p.url, p.label)} title="Open in preview">
                ▣
              </button>
              <button className="find-btn" onClick={() => window.open(p.url, "_blank")} title="Open in browser">
                ↗
              </button>
              <button className="find-btn" onClick={() => close(p.port)} title="Remove from list">
                ✕
              </button>
            </div>
          </div>
        ))}
        {ports.length === 0 && (
          <div className="ide-empty">
            No servers detected yet.
            <br />
            <small>Start one and its URL shows up here automatically.</small>
          </div>
        )}
      </div>

      <div className="ports-add">
        <input
          value={manual}
          placeholder="Add a port, e.g. 3000"
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
        />
        <button className="find-btn wide" onClick={addManual} disabled={!manual.trim()}>
          Add
        </button>
      </div>

      {onAdd && (
        <>
          <div className="ports-head">Start a server</div>
          <div className="ports-quick">
            {QUICK.map((q) => (
              <button
                key={q.cmd}
                className="db-btn"
                onClick={() => {
                  onAdd(q.cmd);
                  // A server takes a moment to bind; check again shortly.
                  setTimeout(load, 2500);
                  setTimeout(load, 6000);
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
