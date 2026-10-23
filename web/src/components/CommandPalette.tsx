import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return actions.slice(0, 40);
    const scored = actions
      .map((a) => {
        const l = a.label.toLowerCase();
        let s = -1;
        if (l.startsWith(query)) s = 100;
        else if (l.includes(query)) s = 60;
        else if ((a.hint || "").toLowerCase().includes(query)) s = 30;
        else {
          let i = 0;
          for (const ch of l) if (ch === query[i]) i++;
          if (i === query.length) s = 15;
        }
        return { a, s };
      })
      .filter((x) => x.s >= 0)
      .sort((x, y) => y.s - x.s);
    return scored.slice(0, 40).map((x) => x.a);
  }, [q, actions]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  if (!open) return null;

  const pick = (a?: PaletteAction) => {
    if (!a) return;
    a.run();
    onClose();
  };

  return (
    <div className="modal-overlay pal-overlay" onClick={onClose}>
      <div className="modal pal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="pal-input"
          placeholder="Search commands and files…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[idx]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />

        <div className="pal-list">
          {results.length === 0 && <div className="pal-empty">No matches.</div>}
          {results.map((a, i) => (
            <button
              key={a.id}
              className={`pal-item ${i === idx ? "on" : ""}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(a)}
            >
              <span className="pal-item-label">{a.label}</span>
              {a.hint && <span className="pal-item-hint">{a.hint}</span>}
            </button>
          ))}
        </div>

        <div className="pal-foot">
          <span>↑↓ move</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}