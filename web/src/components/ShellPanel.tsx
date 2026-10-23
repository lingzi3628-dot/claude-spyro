import type { ShellInfo } from "../types";

function when(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  return `${Math.floor(diff / 3_600_000)}h`;
}

export function ShellPanel({
  shells,
  onKill,
}: {
  shells: ShellInfo[];
  onKill: (id: string) => void;
}) {
  if (!shells.length) return null;
  return (
    <div className="shell-panel">
      <div className="todo-header">
        <span className="todo-title">Background shells</span>
        <span className="todo-progress">{shells.filter((s) => !s.done).length} running</span>
      </div>
      <ul className="shell-list">
        {shells.map((s) => (
          <li key={s.id} className={`shell-item${s.done ? " done" : ""}`}>
            <span className={`shell-dot${s.done ? " done" : ""}`}>●</span>
            <span className="shell-cmd" title={s.command}>
              {s.command}
            </span>
            <span className="shell-meta">
              {s.done ? `exit ${s.exitCode ?? "?"}` : when(s.startedAt)}
            </span>
            {!s.done && (
              <button className="shell-kill" onClick={() => onKill(s.id)} title="Kill">
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
