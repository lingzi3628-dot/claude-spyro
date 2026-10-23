import { useEffect, useRef } from "react";

export interface FileHit {
  path: string;
  name: string;
  isDir: boolean;
}

/**
 * Detect an `@` mention being typed at the caret and offer matching paths.
 * Returns null when the caret isn't in a mention, so the caller can close.
 */
export function detectMention(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = value.slice(0, caret);
  // The @ must start a word, otherwise an email address would trigger it.
  const m = /(?:^|\s)@([^\s@]*)$/.exec(upto);
  if (!m) return null;
  return { query: m[1], start: caret - m[1].length - 1 };
}

export function MentionMenu({
  query,
  files,
  active,
  onPick,
  position,
}: {
  query: string;
  files: FileHit[];
  active: number;
  onPick: (f: FileHit) => void;
  position: { top: number; left: number };
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (files.length === 0) return null;

  return (
    <div className="mention-menu" ref={ref} style={{ top: position.top, left: position.left }}>
      {files.map((f, i) => (
        <button
          key={f.path}
          data-i={i}
          className={`mention-item ${i === active ? "on" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault(); // don't blur the textarea before we insert
            onPick(f);
          }}
        >
          <span className="mention-icon">{f.isDir ? "▸" : "·"}</span>
          <span className="mention-path">{f.path}</span>
        </button>
      ))}
    </div>
  );
}

/** Filter paths by a fuzzy-ish match: substrings and simple subsequence. */
export function filterFiles(files: FileHit[], query: string, limit = 8): FileHit[] {
  const q = query.toLowerCase();
  if (!q) return files.filter((f) => !f.isDir).slice(0, limit);

  const scored: { f: FileHit; s: number }[] = [];
  for (const f of files) {
    const p = f.path.toLowerCase();
    const name = f.name.toLowerCase();
    let s = -1;

    const idx = p.indexOf(q);
    if (idx === 0) s = 100;
    else if (name.startsWith(q)) s = 90;
    else if (idx > 0) s = 70 - Math.min(idx, 30);
    else if (name.includes(q)) s = 60;
    else {
      // subsequence: "apx" matches "App.tsx"
      let i = 0;
      for (const ch of name) if (ch === q[i]) i++;
      if (i === q.length) s = 30;
    }
    if (s >= 0) scored.push({ f, s });
  }
  scored.sort((a, b) => b.s - a.s || a.f.path.length - b.f.path.length);
  return scored.slice(0, limit).map((x) => x.f);
}