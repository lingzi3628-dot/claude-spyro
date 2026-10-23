import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { } from "./shell.js";

/**
 * Minimal Language Server Protocol client (stdio, JSON-RPC 2.0).
 *
 * Launches a language server, speaks LSP over stdin/stdout, and exposes the
 * handful of requests the agent needs: diagnostics, definition, references,
 * hover, and symbols.
 */

export interface LspDiagnostic {
  file: string;
  line: number;
  character: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

/** Locate a language-server binary, preferring a project-local install. */
export function findServer(command: string): string | undefined {
  const candidates = [
    join(process.cwd(), "node_modules", ".bin", command),
    join(homedir(), ".npm-global", "bin", command),
    `/usr/local/bin/${command}`,
    `/usr/bin/${command}`,
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return undefined;
}

export class LspClient {
  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private initialized = false;
  private opened = new Set<string>();

  constructor(
    readonly languageId: string,
    readonly command: string,
    readonly args: string[],
  ) {}

  get running(): boolean {
    return this.initialized && !!this.child && !this.child.killed;
  }

  start(): void {
    if (this.child) return;
    this.child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.child.stdout?.on("data", (d) => this.onData(d.toString()));
    this.child.on("error", (e) => this.failAll(new Error(`${this.command}: ${e.message}`)));
    this.child.on("close", () => this.failAll(new Error(`${this.command} exited`)));
    this.initialized = true;
  }

  private onData(str: string): void {
    this.buffer += str;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.startsWith("{")) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      // Server-initiated notification.
      if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
        this.diagnostics.set(msg.params.uri, normalize(msg.params));
        continue;
      }
      // A request from the server that we can answer trivially.
      if (msg.id !== undefined && msg.method) {
        this.send({ jsonrpc: "2.0", id: msg.id, result: null });
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.initialized = false;
  }

  private send(obj: Record<string, any>): void {
    if (!this.child?.stdin?.writable) throw new Error("LSP server is not running");
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  private request(method: string, params: any, timeoutMs = 20_000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (err: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async initialize(root: string): Promise<void> {
    this.start();
    await this.request("initialize", {
      processId: process.pid,
      rootUri: `file://${root}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          definition: {},
          references: {},
          hover: {},
          documentSymbol: {},
        },
      },
      workspaceFolders: [{ uri: `file://${root}`, name: "workspace" }],
    });
    this.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  }

  /** Tell the server about a file (idempotent). */
  async openFile(uri: string, languageId: string, text: string): Promise<void> {
    if (this.opened.has(uri)) return;
    this.opened.add(uri);
    this.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId, version: 1, text } },
    });
  }

  async definition(uri: string, line: number, character: number): Promise<any> {
    return this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async references(uri: string, line: number, character: number): Promise<any> {
    return this.request("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  async hover(uri: string, line: number, character: number): Promise<any> {
    return this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async documentSymbols(uri: string): Promise<any> {
    return this.request("textDocument/documentSymbol", { textDocument: { uri } });
  }

  diagnosticsFor(uri: string): LspDiagnostic[] {
    return this.diagnostics.get(uri) || [];
  }

  stop(): void {
    try {
      this.send({ jsonrpc: "2.0", id: this.nextId++, method: "shutdown", params: null });
      this.send({ jsonrpc: "2.0", method: "exit", params: null });
    } catch {
      // ignore
    }
    try {
      this.child?.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.child = null;
    this.initialized = false;
    this.opened.clear();
  }
}

/**
 * Map LSP DiagnosticSeverity to our labels.
 * LSP: 1 = Error, 2 = Warning, 3 = Information, 4 = Hint (0 is unset).
 * Index 0 stays undefined so a missing severity does not become an error.
 */
const SEVERITY: (LspDiagnostic["severity"] | undefined)[] = [
  undefined,
  "error",
  "warning",
  "info",
  "hint",
];

function normalize(params: any): LspDiagnostic[] {
  return (params.diagnostics || []).map((d: any) => ({
    file: decodeURI(params.uri || "").replace("file://", ""),
    line: (d.range?.start?.line ?? 0) + 1,
    character: (d.range?.start?.character ?? 0) + 1,
    severity: SEVERITY[d.severity] ?? "info",
    message: d.message || "",
    source: d.source,
  }));
}

export function decodeURI(u: string): string {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
}