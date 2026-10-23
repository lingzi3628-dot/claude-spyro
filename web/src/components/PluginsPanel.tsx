import { useState } from "react";
import type { MarketplaceInfo, InstalledPlugin } from "../types";

interface Props {
  marketplaces: MarketplaceInfo[];
  installed: InstalledPlugin[];
  onClose: () => void;
  onAddMarketplace: (repo: string) => void;
  onRemoveMarketplace: (name: string) => void;
  onInstall: (name: string, marketplace?: string) => void;
  onUninstall: (name: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onUpdate: (name?: string) => void;
}

export function PluginsPanel(props: Props) {
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!repo.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      props.onAddMarketplace(repo.trim());
      setRepo("");
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal plugins-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>Plugins</span>
          <button className="icon-btn" onClick={props.onClose}>×</button>
        </div>

        <div className="plugin-add">
          <input
            placeholder="Marketplace: owner/repo or git URL"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button className="btn-send" onClick={add} disabled={busy || !repo.trim()}>
            Add
          </button>
        </div>
        {err && <div className="panel-error">{err}</div>}

        {props.marketplaces.length > 0 && (
          <>
            <div className="panel-label">Marketplaces</div>
            {props.marketplaces.map((m) => (
              <div key={m.name} className="plugin-market">
                <div className="plugin-market-head">
                  <strong>{m.name}</strong>
                  <button
                    className="icon-btn"
                    title="Remove marketplace"
                    onClick={() => props.onRemoveMarketplace(m.name)}
                  >
                    ×
                  </button>
                </div>
                {m.description && <div className="plugin-desc">{m.description}</div>}
                <div className="plugin-list">
                  {m.plugins.map((p) => (
                    <div key={p.name} className="plugin-row">
                      <span className="plugin-name">{p.name}</span>
                      {p.description && (
                        <span className="plugin-desc">{p.description}</span>
                      )}
                      <button
                        className="btn-send"
                        disabled={busy}
                        onClick={() => props.onInstall(p.name, m.name)}
                      >
                        Install
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <div className="panel-label">
          Installed
          {props.installed.length > 0 && (
            <button
              className="composer-chip"
              style={{ marginLeft: 8 }}
              onClick={() => props.onUpdate()}
            >
              Update all
            </button>
          )}
        </div>
        {props.installed.length === 0 && (
          <div className="panel-empty">No plugins installed.</div>
        )}
        {props.installed.map((p) => (
          <div key={p.name} className={`plugin-row${p.enabled ? "" : " disabled"}`}>
            <span className="plugin-name">{p.name}</span>
            {p.version && <span className="plugin-desc">v{p.version}</span>}
            {p.description && <span className="plugin-desc">{p.description}</span>}
            <button
              className="composer-chip"
              onClick={() => props.onToggle(p.name, !p.enabled)}
            >
              {p.enabled ? "Enabled" : "Disabled"}
            </button>
            <button className="composer-chip" onClick={() => props.onUpdate(p.name)}>
              Update
            </button>
            <button className="icon-btn" title="Uninstall" onClick={() => props.onUninstall(p.name)}>
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
