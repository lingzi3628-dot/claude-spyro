import { useState } from "react";

const LABELS: Record<string, string> = {
  bash: "Bash",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  multi_edit: "MultiEdit",
  multiedit: "MultiEdit",
  glob: "Glob",
  grep: "Grep",
  list_dir: "List",
  webfetch: "WebFetch",
  web_search: "WebSearch",
  task: "Task",
  todo_write: "TodoWrite",
  notebook_read: "NotebookRead",
  notebook_edit: "NotebookEdit",
  bash_output: "BashOutput",
  kill_shell: "KillShell",
};

function label(name: string): string {
  if (LABELS[name]) return LABELS[name];
  if (name.startsWith("mcp__")) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function argSummary(name: string, args: Record<string, any>): string {
  switch (name) {
    case "bash":
      return String(args.command || "");
    case "bash_output":
    case "kill_shell":
      return String(args.shell_id || args.id || "");
    case "read_file":
    case "write_file":
    case "edit_file":
    case "notebook_read":
    case "notebook_edit":
      return String(args.path || args.file_path || "");
    case "multi_edit":
    case "multiedit":
      return String(args.path || args.file_path || "");
    case "glob":
      return String(args.pattern || "");
    case "grep":
      return `${args.pattern}${args.include ? ` (${args.include})` : ""}`;
    case "list_dir":
      return String(args.path || ".");
    case "webfetch":
      return String(args.url || "");
    case "web_search":
    case "task":
      return String(args.query || args.prompt || args.description || "");
    default: {
      const s = JSON.stringify(args);
      return s.length > 100 ? s.slice(0, 100) + "…" : s;
    }
  }
}

/**
 * A useful one-line summary of a tool result.
 *
 * `read` returns numbered lines ("   1: use strict;"), so taking the first
 * line verbatim made every file read look identical — five reads in a row
 * rendered as five copies of "1: use strict;". Report the size instead, and
 * show the first line that actually carries content.
 */
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  return `${Math.round(n / 102.4) / 10} KB`;
}

function firstLine(s: string, name?: string): string {
  const raw = s.trim();
  if (!raw) return "empty";

  const all = raw.split("\n");
  const numbered = all.filter((l) => /^\s*\d+:/.test(l));
  if (numbered.length && numbered.length === all.length) {
    const lines = numbered.length;
    const bodies = numbered.map((l) => l.replace(/^\s*\d+:\s?/, "").trim());
    // A single short line is just... the line. Reporting "1 lines · 0 KB"
    // tells the reader nothing at all.
    if (lines === 1) return bodies[0] ? truncate(bodies[0], 110) : "empty";
    const first = bodies.find((l) => l.length > 3);
    if (!first) return `${lines} lines · ${formatBytes(raw.length)}`;
    return `${lines} lines · ${truncate(first, 70)}`;
  }

  if (/^(Found|No matches|Error)/.test(raw)) {
    const line = raw.split("\n")[0];
    return line.length > 130 ? line.slice(0, 130) + "…" : line;
  }

  const line = raw.split("\n")[0] ?? "";
  return line.length > 130 ? line.slice(0, 130) + "…" : line;
}

function diffStats(diff?: string): { add: number; del: number } | null {
  if (!diff) return null;
  let add = 0;
  let del = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  }
  return { add, del };
}

function editDiff(args: Record<string, any>): string {
  const del = String(args.old_string || "")
    .split("\n")
    .map((l) => "- " + l)
    .join("\n");
  const add = String(args.new_string || "")
    .split("\n")
    .map((l) => "+ " + l)
    .join("\n");
  return [del, add].filter(Boolean).join("\n");
}

function Diff({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split("\n").map((l, i) => {
        let cls = "diff-line";
        if (l.startsWith("@@")) cls += " diff-hunk";
        else if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ")) cls += " diff-meta";
        else if (l.startsWith("+")) cls += " diff-add";
        else if (l.startsWith("-")) cls += " diff-del";
        return (
          <span key={i} className={cls}>
            {l}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

export function ToolCard({
  name,
  args,
  result,
  status,
  diff,
}: {
  name: string;
  args: Record<string, any>;
  result?: string;
  status: "running" | "done" | "denied";
  diff?: string;
}) {
  const [open, setOpen] = useState(false);
  const stats = diffStats(diff);
  const bodyDiff = diff || (name === "edit_file" && args.old_string !== undefined ? editDiff(args) : undefined);

  const preview =
    status === "running"
      ? "Running…"
      : status === "denied"
        ? "Denied"
        : stats
          ? `Added ${stats.add} lines, removed ${stats.del} lines`
          : result !== undefined
            ? firstLine(result, name)
            : "Done";

  const hasBody = Boolean(bodyDiff) || result !== undefined;

  return (
    <div className="tool">
      <div className="tool-line" onClick={() => hasBody && setOpen((o) => !o)}>
        <span className={`tool-dot ${status}`}>⏺</span>
        <span className="tool-call">
          <span className="tool-name">{label(name)}</span>
          <span className="tool-arg">({argSummary(name, args)})</span>
        </span>
        {status === "running" && <span className="tool-spinner" />}
        {status === "denied" && <span className="tool-denied">denied</span>}
        {hasBody && <span className="tool-chevron">{open ? "▾" : "▸"}</span>}
      </div>

      {!open && (
        <div className="tool-out">
          <span className="tool-elbow">⎿</span>
          <span className="tool-preview">{preview}</span>
        </div>
      )}

      {open && hasBody && (
        <div className="tool-out">
          <span className="tool-elbow">⎿</span>
          <div className="tool-body">
            {bodyDiff && <Diff text={bodyDiff} />}
            {result !== undefined && (
              <pre className="tool-result">{result.slice(0, 6000)}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
