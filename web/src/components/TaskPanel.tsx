import type { Task, CronJob } from "../types";

const MARK: Record<Task["status"], string> = {
  pending: "○",
  in_progress: "▸",
  completed: "✓",
  failed: "✕",
  cancelled: "–",
};

export function TaskPanel({ tasks, crons }: { tasks: Task[]; crons: CronJob[] }) {
  if (!tasks.length && !crons.length) return null;
  return (
    <div className="task-panel">
      {tasks.length > 0 && (
        <>
          <div className="todo-header">
            <span className="todo-title">Tasks</span>
            <span className="todo-progress">
              {tasks.filter((t) => t.status === "completed").length}/{tasks.length}
            </span>
          </div>
          <ul className="todo-list">
            {tasks.map((t) => (
              <li key={t.id} className={`todo-item todo-${t.status === "in_progress" ? "in_progress" : t.status === "completed" ? "completed" : "pending"}`}>
                <span className="todo-mark">{MARK[t.status]}</span>
                <span className="todo-text">
                  {t.subject}
                  {t.owner ? <em className="task-owner"> · {t.owner}</em> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {crons.length > 0 && (
        <>
          <div className="todo-header" style={{ marginTop: tasks.length ? 10 : 0 }}>
            <span className="todo-title">Scheduled</span>
            <span className="todo-progress">{crons.length}</span>
          </div>
          <ul className="todo-list">
            {crons.map((c) => (
              <li key={c.id} className="todo-item todo-pending">
                <span className="todo-mark">⏱</span>
                <span className="todo-text" title={c.prompt}>
                  {c.schedule} — {c.prompt.slice(0, 48)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
