import { useMemo, useState } from "react";
import { GUIDE } from "../guide";
import { Markdown } from "./Markdown";

export function GuidePanel({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(GUIDE[0].id);
  const [query, setQuery] = useState("");

  const section = GUIDE.find((s) => s.id === active) ?? GUIDE[0];

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return GUIDE.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.body.some((b) => b.toLowerCase().includes(q)),
    ).map((s) => ({ id: s.id, title: s.title, summary: s.summary }));
  }, [query]);

  return (
    <div className="modal-overlay guide-overlay" onClick={onClose}>
      <div className="modal guide" onClick={(e) => e.stopPropagation()}>
        <div className="guide-head">
          <h2>Guide</h2>
          <input
            className="guide-search"
            autoFocus
            placeholder="Search the guide…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="guide-close" onClick={onClose} aria-label="Close guide">
            ✕
          </button>
        </div>

        {results ? (
          <div className="guide-results">
            {results.length === 0 && (
              <div className="guide-empty">No matches for “{query}”.</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                className="guide-result"
                onClick={() => {
                  setActive(r.id);
                  setQuery("");
                }}
              >
                <strong>{r.title}</strong>
                <span>{r.summary}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="guide-body">
            <nav className="guide-nav">
              {GUIDE.map((s) => (
                <button
                  key={s.id}
                  className={`guide-nav-item ${s.id === active ? "active" : ""}`}
                  onClick={() => setActive(s.id)}
                >
                  <span className="guide-nav-icon">{s.icon}</span>
                  <span className="guide-nav-text">
                    <span className="guide-nav-title">{s.title}</span>
                    <span className="guide-nav-sum">{s.summary}</span>
                  </span>
                </button>
              ))}
            </nav>

            <article className="guide-article">
              <h3>
                <span className="guide-nav-icon">{section.icon}</span> {section.title}
              </h3>
              {section.body.map((p, i) => (
                <Markdown key={i} text={p} />
              ))}
            </article>
          </div>
        )}
      </div>
    </div>
  );
}