import { useEffect, useState } from "react";

export interface FsEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

export function FolderPicker({
  cwd,
  onSelect,
  onClose,
}: {
  cwd: string;
  onSelect: (p: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(cwd);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const u = new URL("/api/fs/list", location.origin);
      u.searchParams.set("path", p);
      const res = await fetch(u.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPath(data.path);
      setEntries(data.entries);
    } catch (err: any) {
      setError(err.message || "Failed to load");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(cwd);
  }, [cwd]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 580 }} onClick={(e) => e.stopPropagation()}>
        <h2>Open folder</h2>
        <div className="cwd-bar" style={{ borderRadius: 8, padding: 8, marginBottom: 10 }}>
          <span className="cwd-label">path</span>
          <span className="cwd-path">{path}</span>
        </div>

        {error && <div className="model-status model-error">{error}</div>}

        {entries.filter((e) => e.type === "dir").length > 0 && (
          <ul className="model-list">
            {entries
              .filter((e) => e.type === "dir")
              .map((e) => (
                <li key={e.path} className="model-item" onClick={() => load(e.path)}>
                  <span className="model-id">📁 {e.name}/</span>
                </li>
              ))}
          </ul>
        )}

        {loading && <div className="model-status">Loading…</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => load("/home/zoomkid")}>
            Home
          </button>
          <button className="btn-secondary" onClick={() => load("/usr")}>
            System
          </button>
          <button className="btn-secondary" onClick={() => load("/tmp")}>
            tmp
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSelect(path)}>
            Select this folder
          </button>
        </div>
      </div>
    </div>
  );
}
