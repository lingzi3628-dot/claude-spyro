import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { killTree } from "./shell.js";
import { getToken, setToken, needsRefresh, discoverAuth, refreshToken } from "./mcp-oauth.js";

export interface McpServerConfig {
  /** Transport type. Default "stdio". */
  type?: "stdio" | "sse" | "http";
  /** For stdio: the command to run. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** For sse/http: the endpoint URL. */
  url?: string;
  headers?: Record<string, string>;
}

export interface McpTool {
  /** Fully-qualified tool name exposed to the agent: mcp__<server>__<tool>. */
  name: string;
  /** Tool name as the server knows it. */
  remoteName: string;
  server: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpResource {
  name: string;
  server: string;
  uri: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArg {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPrompt {
  name: string;
  server: string;
  description?: string;
  arguments?: McpPromptArg[];
}

export interface McpServerInfo {
  name: string;
  transport: "stdio" | "sse" | "http";
  /** For stdio servers. */
  command?: string;
  /** For remote servers. */
  url?: string;
  connected: boolean;
  tools: number;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export const MCP_TOOL_PREFIX = "mcp__";

/** A single MCP server speaking JSON-RPC 2.0 over stdio or HTTP/SSE. */
export class McpClient {
  readonly name: string;
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private initialized = false;
  private isRemote = false;
  private url: string | null = null;
  private headers: Record<string, string> = {};
  private sessionId: string | null = null;

  constructor(name: string, private config: McpServerConfig) {
    this.name = name;
    this.isRemote = !!config.url;
    if (config.url) {
      this.url = config.url;
      this.headers = { "Content-Type": "application/json", ...(config.headers || {}) };
    }
  }

  /** Transport this server uses, derived from its config. */
  transport(): "stdio" | "sse" | "http" {
    if (!this.isRemote) return "stdio";
    return this.config.type === "sse" ? "sse" : "http";
  }

  /** Non-secret connection details for display. */
  configSummary(): { command?: string; url?: string } {
    if (this.isRemote) return { url: this.config.url };
    return {
      command: [this.config.command, ...(this.config.args || [])].filter(Boolean).join(" "),
    };
  }

  async connect(): Promise<void> {
    if (this.isRemote) {
      await this.remoteRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "claude-free", version: "0.1.0" },
      });
      this.notify("notifications/initialized", {});
      this.initialized = true;
      return;
    }
    if (!this.config?.command) throw new Error(`MCP server "${this.name}" has no command`);
    const child = spawn(this.config.command, this.config.args || [], {
      env: { ...process.env, ...(this.config.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout?.on("data", (d) => this.onData(d.toString()));
    child.stderr?.on("data", () => {
      // MCP servers often log to stderr; ignore.
    });
    child.on("error", (err) => this.failAll(new Error(`MCP "${this.name}" failed: ${err.message}`)));
    child.on("close", () => this.failAll(new Error(`MCP "${this.name}" exited`)));

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "claude-free", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  private onData(str: string): void {
    this.buffer += str;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
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
  }

  private send(obj: Record<string, any>): void {
    if (!this.child?.stdin?.writable) throw new Error(`MCP "${this.name}" is not running`);
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  private notify(method: string, params: Record<string, any>): void {
    if (this.isRemote) {
      void this.remoteSend({ jsonrpc: "2.0", method, params }).catch(() => {});
      return;
    }
    this.send({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: Record<string, any>, timeoutMs = 20_000): Promise<any> {
    if (this.isRemote) return this.remoteRequest(method, params, timeoutMs);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP "${this.name}" request ${method} timed out`));
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

  /** Add the stored OAuth bearer token, refreshing it when expired. */
  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    const token = getToken(this.name);
    if (!token?.access_token) return headers;
    if (needsRefresh(token) && token.refresh_token) {
      try {
        const meta = await discoverAuth(this.url!);
        const fresh = await refreshToken(meta, this.name, token);
        setToken(this.name, fresh);
        headers["Authorization"] = `${fresh.token_type || "Bearer"} ${fresh.access_token}`;
        return headers;
      } catch {
        // fall through and try the (possibly still-valid) access token
      }
    }
    headers["Authorization"] = `${token.token_type || "Bearer"} ${token.access_token}`;
    return headers;
  }

  /** POST a JSON-RPC request to a remote (streamable HTTP/SSE) endpoint. */
  private async remoteRequest(method: string, params: Record<string, any>, timeoutMs = 20_000): Promise<any> {
    if (!this.url) throw new Error(`MCP "${this.name}" has no url`);
    const id = this.nextId++;
    const headers = { ...this.headers, ...(await this.authHeaders()) };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await fetchWithTimeout(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }, timeoutMs);
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 202) return undefined; // notification accepted
    const text = await res.text();
    if (!text) return undefined;

    // A streamable-HTTP server may answer with SSE rather than bare JSON.
    const contentType = res.headers.get("content-type") || "";
    let msg: any;
    if (contentType.includes("text/event-stream")) {
      msg = parseSseResponse(text, id);
      if (!msg) return undefined; // the response arrived on the GET stream instead
    } else {
      msg = JSON.parse(text);
    }
    if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
    return msg.result;
  }

  private async remoteSend(obj: Record<string, any>): Promise<void> {
    if (!this.url) return;
    const headers = { ...this.headers, ...(await this.authHeaders()) };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(obj),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.initialized) return [];
    const res = await this.request("tools/list", {});
    const tools: any[] = res?.tools || [];
    return tools.map((t) => ({
      name: `${MCP_TOOL_PREFIX}${this.name}__${t.name}`,
      remoteName: t.name,
      server: this.name,
      description: t.description || `MCP tool ${t.name} from ${this.name}`,
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    }));
  }

  /** List resources exposed by this server. */
  async listResources(): Promise<McpResource[]> {
    if (!this.initialized) return [];
    try {
      const res = await this.request("resources/list", {});
      const resources: any[] = res?.resources || [];
      return resources.map((r) => ({
        name: String(r.name || r.uri || ""),
        server: this.name,
        uri: String(r.uri || ""),
        description: r.description || undefined,
        mimeType: r.mimeType || undefined,
      }));
    } catch {
      // Server does not support resources.
      return [];
    }
  }

  /** Read a resource's contents as text. */
  async readResource(uri: string): Promise<string> {
    const res = await this.request("resources/read", { uri });
    const contents: any[] = res?.contents || [];
    const parts = contents.map((c) =>
      typeof c.text === "string" ? c.text : c.blob ? `[binary ${c.mimeType || "data"}]` : "",
    );
    return parts.join("\n") || "(empty)";
  }

  /** List prompts exposed by this server. */
  async listPrompts(): Promise<McpPrompt[]> {
    if (!this.initialized) return [];
    try {
      const res = await this.request("prompts/list", {});
      const prompts: any[] = res?.prompts || [];
      return prompts.map((p) => ({
        name: String(p.name || ""),
        server: this.name,
        description: p.description || undefined,
        arguments: Array.isArray(p.arguments)
          ? p.arguments.map((a: any) => ({
              name: String(a.name || ""),
              description: a.description || undefined,
              required: a.required === true,
            }))
          : undefined,
      }));
    } catch {
      return [];
    }
  }

  /** Render a prompt with the given arguments. */
  async getPrompt(name: string, args: Record<string, string>): Promise<string> {
    const res = await this.request("prompts/get", { name, arguments: args });
    const parts: string[] = [];
    for (const p of res?.messages || []) {
      const text = p.content?.text ?? p.content?.type ?? "";
      parts.push(`${p.role}: ${text}`);
    }
    return parts.join("\n\n") || "(empty prompt)";
  }
  async callTool(remoteName: string, args: Record<string, any>): Promise<string> {
    const res = await this.request("tools/call", { name: remoteName, arguments: args }, 120_000);
    const parts: string[] = [];
    for (const item of res?.content || []) {
      if (item.type === "text") parts.push(item.text);
      else if (item.type === "resource") parts.push(`[resource] ${item.resource?.uri || ""}`);
      else parts.push(JSON.stringify(item));
    }
    if (res?.isError) return `Error from MCP "${this.name}": ${parts.join("\n")}`;
    return parts.join("\n") || "(no output)";
  }

  close(): void {
    if (this.isRemote && this.url && this.sessionId) {
      // Best-effort session termination.
      const headers = { ...this.headers, "mcp-session-id": this.sessionId };
      fetch(this.url, { method: "DELETE", headers }).catch(() => {});
      this.sessionId = null;
      this.failAll(new Error("MCP client closed"));
      return;
    }
    try {
      killTree(this.child?.pid, "SIGKILL");
    } catch {
      // ignore
    }
    this.child = null;
    this.failAll(new Error("MCP client closed"));
  }
}

/** fetch with a timeout (remote MCP endpoints can be slow). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface McpLoadResult {
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  errors: string[];
}

/** Reads MCP server configs and manages connections to all of them. */
export class McpManager {
  private clients = new Map<string, McpClient>();
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];

  async connectFromConfig(config: Record<string, McpServerConfig>): Promise<McpLoadResult> {
    this.clear();
    const tools: McpTool[] = [];
    const resources: McpResource[] = [];
    const prompts: McpPrompt[] = [];
    const errors: string[] = [];
    for (const [name, cfg] of Object.entries(config || {})) {
      try {
        const client = new McpClient(name, cfg);
        await client.connect();
        this.clients.set(name, client);
        tools.push(...(await client.listTools()));
        resources.push(...(await client.listResources()));
        prompts.push(...(await client.listPrompts()));
      } catch (err: any) {
        errors.push(`${name}: ${err?.message || String(err)}`);
      }
    }
    this.tools = tools;
    this.resources = resources;
    this.prompts = prompts;
    return { tools, resources, prompts, errors };
  }

  /** Connected servers with their transport and tool counts (for /mcp). */
  servers(): McpServerInfo[] {
    const counts = new Map<string, number>();
    for (const t of this.tools) counts.set(t.server, (counts.get(t.server) || 0) + 1);
    return [...this.clients.entries()].map(([name, client]) => ({
      name,
      transport: client.transport(),
      command: client.configSummary().command,
      url: client.configSummary().url,
      connected: true,
      tools: counts.get(name) || 0,
    }));
  }

  allTools(): McpTool[] {
    return [...this.tools];
  }

  allResources(): McpResource[] {
    return [...this.resources];
  }

  allPrompts(): McpPrompt[] {
    return [...this.prompts];
  }

  async readResource(server: string, uri: string): Promise<string> {
    const client = this.clients.get(server);
    if (!client) return `Error: MCP server "${server}" is not connected.`;
    try {
      return await client.readResource(uri);
    } catch (err: any) {
      return `Error reading MCP resource "${uri}": ${err?.message || String(err)}`;
    }
  }

  async getPrompt(server: string, name: string, args: Record<string, string>): Promise<string> {
    const client = this.clients.get(server);
    if (!client) return `Error: MCP server "${server}" is not connected.`;
    try {
      return await client.getPrompt(name, args);
    } catch (err: any) {
      return `Error getting MCP prompt "${name}": ${err?.message || String(err)}`;
    }
  }

  async callTool(server: string, remoteName: string, args: Record<string, any>): Promise<string> {
    const client = this.clients.get(server);
    if (!client) return `Error: MCP server "${server}" is not connected.`;
    try {
      return await client.callTool(remoteName, args);
    } catch (err: any) {
      return `Error calling MCP "${server}.${remoteName}": ${err?.message || String(err)}`;
    }
  }

  clear(): void {
    for (const c of this.clients.values()) c.close();
    this.clients.clear();
    this.tools = [];
    this.resources = [];
    this.prompts = [];
  }
}

/** Read MCP servers from a project `.mcp.json` plus the user's global config. */
export async function loadMcpConfig(cwd: string, extraFiles: string[] = []): Promise<Record<string, McpServerConfig>> {
  const merged: Record<string, McpServerConfig> = {};
  const paths = [
    join(homedir(), ".claude-free", "mcp.json"),
    join(cwd, ".mcp.json"),
    ...extraFiles,
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(await readFile(p, "utf8"));
      const servers = raw.mcpServers || raw.servers || {};
      for (const [name, cfg] of Object.entries(servers)) {
        if (cfg && typeof cfg === "object" && ((cfg as any).command || (cfg as any).url)) {
          merged[name] = cfg as McpServerConfig;
        }
      }
    } catch {
      // ignore malformed config
    }
  }
  return merged;
}

/** Extract the JSON-RPC response for `id` from an SSE body. */
function parseSseResponse(body: string, id: number): any | undefined {
  for (const block of body.split(/\n\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n")
      .trim();
    if (!dataLines || dataLines === "[DONE]") continue;
    try {
      const msg = JSON.parse(dataLines);
      if (msg.id === id || msg.id === undefined) return msg;
    } catch {
      // ignore malformed block
    }
  }
  return undefined;
}
