import { useEffect, useMemo, useState } from "react";
import { diffLines, diffStats } from "../lib/diff";
import { highlight } from "../highlight";

/**
 * Side-by-side diff. Opened from the explorer's context menu ("Show changes"),
 * it compares the file on disk against the version committed to git, which is
 * the view you actually want before committing or reviewing someone's work.
 */
export function DiffView({
  cwd,
  file,
  onClose,
}: {
  cwd: string;
  file: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ReturnType<typeof diffLines> | null>(null);
  const [err, setErr] = useState("");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr("");
    setRows(null);
    fetch(`/api/diff?path=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j?.error) return setErr(j.error);
        setRows(diffLines(j.committed ?? "", j.current ?? ""));
      })
      .catch((e) => live && setErr(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [cwd, file]);

  const stats = useMemo(() => (rows ? diffStats(rows) : { added: 0, removed: 0 }), [rows]);
  const shown = useMemo(() => {
    if (!rows) return [];
    // Keep a little context around each change rather than hiding everything.
    if (!onlyChanges) return rows;
    const keep = new Set<number>();
    rows.forEach((r, i) => {
      if (r.kind === "same") return;
      for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < rows.length) keep.add(k);
    });
    return rows.filter((_, i) => keep.has(i));
  }, [rows, onlyChanges]);

  const lang = file.split(".").pop()?.toLowerCase() || "";

  return (
    <div className="diff">
      <div className="diff-bar">
        <span className="diff-title" title={file}>
          {file.split("/").pop()}
        </span>
        <span className="diff-vs">working copy vs HEAD</span>
        <span className="diff-stat">
          <b className="add">+{stats.added}</b> <b className="del">−{stats.removed}</b>
        </span>
        <span className="ide-tabs-fill" />
        <button className={`find-btn${onlyChanges ? " on" : ""}`} onClick={() => setOnlyChanges((v) => !v)}>
          {onlyChanges ? "Changes only" : "Full file"}
        </button>
        <button className="find-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {loading && <div className="ide-empty">Comparing…</div>}
      {err && <div className="diff-err">{err}</div>}

      {rows && !err && (
        <div className="diff-body">
          <div className="diff-head">
            <span className="diff-gutter" />
            <span>HEAD</span>
            <span className="diff-gutter" />
            <span>Working copy</span>
          </div>
          <div className="diff-rows">
            {shown.map((r, i) => (
              <div key={i} className={`diff-row ${r.kind}`}>
                <span className="diff-gutter">{r.leftNo ?? ""}</span>
                <span className="diff-cell">
                  {r.left !== undefined ? highlight(r.left, lang) || r.left : ""}
                </span>
                <span className="diff-gutter">{r.rightNo ?? ""}</span>
                <span className="diff-cell">
                  {r.right !== undefined ? highlight(r.right, lang) || r.right : ""}
                </span>
              </div>
            ))}
            {shown.length === 0 && <div className="ide-empty">No differences.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
