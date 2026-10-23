import { useCallback, useEffect, useMemo, useState } from "react";

export interface Extension {
  id: string;
  name: string;
  publisher: string;
  description: string;
  category: string;
  version: string;
  installs: number;
  installed: boolean;
  enabled: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  web: "Web",
  data: "Data",
  code: "Code",
  devops: "DevOps",
  media: "Media",
  docs: "Docs",
};

function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

/**
 * The extension marketplace. Installed extensions add tools to the agent, the
 * same way a VS Code extension adds capabilities to the editor — which is why
 * enabling one takes effect after a restart, honestly labelled here.
 */
export function Marketplace({ onClose }: { onClose?: () => void }) {
  const [exts, setExts] = useState<Extension[]>([]);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [busy, setBusy] = useState<string>("");
  const [note, setNote] = useState("");
  const [needsRestart, setNeedsRestart] = useState(false);

  const load = useCallback(() => {
    fetch("/api/market")
      .then((r) => r.json())
      .then((j) => setExts(Array.isArray(j?.extensions) ? j.extensions : []))
      .catch(() => setExts([]));
  }, []);

  useEffect(load, [load]);

  const act = async (action: string, id: string) => {
    setBusy(id);
    setNote("");
    try {
      const r = await fetch(`/api/market?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (j?.error) setNote(j.error);
      else if (j?.restart) setNeedsRestart(true);
      load();
    } catch {
      setNote("Could not reach the extension service.");
    } finally {
      setBusy("");
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exts.filter((e) => {
      if (cat !== "all" && e.category !== cat) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.publisher.toLowerCase().includes(q)
      );
    });
  }, [exts, query, cat]);

  const installedCount = exts.filter((e) => e.installed).length;

  return (
    <div className="mkt">
      <div className="mkt-head">
        <h2>Extensions</h2>
        {onClose && (
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      <input
        className="mkt-search"
        placeholder="Search extensions"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />

      <div className="mkt-tabs">
        <button className={`mkt-tab${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>
          All <b>{exts.length}</b>
        </button>
        <button className={`mkt-tab${cat === "installed" ? " on" : ""}`} onClick={() => setCat("installed")}>
          Installed <b>{installedCount}</b>
        </button>
        {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
          <button key={k} className={`mkt-tab${cat === k ? " on" : ""}`} onClick={() => setCat(k)}>
            {label}
          </button>
        ))}
      </div>

      {needsRestart && (
        <div className="mkt-restart">Restart Spyro Studio to activate extension changes.</div>
      )}
      {note && <div className="mkt-note">{note}</div>}

      <div className="mkt-list">
        {shown
          .filter((e) => cat !== "installed" || e.installed)
          .map((e) => (
            <div key={e.id} className="mkt-item">
              <div className="mkt-item-top">
                <span className="mkt-name">{e.name}</span>
                <span className="mkt-pub">{e.publisher}</span>
                {e.installed && <span className={`mkt-badge${e.enabled ? " on" : ""}`}>{e.enabled ? "enabled" : "disabled"}</span>}
              </div>
              <div className="mkt-desc">{e.description}</div>
              <div className="mkt-meta">
                <span>{CATEGORY_LABEL[e.category] || e.category}</span>
                <span>v{e.version}</span>
                <span>{compact(e.installs)} installs</span>
              </div>
              <div className="mkt-actions">
                {!e.installed ? (
                  <button className="mkt-btn primary" disabled={busy === e.id} onClick={() => act("install", e.id)}>
                    {busy === e.id ? "Installing…" : "Install"}
                  </button>
                ) : (
                  <>
                    <button className="mkt-btn" disabled={busy === e.id} onClick={() => act("toggle", e.id)}>
                      {e.enabled ? "Disable" : "Enable"}
                    </button>
                    <button className="mkt-btn subtle" disabled={busy === e.id} onClick={() => act("uninstall", e.id)}>
                      Uninstall
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        {shown.length === 0 && <div className="mkt-empty">No extensions match “{query}”.</div>}
      </div>
    </div>
  );
}
