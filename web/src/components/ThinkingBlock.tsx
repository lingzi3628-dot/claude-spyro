import { useEffect, useRef, useState } from "react";

function fmtMs(ms: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/**
 * Chain-of-thought for one turn.
 *
 * Sits directly above the answer it produced — not floating above the whole
 * conversation — and is labelled with how long the thinking took rather than a
 * character count, which tells the user nothing.
 */
export function ThinkingBlock({
  text,
  ms,
  live,
}: {
  text: string;
  ms?: number;
  /** True while the model is still thinking: open and updating. */
  live?: boolean;
}) {
  const [open, setOpen] = useState(!!live);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasLive = useRef(!!live);

  // Follow the stream while thinking.
  useEffect(() => {
    if (live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, live]);

  // Collapse when the answer starts arriving, unless the user opened it.
  useEffect(() => {
    if (wasLive.current && !live) setOpen(false);
    wasLive.current = !!live;
  }, [live]);

  if (!text?.trim()) return null;

  const label = live
    ? "Thinking…"
    : ms
      ? `Thought for ${fmtMs(ms)}`
      : "Thought";

  return (
    <div className={`thinking${live ? " live" : ""}`}>
      <button className="thinking-head" onClick={() => setOpen((o) => !o)}>
        <span className="thinking-caret">{open ? "▾" : "▸"}</span>
        <span className="thinking-label">{label}</span>
        {!open && <span className="thinking-peek">{text.trim().slice(0, 90)}…</span>}
      </button>
      {open && (
        <div className="thinking-body" ref={bodyRef}>
          {text}
          {live && <span className="thinking-cursor" />}
        </div>
      )}
    </div>
  );
}