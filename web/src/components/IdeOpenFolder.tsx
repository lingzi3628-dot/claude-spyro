import { useEffect, useState } from "react";
import { DragonMark } from "./DragonMark";

export interface RecentFolder {
  path: string;
  openedAt: number;
}

const KEY = "cf-ide-recent";

export function loadRecent(): RecentFolder[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x) => x && typeof x.path === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecent(path: string): RecentFolder[] {
  const next = [{ path, openedAt: Date.now() }, ...loadRecent().filter((r) => r.path !== path)].slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

function nameOf(p: string): string {
  return p.split("/").filter(Boolean).pop() || p;
}

/**
 * The IDE's start screen, in the shape VS Code uses: open a folder, or pick
 * one you used before. Deliberately separate from the app's own home screen —
 * the IDE opens a folder, it does not pick a "project".
 */
export function IdeOpenFolder({
  cwd,
  home,
  projects,
  onOpen,
  onCreate,
  onClose,
}: {
  /** The folder the app is currently pointed at, if any. */
  cwd?: string;
  home?: string;
  projects: { name: string; path: string }[];
  onOpen: (path: string) => void;
  /** Create the folder and open it. */
  onCreate?: (path: string) => void;
  onClose?: () => void;
}) {
  const [recent, setRecent] = useState<RecentFolder[]>([]);
  const [workspaces, setWorkspaces] = useState<{ file: string; name: string; folders: string[] }[]>([]);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  // VS Code treats a .code-workspace file as its own kind of thing — a
  // multi-root workspace — so it is listed separately from plain folders.
  useEffect(() => {
    let live = true;
    const scan = (dir: string) =>
      fetch(`/api/fs/workspace?path=${encodeURIComponent(dir)}`)
        .then((r) => r.json())
        .then((j) => {
          if (live && Array.isArray(j?.workspaces)) setWorkspaces((w) => [...w, ...j.workspaces]);
        })
        .catch(() => undefined);
    scan(cwd || home || "");
    for (const r of loadRecent()) scan(r.path);
    return () => {
      live = false;
    };
  }, [cwd, home]);

  const candidates = [
    ...(cwd ? [{ path: cwd, openedAt: Date.now() }] : []),
    ...recent.filter((r) => r.path !== cwd),
  ];

  const confirm = async (path: string) => {
    const target = path.trim();
    if (!target) return;
    setError("");
    setPicked("Opening…");
    try {
      // Validate before switching so a typo doesn't leave the IDE blank.
      const r = await fetch(`/api/fs/list?path=${encodeURIComponent(target)}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.entries)) throw new Error(j?.error || "Not a folder");
      setRecent(rememberRecent(j.path || target));
      onOpen(j.path || target);
    } catch (e: any) {
      setError(e?.message || "Could not open that folder.");
      setPicked("");
    }
  };

  return (
    <div className="ide-open">
      <div className="ide-open-card">
        <span className="ide-open-mark">
          <DragonMark size={40} />
        </span>
        <h1>Spyro Studio</h1>
        <p className="ide-open-sub">Open a folder to start editing. The agent works beside you.</p>

        <input
          className="ide-open-path"
          placeholder={home ? `${home}/my-project` : "/path/to/folder"}
          value={picked || ""}
          onChange={(e) => setPicked(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirm(picked);
          }}
        />
        <div className="ide-open-actions">
          <button className="ide-open-btn primary" onClick={() => confirm(picked)}>
            Open Folder
          </button>
          {onClose && (
            <button className="ide-open-btn" onClick={onClose}>
              Back to projects
            </button>
          )}
        </div>
        {error && <div className="ide-open-error">{error}</div>}

        {candidates.length > 0 && (
          <>
            <div className="ide-open-label">Recent</div>
            <div className="ide-open-list">
              {candidates.slice(0, 6).map((r) => (
                <button key={r.path} className="ide-open-item" onClick={() => confirm(r.path)}>
                  <span className="ide-open-folder">▤</span>
                  <span className="ide-open-item-name">{nameOf(r.path)}</span>
                  <span className="ide-open-item-path">{r.path}</span>
                  <span className="ide-open-item-when">{ago(r.openedAt)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {workspaces.length > 0 && (
          <>
            <div className="ide-open-label">Workspaces</div>
            <div className="ide-open-list">
              {workspaces.slice(0, 6).map((w) => (
                <button
                  key={w.file}
                  className="ide-open-item"
                  onClick={() => confirm(w.folders[0] || w.file)}
                  title={w.folders.join(", ")}
                >
                  <span className="ide-open-folder">◫</span>
                  <span className="ide-open-item-name">{w.name}</span>
                  <span className="ide-open-item-path">
                    {w.folders.length} folder{w.folders.length === 1 ? "" : "s"} · .code-workspace
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {projects.length > 0 && (
          <>
            <div className="ide-open-label">Projects in your workspace</div>
            <div className="ide-open-list">
              {projects.slice(0, 6).map((p) => (
                <button key={p.path} className="ide-open-item" onClick={() => confirm(p.path)}>
                  <span className="ide-open-folder">◈</span>
                  <span className="ide-open-item-name">{p.name}</span>
                  <span className="ide-open-item-path">{p.path}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
