import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import type { Tool } from "./types.js";
import { LspClient, findServer, decodeURI } from "../infra/lsp.js";
import { safeResolve } from "./types.js";

/** Language servers we know how to launch, keyed by file extension. */
const SERVERS: { exts: string[]; languageId: string; command: string; args: string[] }[] = [
  { exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], languageId: "typescript", command: "typescript-language-server", args: ["--stdio"] },
  { exts: [".py"], languageId: "python", command: "pylsp", args: [] },
  { exts: [".go"], languageId: "go", command: "gopls", args: ["serve"] },
  { exts: [".rs"], languageId: "rust", command: "rust-analyzer", args: [] },
  { exts: [".c", ".h", ".cc", ".cpp", ".hpp"], languageId: "c", command: "clangd", args: [] },
  { exts: [".java"], languageId: "java", command: "jdtls", args: [] },
];

function pickServer(file: string) {
  const ext = extname(file).toLowerCase();
  return SERVERS.find((s) => s.exts.includes(ext));
}

/** Lazily launches one language server per language. */
export class LspManager {
  private clients = new Map<string, LspClient>();
  private roots = new Map<string, string>();

  /**
   * Available language servers. Availability is a property of what is on the
   * machine, not of the folder being edited, so `cwd` is not consulted.
   */
  static available(_cwd: string): { languageId: string; command: string; installed: boolean }[] {
    return SERVERS.map((s) => ({
      languageId: s.languageId,
      command: s.command,
      installed: !!findServer(s.command),
    }));
  }

  async clientFor(file: string, cwd: string): Promise<{ client?: LspClient; reason?: string }> {
    const spec = pickServer(file);
    if (!spec) return { reason: `No language server configured for ${extname(file) || "this file type"}.` };
    const bin = findServer(spec.command);
    if (!bin) {
      return {
        reason:
          `The ${spec.languageId} language server (${spec.command}) is not installed. ` +
          `Install it (e.g. \`npm i -g typescript-language-server typescript\`) and try again.`,
      };
    }

    let client = this.clients.get(spec.languageId);
    if (!client || !client.running) {
      client = new LspClient(spec.languageId, bin, spec.args);
      this.clients.set(spec.languageId, client);
      this.roots.set(spec.languageId, cwd);
      try {
        await client.initialize(cwd);
      } catch (err: any) {
        this.clients.delete(spec.languageId);
        return {
          reason:
            `Failed to start ${spec.command}: ${err?.message || String(err)}. ` +
            `The server may be incompatible with this Node version or blocked by the sandbox.`,
        };
      }
    }

    const abs = safeResolve(cwd, file);
    if (existsSync(abs)) {
      try {
        const text = await readFile(abs, "utf8");
        await client.openFile(`file://${abs}`, spec.languageId, text);
      } catch {
        // ignore unreadable files
      }
    }
    return { client, reason: undefined };
  }

  stopAll(): void {
    for (const c of this.clients.values()) c.stop();
    this.clients.clear();
    this.roots.clear();
  }
}

export const manager = new LspManager();

function posArgs(args: any, cwd: string): { error: string } | { file: string; line: number; character: number; cwd: string } {
  const file = String(args.file || args.path || "");
  const line = Number(args.line);
  const character = Number(args.character ?? args.column);
  if (!file) return { error: "Error: file is required." };
  if (!Number.isInteger(line) || line < 1) return { error: "Error: line is required (1-based)." };
  const characterCol = Number.isInteger(character) && character >= 0 ? character : 0;
  return { file, line: line - 1, character: characterCol, cwd };
}

export const lspDefinitionTool: Tool = {
  name: "lsp_definition",
  description:
    "Go to the definition of the symbol at a position using a real language server. More accurate than " +
    "grepping, because it understands scope, types, and re-exports.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "File path." },
      line: { type: "number", description: "Line number (1-based)." },
      character: { type: "number", description: "Column (0-based)." },
    },
    required: ["file", "line"],
  },
  async execute(args, ctx) {
    const p = posArgs(args, ctx.cwd);
    if ("error" in p) return p.error;
    const { client, reason } = await manager.clientFor(p.file, ctx.cwd);
    if (!client) return reason || "Language server unavailable.";
    const uri = `file://${safeResolve(ctx.cwd, p.file)}`;
    try {
      const res = await client.definition(uri, p.line, p.character);
      const list = Array.isArray(res) ? res : res ? [res] : [];
      if (!list.length) return "No definition found.";
      return list
        .map((d: any) => {
          const u = decodeURI(d.uri || d.targetUri || "");
          const l = (d.range?.start?.line ?? d.targetSelectionRange?.start?.line ?? 0) + 1;
          const c = (d.range?.start?.character ?? d.targetSelectionRange?.start?.character ?? 0) + 1;
          return `${u.replace("file://", "")}:${l}:${c}`;
        })
        .join("\n");
    } catch (err: any) {
      return `Error: ${err?.message || String(err)}`;
    }
  },
};

export const lspReferencesTool: Tool = {
  name: "lsp_references",
  description: "Find every reference to the symbol at a position using a real language server.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "File path." },
      line: { type: "number", description: "Line number (1-based)." },
      character: { type: "number", description: "Column (0-based)." },
    },
    required: ["file", "line"],
  },
  async execute(args, ctx) {
    const p = posArgs(args, ctx.cwd);
    if ("error" in p) return p.error;
    const { client, reason } = await manager.clientFor(p.file, ctx.cwd);
    if (!client) return reason || "Language server unavailable.";
    const uri = `file://${safeResolve(ctx.cwd, p.file)}`;
    try {
      const res = await client.references(uri, p.line, p.character);
      const list = Array.isArray(res) ? res : [];
      if (!list.length) return "No references found.";
      return list
        .map((d: any) => `${decodeURI(d.uri).replace("file://", "")}:${(d.range?.start?.line ?? 0) + 1}`)
        .join("\n");
    } catch (err: any) {
      return `Error: ${err?.message || String(err)}`;
    }
  },
};

export const lspHoverTool: Tool = {
  name: "lsp_hover",
  description:
    "Get the type/signature/documentation of the symbol under the cursor from the language server.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "File path." },
      line: { type: "number", description: "Line number (1-based)." },
      character: { type: "number", description: "Column (0-based)." },
    },
    required: ["file", "line"],
  },
  async execute(args, ctx) {
    const p = posArgs(args, ctx.cwd);
    if ("error" in p) return p.error;
    const { client, reason } = await manager.clientFor(p.file, ctx.cwd);
    if (!client) return reason || "Language server unavailable.";
    const uri = `file://${safeResolve(ctx.cwd, p.file)}`;
    try {
      const res = await client.hover(uri, p.line, p.character);
      const text =
        res?.contents?.value ??
        (Array.isArray(res?.contents) ? res.contents.map((c: any) => c.value).join("\n") : "");
      return text || "No hover information.";
    } catch (err: any) {
      return `Error: ${err?.message || String(err)}`;
    }
  },
};

export const lspDiagnosticsTool: Tool = {
  name: "lsp_diagnostics",
  description:
    "Get real compiler diagnostics (type errors, lint) for a file from the language server. " +
    "Run this instead of guessing whether the code type-checks.",
  parameters: {
    type: "object",
    properties: { file: { type: "string", description: "File path." } },
    required: ["file"],
  },
  async execute(args, ctx) {
    const file = String(args.file || "");
    if (!file) return "Error: file is required.";
    const abs = safeResolve(ctx.cwd, file);
    const { client, reason } = await manager.clientFor(file, ctx.cwd);
    if (!client) return reason || "Language server unavailable.";
    const uri = `file://${abs}`;
    // Give the server a moment to publish diagnostics after didOpen.
    await new Promise((r) => setTimeout(r, 900));
    const diags = client.diagnosticsFor(uri);
    if (!diags.length) return `No diagnostics reported for ${file}.`;
    return diags
      .map((d) => `${d.severity} ${abs}:${d.line}:${d.character} ${d.message}${d.source ? ` (${d.source})` : ""}`)
      .join("\n");
  },
};

export const lspSymbolsTool: Tool = {
  name: "lsp_symbols",
  description: "List the symbols (functions, classes, exports) defined in a file via the language server.",
  parameters: {
    type: "object",
    properties: { file: { type: "string", description: "File path." } },
    required: ["file"],
  },
  async execute(args, ctx) {
    const file = String(args.file || "");
    if (!file) return "Error: file is required.";
    const { client, reason } = await manager.clientFor(file, ctx.cwd);
    if (!client) return reason || "Language server unavailable.";
    const uri = `file://${safeResolve(ctx.cwd, file)}`;
    try {
      const res = await client.documentSymbols(uri);
      const list = Array.isArray(res) ? res : [];
      if (!list.length) return "No symbols found.";
      return list
        .map((s: any) => `${s.kind || ""} ${s.name} @line ${(s.range?.start?.line ?? 0) + 1}`)
        .join("\n");
    } catch (err: any) {
      return `Error: ${err?.message || String(err)}`;
    }
  },
};