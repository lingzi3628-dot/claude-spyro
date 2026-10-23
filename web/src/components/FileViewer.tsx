import { useEffect, useState } from "react";

export function FileViewer({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [binary, setBinary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const u = new URL("/api/fs/read", location.origin);
        u.searchParams.set("path", path);
        const res = await fetch(u.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to read");
        setContent(data.content);
        setTruncated(data.truncated);
        setBinary(data.binary);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [path]);

  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "90vw", maxWidth: "1200px" }} onClick={(e) => e.stopPropagation()}>
        <h2>{name}</h2>
        <div className="model-status" style={{ textAlign: "left", padding: "6px 8px" }}>
          {path}
        </div>
        {loading && <div className="model-status">Loading…</div>}
        {error && <div className="model-status model-error">{error}</div>}
        {!loading && !error && (
          <pre className="file-content">
            {binary ? "[binary file]" : content}
          </pre>
        )}
        {truncated && !binary && (
          <div className="model-status">Truncated to 500KB.</div>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(content)}>
            Copy
          </button>
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
