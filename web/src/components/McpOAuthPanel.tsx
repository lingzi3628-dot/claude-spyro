import { useState } from "react";

export interface McpOAuthServer {
  server: string;
  url: string;
  authenticated: boolean;
}

interface Props {
  servers: McpOAuthServer[];
  currentUrl?: { server: string; url: string } | null;
  onClose: () => void;
  onStatus: () => void;
  onStart: (server: string) => void;
  onSubmitCode: (server: string, code: string) => void;
  onDisconnect: (server: string) => void;
}

export function McpOAuthPanel({
  servers,
  currentUrl,
  onClose,
  onStatus,
  onStart,
  onSubmitCode,
  onDisconnect,
}: Props) {
  const [active, setActive] = useState<{ server: string; url: string } | null>(null);
  const [pasted, setPasted] = useState("");

  const remote = servers.filter((s) => s.url);

  const start = (server: string) => {
    setPasted("");
    setActive({ server, url: "" });
    onStart(server);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal mcp-oauth-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>MCP server sign-in (OAuth)</span>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="panel-hint">
          Remote MCP servers that require OAuth. Signing in stores a token for that
          server only. Public-key servers need nothing here.
        </div>

        <div className="panel-label">
          Remote servers
          <button className="composer-chip" style={{ marginLeft: 8 }} onClick={onStatus}>
            Refresh
          </button>
        </div>

        {remote.length === 0 && (
          <div className="panel-empty">
            No remote MCP servers configured. Add one with a <code>url</code> in{" "}
            <code>~/.claude-free/mcp.json</code>.
          </div>
        )}

        {remote.map((s) => (
          <div key={s.server} className="mcp-oauth-row">
            <span className="mcp-oauth-name">{s.server}</span>
            <span className="mcp-oauth-url">{s.url}</span>
            {s.authenticated ? (
              <>
                <span className="mcp-oauth-badge ok">signed in</span>
                <button className="composer-chip" onClick={() => onDisconnect(s.server)}>
                  Sign out
                </button>
              </>
            ) : (
              <button className="composer-chip" onClick={() => start(s.server)}>
                Sign in
              </button>
            )}
          </div>
        ))}

        {active && (
          <div className="mcp-oauth-flow">
            <div className="panel-label">Authorize {active.server}</div>
            {currentUrl?.server === active.server && (
              <a className="mcp-oauth-link" href={currentUrl.url} target="_blank" rel="noreferrer">
                Open sign-in link ↗
              </a>
            )}
            <ol className="mcp-oauth-steps">
              <li>Open the sign-in link below and approve access.</li>
              <li>You will be redirected to a localhost URL that may fail to load — that is expected.</li>
              <li>Copy the whole address bar URL and paste it below.</li>
            </ol>
            <div className="mcp-oauth-actions">
              <button className="btn-send" onClick={() => onStart(active.server)}>
                Get / re-show link
              </button>
              <input
                placeholder="Paste the redirect URL or the code"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <button
                className="btn-send"
                disabled={!pasted.trim()}
                onClick={() => {
                  onSubmitCode(active.server, pasted.trim());
                  setActive(null);
                  setPasted("");
                }}
              >
                Finish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}