import { useMemo, useState, createElement, type ReactNode } from "react";
import { highlight, normalizeLang, hasHighlight } from "../highlight";

interface Block {
  type: "text" | "code";
  content: string;
  lang?: string;
}

function splitCode(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) blocks.push({ type: "text", content: text.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1], content: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) blocks.push({ type: "text", content: text.slice(last) });
  return blocks;
}

const INLINE_RE =
  /(!\[[^\]]*\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;

function inline(s: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(s))) {
    if (m.index > last) nodes.push(s.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="inline-code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("![")) {
      const mm = /!\[([^\]]*)\]\(([^)]+)\)/.exec(tok);
      if (mm) {
        nodes.push(<InlineImage key={key} alt={mm[1]} src={mm[2]} />);
      } else {
        nodes.push(tok);
      }
    } else if (tok.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      nodes.push(
        <a key={key} href={mm?.[2] || "#"} target="_blank" rel="noreferrer">
          {mm?.[1] || tok}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return nodes;
}

const isRule = (t: string) => /^(-{3,}|\*{3,}|_{3,})$/.test(t);
const isHeading = (t: string) => /^#{1,6}\s+/.test(t);
const isUl = (t: string) => /^([-*+])\s+/.test(t);
const isOl = (t: string) => /^\d+\.\s+/.test(t);

function renderText(content: string): ReactNode[] {
  const lines = content.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const inl = (s: string) => inline(s, `t${k}_`);
  const push = (node: ReactNode) => {
    out.push(node);
  };

  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "") {
      i++;
      continue;
    }

    const hm = /^(#{1,6})\s+(.*)$/.exec(t);
    if (hm) {
      const level = hm[1].length;
      push(
        createElement(
          `h${level}`,
          { key: k++, className: "md-h" },
          inl(hm[2]),
        ),
      );
      i++;
      continue;
    }

    if (isRule(t)) {
      push(<hr key={k++} className="md-hr" />);
      i++;
      continue;
    }

    if (t.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      push(
        <blockquote key={k++} className="md-quote">
          {inl(buf.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (isUl(t)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^([-*+])\s+/, ""));
        i++;
      }
      push(
        <ul key={k++} className="md-ul">
          {items.map((it, j) => (
            <li key={j}>{inl(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (isOl(t)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      push(
        <ol key={k++} className="md-ol">
          {items.map((it, j) => (
            <li key={j}>{inl(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length) {
      const lt = lines[i].trim();
      if (
        lt === "" ||
        isHeading(lt) ||
        isRule(lt) ||
        lt.startsWith(">") ||
        isUl(lt) ||
        isOl(lt)
      )
        break;
      buf.push(lines[i]);
      i++;
    }
    push(
      <p key={k++} className="text-block">
        {inl(buf.join("\n"))}
      </p>,
    );
  }

  return out;
}

/** An image in the transcript: lazy, click to enlarge. */
function InlineImage({ alt, src }: { alt: string; src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img className="md-image" src={src} alt={alt} loading="lazy" onClick={() => setOpen(true)} />
      {open && (
        <div className="lightbox" onClick={() => setOpen(false)}>
          <img src={src} alt={alt} />
          <button className="lightbox-x" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
      )}
    </>
  );
}

/** A fenced code block: language chip, syntax colours, and copy. */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const label = normalizeLang(lang) === "txt" ? "" : (lang || "").toLowerCase();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className={`code-block${hasHighlight(lang) ? " hl" : ""}`}>
      <div className="code-head">
        <span className="code-lang">{label}</span>
        <button className="code-copy" onClick={copy} title="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitCode(text), [text]);
  return (
    <div className="markdown">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <CodeBlock key={i} code={b.content} lang={b.lang} />
        ) : (
          <div key={i} className="md-text">
            {renderText(b.content)}
          </div>
        ),
      )}
    </div>
  );
}
