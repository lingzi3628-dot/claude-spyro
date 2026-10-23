/**
 * The extension catalogue behind the marketplace.
 *
 * Each entry ships the source of a plugin file that gets written into
 * `~/.claude-free/plugins/` and loaded on next start, exactly like a VS Code
 * extension adding tools to the agent. They are plain text so the catalogue can
 * live in one readable file and stay auditable.
 */
export interface CatalogEntry {
  id: string;
  name: string;
  publisher: string;
  description: string;
  category: "web" | "data" | "code" | "devops" | "media" | "docs";
  version: string;
  installs: number;
  source: string;
}

const jsonTool = (name: string, desc: string, body: string) => `  {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(desc)},
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "Input text" } },
      required: ["text"],
    },
    async execute(args) {
${body}
    },
  },`;

export const CATALOG: CatalogEntry[] = [
  {
    id: "fetch-url",
    name: "Fetch URL",
    publisher: "spyro",
    description: "Download a web page or API response straight into the conversation as text.",
    category: "web",
    version: "1.2.0",
    installs: 18420,
    source: `export default {
  name: "fetch-url",
  tools: [
${jsonTool(
  "fetch_url",
  "Fetch a URL and return its text content (pages, JSON APIs, raw files).",
  `      const res = await fetch(args.text, {
        headers: { "user-agent": "claude-free-spyro/1.0" },
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.text();
      return \`HTTP \${res.status} \${res.statusText}\\n\${body.slice(0, 60000)}\`;`,
)},
  ],
};`,
  },
  {
    id: "json-tools",
    name: "JSON & YAML",
    publisher: "spyro",
    description: "Pretty-print, minify and convert between JSON and YAML.",
    category: "data",
    version: "2.0.1",
    installs: 26110,
    source: `export default {
  name: "json-tools",
  tools: [
    {
      name: "json_format",
      description: "Format or minify JSON. Pass mode=format (default) or mode=minify.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "JSON input" },
          mode: { type: "string", enum: ["format", "minify"] },
        },
        required: ["text"],
      },
      async execute(args) {
        const data = JSON.parse(args.text);
        return args.mode === "minify" ? JSON.stringify(data) : JSON.stringify(data, null, 2);
      },
    },
    {
      name: "json_query",
      description: "Read a value out of JSON using a dot path, e.g. users.0.email",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "JSON input" },
          path: { type: "string", description: "Dot path, e.g. data.items.2.id" },
        },
        required: ["text", "path"],
      },
      async execute(args) {
        let cur = JSON.parse(args.text);
        for (const key of args.path.split(".")) {
          cur = cur?.[key];
          if (cur === undefined) return \`No value at \${args.path}\`;
        }
        return typeof cur === "object" ? JSON.stringify(cur, null, 2) : String(cur);
      },
    },
  ],
};`,
  },
  {
    id: "code-stats",
    name: "Code Metrics",
    publisher: "spyro",
    description: "Count lines, languages, TODOs and long functions across a project.",
    category: "code",
    version: "1.0.4",
    installs: 9930,
    source: `import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "vendor"]);

function walk(dir, depth, out) {
  if (depth > 6) return;
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e) || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1, out);
    else if ([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".rb", ".php"].includes(extname(p))) out.push(p);
  }
}

export default {
  name: "code-stats",
  tools: [
    {
      name: "code_metrics",
      description: "Summarise a codebase: files, lines per language, TODO/FIXME count.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Folder to analyse" } },
        required: ["path"],
      },
      async execute(args, ctx) {
        const files = [];
        walk(args.path, 0, files);
        const byLang = {};
        let lines = 0, todos = 0;
        for (const f of files) {
          let text;
          try { text = readFileSync(f, "utf8"); } catch { continue; }
          const lang = extname(f).slice(1) || "other";
          const n = text.split("\\n").length;
          lines += n;
          byLang[lang] = (byLang[lang] || 0) + n;
          todos += (text.match(/TODO|FIXME|HACK|XXX/g) || []).length;
        }
        return JSON.stringify({ files: files.length, lines, todos, byLanguage: byLang }, null, 2);
      },
    },
  ],
};`,
  },
  {
    id: "secret-scan",
    name: "Secret Scanner",
    publisher: "spyro",
    description: "Find committed API keys, tokens and passwords before they leak.",
    category: "devops",
    version: "1.3.2",
    installs: 31200,
    source: `import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/g],
  ["OpenAI key", /sk-[A-Za-z0-9]{20,}/g],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["Generic assignment", /(password|secret|api[_-]?key|token)\\s*[:=]\\s*["'][^"'\\s]{8,}["']/gi],
];

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next"]);

function walk(dir, depth, out) {
  if (depth > 6) return;
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1, out);
    else if (/\\.(ts|tsx|js|jsx|json|env|yaml|yml|toml|py|go|rb|php)$/.test(e)) out.push(p);
  }
}

export default {
  name: "secret-scan",
  tools: [
    {
      name: "scan_secrets",
      description: "Scan a folder for leaked credentials. Reports file, line and kind.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Folder to scan" } },
        required: ["path"],
      },
      async execute(args) {
        const files = [];
        walk(args.path, 0, files);
        const hits = [];
        for (const f of files) {
          let text;
          try { text = readFileSync(f, "utf8"); } catch { continue; }
          const lines = text.split("\\n");
          lines.forEach((line, i) => {
            for (const [kind, re] of PATTERNS) {
              re.lastIndex = 0;
              if (re.test(line)) {
                const masked = line.replace(/[A-Za-z0-9_-]{12,}/g, "***");
                hits.push({ file: f, line: i + 1, kind, snippet: masked.trim().slice(0, 120) });
              }
            }
          });
        }
        if (!hits.length) return "No secrets found.";
        return JSON.stringify({ count: hits.length, findings: hits.slice(0, 100) }, null, 2);
      },
    },
  ],
};`,
  },
  {
    id: "http-client",
    name: "HTTP Client",
    publisher: "spyro",
    description: "Call any REST API with custom headers and a JSON body.",
    category: "web",
    version: "1.1.0",
    installs: 20770,
    source: `export default {
  name: "http-client",
  tools: [
    {
      name: "http_request",
      description: "Make an HTTP request. method defaults to GET; body is sent as JSON when given.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute URL" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          headers: { type: "object", description: "Request headers" },
          body: { type: "string", description: "JSON request body" },
        },
        required: ["url"],
      },
      async execute(args) {
        const init = {
          method: args.method || "GET",
          headers: { "content-type": "application/json", ...(args.headers || {}) },
          body: args.body ? JSON.stringify(args.body) : undefined,
          signal: AbortSignal.timeout(30000),
        };
        const res = await fetch(args.url, init);
        const text = await res.text();
        let pretty = text;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
        return \`\${res.status} \${res.statusText}\\n\${pretty.slice(0, 40000)}\`;
      },
    },
  ],
};`,
  },
  {
    id: "regex-lab",
    name: "Regex Lab",
    publisher: "spyro",
    description: "Test and explain regular expressions against sample text.",
    category: "code",
    version: "1.0.0",
    installs: 8240,
    source: `export default {
  name: "regex-lab",
  tools: [
    {
      name: "regex_test",
      description: "Run a regular expression against text and list every match with its position.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regular expression" },
          text: { type: "string", description: "Text to test against" },
          flags: { type: "string", description: "Flags such as g or gi" },
        },
        required: ["pattern", "text"],
      },
      async execute(args) {
        const re = new RegExp(args.pattern, args.flags || "g");
        const matches = [];
        let m;
        while ((m = re.exec(args.text)) !== null && matches.length < 200) {
          matches.push({ value: m[0], index: m.index, groups: m.slice(1) });
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        return JSON.stringify({ count: matches.length, matches }, null, 2);
      },
    },
  ],
};`,
  },
  {
    id: "md-tools",
    name: "Markdown Kit",
    publisher: "spyro",
    description: "Turn plain notes into a table of contents and a linked README.",
    category: "docs",
    version: "1.0.2",
    installs: 11560,
    source: `export default {
  name: "md-tools",
  tools: [
    {
      name: "markdown_toc",
      description: "Build a table of contents from a Markdown document's headings.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "Markdown source" } },
        required: ["text"],
      },
      async execute(args) {
        const rows = [];
        let inFence = false;
        args.text.split("\\n").forEach((line, i) => {
          if (/^\\s*\\\`\\\`\\\`/.test(line)) { inFence = !inFence; return; }
          if (inFence) return;
          const m = /^(#{1,6})\\s+(.*)$/.exec(line);
          if (!m) return;
          const depth = m[1].length;
          const title = m[2].trim();
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          rows.push(\`\${"  ".repeat(depth - 1)}- [\${title}](#\${slug})\`);
        });
        return rows.join("\\n") || "No headings found.";
      },
    },
  ],
};`,
  },
  {
    id: "img-optimize",
    name: "Image Optimiser",
    publisher: "spyro",
    description: "Report the size and dimensions of every image in a project.",
    category: "media",
    version: "1.0.0",
    installs: 6120,
    source: `import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

export default {
  name: "img-optimize",
  tools: [
    {
      name: "image_report",
      description: "List every image under a folder with its byte size, to spot bloat.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Folder to scan" } },
        required: ["path"],
      },
      async execute(args) {
        const rows = [];
        const SKIP = new Set(["node_modules", ".git", "dist", "build"]);
        const walk = (dir, depth) => {
          if (depth > 5) return;
          let entries = [];
          try { entries = readdirSync(dir); } catch { return; }
          for (const e of entries) {
            if (SKIP.has(e)) continue;
            const p = join(dir, e);
            let st;
            try { st = statSync(p); } catch { continue; }
            if (st.isDirectory()) walk(p, depth + 1);
            else if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extname(p).toLowerCase()))
              rows.push({ file: p.replace(args.path, ""), kb: Math.round(st.size / 102.4) / 10 });
          }
        };
        walk(args.path, 0);
        rows.sort((a, b) => b.kb - a.kb);
        const total = rows.reduce((n, r) => n + r.kb, 0);
        return JSON.stringify({ totalKb: Math.round(total), count: rows.length, largest: rows.slice(0, 20) }, null, 2);
      },
    },
  ],
};`,
  },
  {
    id: "git-helper",
    name: "Git Helper",
    publisher: "spyro",
    description: "Summarise branches, uncommitted work and recent history in one call.",
    category: "devops",
    version: "1.4.0",
    installs: 28940,
    source: `export default {
  name: "git-helper",
  tools: [
    {
      name: "git_overview",
      description: "One-shot view of branch, status, last 10 commits and ahead/behind.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Repository folder" } },
        required: ["path"],
      },
      async execute(args, ctx) {
        const run = async (cmd) => {
          const h = ctx.shells.start(cmd, args.path, 15000);
          let out = "";
          for (let i = 0; i < 60; i++) {
            const r = ctx.shells.read(h.id);
            if (r) { out += r.output; if (r.done) break; }
            await new Promise((r2) => setTimeout(r2, 200));
          }
          return out.trim();
        };
        const [branch, status, log, tracking] = await Promise.all([
          run("git rev-parse --abbrev-ref HEAD"),
          run("git status --porcelain"),
          run("git log --oneline -10"),
          run("git status -sb | head -1"),
        ]);
        return JSON.stringify({ branch, tracking, changedFiles: status, recentCommits: log }, null, 2);
      },
    },
  ],
};`,
  },
];

export const CATEGORIES: Record<CatalogEntry["category"], string> = {
  web: "Web",
  data: "Data",
  code: "Code",
  devops: "DevOps",
  media: "Media",
  docs: "Docs",
};
