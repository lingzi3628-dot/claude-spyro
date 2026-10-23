import { useEffect, useState } from "react";

export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/**
 * The plan, shown as a card the user can watch progress against.
 * Stays pinned while work is in flight, folds away once everything is done.
 */
export function TodoPanel({ todos }: { todos: Todo[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  const active = todos.find((t) => t.status === "in_progress");
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0;
  const complete = done === todos.length;

  const [open, setOpen] = useState(true);
  // Auto-collapse when the whole plan finishes, unless the user reopened it.
  useEffect(() => {
    if (complete) setOpen(false);
    else setOpen(true);
  }, [complete]);

  return (
    <div className={`plan-card${complete ? " done" : ""}`}>
      <button className="plan-head" onClick={() => setOpen((o) => !o)}>
        <span className="plan-caret">{open ? "▾" : "▸"}</span>
        <span className="plan-label">
          {complete ? "Plan complete" : active ? "Working" : "Plan"}
        </span>
        <span className="plan-active">{open && active ? active.content : ""}</span>
        <span className="plan-count">
          {done}/{todos.length}
        </span>
      </button>

      <div className="plan-bar">
        <span className="plan-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {open && (
        <ol className="plan-list">
          {todos.map((t) => (
            <li key={t.id} className={`plan-step ${t.status}`}>
              <span className="plan-dot">
                {t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "·"}
              </span>
              <span className="plan-text">{t.content}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
