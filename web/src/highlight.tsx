import type { ReactNode } from "react";

/**
 * A small, dependency-free syntax highlighter.
 *
 * Deliberately not a full parser: it tokenises with one combined regex and
 * colours the pieces. That's enough to make code blocks readable without
 * pulling a 100 kB library into a bundle that ships inside a desktop app.
 */

type Lang = "js" | "ts" | "json" | "py" | "sh" | "html" | "css" | "sql" | "go" | "rust" | "yaml" | "md" | "txt";

const ALIASES: Record<string, Lang> = {
  js: "js", jsx: "js", javascript: "js", mjs: "js", cjs: "js",
  ts: "ts", tsx: "ts", typescript: "ts",
  json: "json", jsonc: "json",
  py: "py", python: "py",
  sh: "sh", bash: "sh", zsh: "sh", shell: "sh", console: "sh",
  html: "html", xml: "html", svg: "html", vue: "html",
  css: "css", scss: "css",
  sql: "sql",
  go: "go", golang: "go",
  rs: "rust", rust: "rust",
  yaml: "yaml", yml: "yaml",
  md: "md", markdown: "md",
  txt: "txt", text: "txt", plaintext: "txt", "": "txt",
};

const KEYWORDS: Partial<Record<Lang, string>> = {
  js: "const let var function return if else for while class extends new await async import export from default try catch finally throw typeof instanceof of in null undefined true false this super yield delete void static get set",
  ts: "const let var function return if else for while class extends implements interface type enum new await async import export from default try catch finally throw typeof instanceof of in null undefined true false this super yield keyof readonly public private protected as satisfies",
  json: "true false null",
  py: "def class return if elif else for while import from as try except finally raise with lambda None True False and or not in is pass break continue yield global nonlocal assert async await del",
  sh: "if then else elif fi for while do done case esac function return export local echo cd ls exit set source",
  css: "",
  html: "",
  sql: "select from where insert into update delete create table drop alter join left right inner outer on group by order by having limit offset and or not null values set distinct " +
    "SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE DROP ALTER JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET AND OR NOT NULL VALUES SET DISTINCT",
  go: "func package import var const type struct interface map chan go defer return if else for range switch case break continue nil true false",
  rust: "fn let mut const struct enum impl trait pub use mod match if else for while loop return self Self crate super true false Some None Ok Err",
  yaml: "",
  md: "",
  txt: "",
};

const TYPES: Partial<Record<Lang, string>> = {
  js: "string number boolean object symbol bigint undefined",
  ts: "string number boolean object symbol bigint undefined any unknown never void",
  json: "string number boolean object",
  py: "str int float bool list dict set tuple bytes",
  go: "string int int64 float64 bool byte rune error any",
  rust: "str String i32 i64 u8 u64 usize f32 f64 bool char Vec Option Result",
};

const LITERALS = new Set(["true", "false", "null", "undefined", "None", "True", "False", "nil", "nil"]);

/** Ordered so comments/strings win over keywords inside them. */
function buildRe(lang: Lang): RegExp {
  const kw = KEYWORDS[lang] || "";
  const ty = TYPES[lang] || "";
  return new RegExp(
    [
      // Quoted object keys (JSON/TS) must be tried before plain strings,
      // otherwise "a": 1 colours the key as a value. Written with String.raw
      // so the escaping is readable.
      String.raw`(?<key>"(?:[^"\\\n]|\\.)*"(?=\s*:))`,
      String.raw`(?<comment>//[^\n]*|#[^\n]*|/\*[\s\S]*?\*/|<!--[\s\S]*?-->|--[^\n]*)`,
      String.raw`(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`" + String.raw`(?:[^` + "`" + String.raw`\\]|\\.)*` + "`" + String.raw`)`,
      String.raw`(?<number>\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b0x[0-9a-fA-F]+\b)`,
      kw ? `(?<keyword>\\b(?:${kw.split(" ").join("|")})\\b)` : "",
      ty ? `(?<type>\\b(?:${ty.split(" ").join("|")})\\b)` : "",
      "(?<fn>\\b[A-Za-z_$][\\w$]*(?=\\())",
      "(?<prop>\\b[A-Za-z_$][\\w$]*(?=\\s*:))",
      "(?<tag></?[A-Za-z][\\w-]*)",
      "(?<plain>[A-Za-z_$][\\w$]*|[^\\w\\s]|\\s+)",
    ]
      .filter(Boolean)
      .join("|"),
    "g",
  );
}

const cache = new Map<Lang, RegExp>();

export function normalizeLang(info?: string): Lang {
  const key = (info || "").trim().toLowerCase().split(/\s+/)[0];
  return ALIASES[key] ?? "txt";
}

/** Returns highlighted spans plus a plain-text copy for copying. */
export function highlight(code: string, info?: string): ReactNode[] {
  const lang = normalizeLang(info);
  if (lang === "txt" || !code) return [code];

  let re = cache.get(lang);
  if (!re) {
    re = buildRe(lang);
    cache.set(lang, re);
  }
  // lastIndex must reset: the same RegExp instance is cached across calls.
  re.lastIndex = 0;

  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of code.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out.push(code.slice(last, idx));
    const g = m.groups || {};
    let cls: string | null = null;
    for (const [name, value] of Object.entries(g)) {
      if (value !== undefined) {
        cls = LITERALS.has(value) ? "lit" : name === "key" ? "prop" : name;
        break;
      }
    }
    const text = m[0];
    if (cls && cls !== "plain") {
      out.push(
        <span key={key++} className={`tok-${cls}`}>
          {text}
        </span>,
      );
    } else {
      out.push(text);
    }
    last = idx + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function hasHighlight(info?: string): boolean {
  return normalizeLang(info) !== "txt";
}