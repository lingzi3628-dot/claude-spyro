export function ApprovalDialog({
  name,
  args,
  preview,
  onDecision,
}: {
  name: string;
  args: Record<string, any>;
  preview?: string;
  onDecision: (approved: boolean) => void;
}) {
  return (
    <div className="approval-bar">
      <div className="approval-text">
        <strong>Permission required</strong>
        <span> The agent wants to run </span>
        <code>{name}</code>
        {preview && <pre className="approval-preview">{preview}</pre>}
      </div>
      <div className="approval-actions">
        <button className="btn-danger" onClick={() => onDecision(false)}>
          Deny
        </button>
        <button className="btn-primary" onClick={() => onDecision(true)}>
          Allow
        </button>
      </div>
    </div>
  );
}
