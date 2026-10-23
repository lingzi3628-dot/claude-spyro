/**
 * The IDE's own title bar — deliberately NOT the chat topbar.
 *
 * An IDE should be usable on its own, so this carries only what a developer
 * needs at a glance: which project, which model, what permissions the agent
 * currently has, and how to get out. The agent's settings, plugins,
 * checkpoints and thinking controls stay in the chat view.
 */
export function IdeTitleBar({
  cwd,
  onHome,
  onChat,
  onCloseFolder,
  model,
  provider,
  permissionMode,
  running,
  chatOpen,
  onToggleChat,
}: {
  cwd: string;
  onHome: () => void;
  onChat: () => void;
  /** Close the current folder and show the Open Folder start screen. */
  onCloseFolder: () => void;
  model?: string;
  provider?: string;
  permissionMode: string;
  running: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const name = cwd.split("/").filter(Boolean).pop() || cwd || "workspace";

  const perm =
    permissionMode === "bypass"
      ? { label: "Bypass", cls: "danger" }
      : permissionMode === "acceptEdits"
        ? { label: "Accept edits", cls: "warn" }
        : permissionMode === "plan"
          ? { label: "Plan only", cls: "info" }
          : { label: "Ask first", cls: "safe" };

  return (
    <header className="ide-title">
      <button className="ide-title-home" onClick={onHome} title="Back to projects">
        ‹ Projects
      </button>
      <button className="ide-title-name" onClick={onCloseFolder} title={`${cwd}\nClick to close this folder`}>
        {name}
        <span className="ide-title-close">×</span>
      </button>

      <div className="ide-title-spacer" />

      {running && <span className="ide-title-busy">working…</span>}

      {model && (
        <span className="ide-title-chip" title={`${provider}/${model}`}>
          {model.length > 26 ? model.slice(0, 25) + "…" : model}
        </span>
      )}

      <span className={`ide-title-perm ${perm.cls}`} title="What the agent may do without asking">
        {perm.label}
      </span>

      <button className={`ide-title-chat${chatOpen ? " on" : ""}`} onClick={onToggleChat}>
        {chatOpen ? "Hide agent" : "Show agent"}
      </button>

      <button className="ide-title-exit" onClick={onChat} title="Leave the IDE and open the chat">
        Chat view
      </button>
    </header>
  );
}
