import type { Checkpoint } from "../types";

interface Props {
  checkpoints: Checkpoint[];
  onClose: () => void;
  onRewind: (id: string) => void;
}

function when(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleTimeString();
}

export function CheckpointsPanel({ checkpoints, onClose, onRewind }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal checkpoints-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>Checkpoints</span>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="panel-hint">
          A snapshot of the conversation and every file the agent has touched is
          taken before each run. Rewind restores both.
        </div>
        {checkpoints.length === 0 && <div className="panel-empty">No checkpoints yet.</div>}
        <div className="checkpoint-list">
          {checkpoints.map((cp) => (
            <div key={cp.id} className="checkpoint-row">
              <span className="checkpoint-label">{cp.label}</span>
              {!!cp.fileCount && (
                <span className="checkpoint-files" title="Files tracked in this snapshot">
                  {cp.fileCount} file{cp.fileCount === 1 ? "" : "s"}
                </span>
              )}
              <span className="checkpoint-time">{when(cp.createdAt)}</span>
              <button className="btn-send" onClick={() => onRewind(cp.id)}>
                Rewind
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
