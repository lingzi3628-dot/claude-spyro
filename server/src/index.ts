import { installFetch } from "./infra/http.js";

// Replace the global fetch with an IPv4-forcing implementation. On hosts where
// IPv6 is broken, Node's built-in fetch times out while node:https over IPv4
// works. This must run before any provider/model/MCP code makes a request.
installFetch();

import { createServer, request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Stability guards.
 *
 * One unhandled rejection or stray exception in a long-running local server is
 * a total outage for the user — they lose the UI and have to restart. Neither
 * should ever take the process down; log and keep serving.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.stack || err?.message || err);
  // Continuing is only safe for errors that did not corrupt state; a failed
  // synchronous write or a blown heap still needs a clean exit so the desktop
  // app can show a restart rather than a half-dead window.
  const fatal = err instanceof Error && /ENOSPC|EMFILE|ENFILE|heap out of memory/i.test(String(err.message));
  if (fatal) {
    console.error("[fatal] cannot continue safely; exiting so Spyro Studio can restart cleanly.");
    process.exit(1);
  }
});

import { basename, dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { CollabHub, VIEWER_MESSAGES, isLoopback, roomFromRequest, type CollabMember, type CollabRole } from "./collab.js";
import { CATALOG } from "./plugins/catalog.js";
import { loadConfig, saveModelConfig, writeConfigFile, DEFAULT_PRESETS, DEFAULT_BASE_URLS, FREE_PROVIDER_INFO, APP_ROOT, type ModelConfig } from "./config.js";
import { createProvider } from "./providers/index.js";
import { ToolRegistry } from "./tools/index.js";
import { Agent } from "./agent/loop.js";
import { loadPlugins } from "./plugins/loader.js";
import { CommandLoader } from "./infra/commands.js";
import { AgentLoader } from "./infra/agents.js";
import { PluginManager } from "./infra/plugins.js";
import { loadProjectSettings } from "./infra/settings.js";
import { CheckpointStore } from "./infra/checkpoints.js";
import { OutputStyleLoader } from "./infra/output-styles.js";
import { runStatusLine } from "./infra/statusline.js";
import { FileSnapshotStore } from "./infra/snapshot.js";
import { checkProviders } from "./infra/provider-health.js";
import { detectSupport } from "./infra/sandbox.js";
import { shellName as resolvedShell } from "./infra/shell.js";
import {
  pkce,
  randomState,
  discoverAuth,
  registerClient,
  buildAuthorizeUrl,
  exchangeCode,
  parseCallback,
  getToken,
  setToken,
  clearToken,
  type PendingAuth,
} from "./infra/mcp-oauth.js";
import { subsetRegistry } from "./tools/index.js";
import { ensureSettings } from "./tools/agents.js";
import type { UserQuestionAnswer } from "./tools/types.js";
import { listModels } from "./models.js";
import { resolvePermissionMode, type PermissionMode } from "./config.js";
import { scanLocalServers } from "./local.js";
import { listDir, readTree, readFileForViewer, homeDir, writeTextFile, moveEntry, deleteEntry, createEntry } from "./fsapi.js";
import { findDatabases, listTables, tableSchema, runQuery, updateCell, describeDatabase, dbKind, readSqlDump } from "./dbapi.js";
import { runDiagnostics } from "./diagnostics.js";
import { Accounts } from "./accounts.js";
import { WorkspaceWatcher } from "./watcher.js";
import { urlsFromOutput, listeningPorts, labelFor, portFromCommand, type PortInfo } from "./ports.js";
import { ShellManager } from "./infra/shells.js";
import { TaskStore } from "./infra/tasks.js";
import { SkillLoader } from "./infra/skills.js";
import { McpManager, loadMcpConfig } from "./infra/mcp.js";
import { CronScheduler } from "./infra/cron.js";
import { MemoryLoader } from "./infra/memory.js";
import { SessionStore } from "./infra/sessions.js";
import { PermissionEngine, type PermissionRules, emptyRules } from "./infra/permissions.js";
import { HookRunner } from "./infra/hooks.js";
import type { Provider, ContentPart } from "./types.js";

type ClientMsg =
  | { type: "user_message"; text: string; images?: { media_type: string; data: string }[]; clientId?: string }
  | { type: "cancel" }
  | { type: "reset" }
  | { type: "force_compact" }
  | { type: "set_cwd"; path: string }
  | { type: "add_dir"; path: string }
  | { type: "remove_dir"; path: string }
  | { type: "approval_response"; id: string; approved: boolean }
  | { type: "set_model"; model: ModelConfig }
  | { type: "set_auto_approve"; value: boolean }
  | { type: "set_permissions"; permissions: PermissionRules }
  | { type: "get_state" }
  | { type: "new_session" }
  | { type: "swap_surface"; surface: "chat" | "ide" }
  | { type: "list_sessions" }
  | { type: "load_session"; id: string }
  | { type: "delete_session"; id: string }
  | { type: "kill_shell"; id: string }
  | { type: "ask_response"; id: string; answers: any[] }
  | { type: "run_command"; name: string; args?: string }
  | { type: "shell_start"; command: string; cwd: string; terminalId: string }
  | { type: "shell_read"; id: string; offset: number; terminalId: string }
  | { type: "shell_kill"; id: string; signal?: "SIGINT" | "SIGKILL" | "SIGTERM" }
  | { type: "get_commands" }
  | { type: "plugin_list" }
  | { type: "plugin_add_marketplace"; repo: string }
  | { type: "plugin_remove_marketplace"; name: string }
  | { type: "plugin_install"; name: string; marketplace?: string }
  | { type: "plugin_uninstall"; name: string }
  | { type: "plugin_toggle"; name: string; enabled: boolean }
  | { type: "plugin_update"; name?: string }
  | { type: "set_plan_mode"; enabled: boolean }
  | { type: "set_permission_mode"; mode: PermissionMode }
  | { type: "set_reasoning_effort"; effort: "auto" | "low" | "medium" | "high" }
  | { type: "edit_message"; messageId: string; text: string }
  | { type: "mcp_oauth_start"; server: string; url: string; redirectUri?: string }
  | { type: "mcp_oauth_callback"; server: string; code: string }
  | { type: "mcp_oauth_status" }
  | { type: "mcp_oauth_disconnect"; server: string }
  | { type: "checkpoint_list" }
  | { type: "checkpoint_rewind"; id: string }
  | { type: "set_output_style"; name: string }
  | { type: "get_context" }
  | { type: "get_statusline" }
  | { type: "set_statusline"; command: string }
  | { type: "hooks_list" }
  | { type: "mcp_list" }
  | { type: "collab_hello"; name?: string }
  | { type: "collab_join"; code: string }
  | { type: "collab_leave" }
  | { type: "collab_focus"; file: string | null; line?: number | null }
  | { type: "collab_create_room" }
  | { type: "collab_close_room" }
  | { type: "collab_set_role"; id: string; role: CollabRole }
  | { type: "collab_set_readonly"; value: boolean };

interface PendingApproval {
  resolve: (v: boolean) => void;
}

interface PendingAsk {
  resolve: (v: UserQuestionAnswer[]) => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
};

/** Read a JSON request body, with a sane cap. */
async function readBody(req: any, cap = 8 << 20): Promise<any> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) throw new Error("Body too large");
    parts.push(chunk as Buffer);
  }
  if (parts.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new Error("Body must be JSON");
  }
}

/** Text search across the workspace, skipping the usual noise. */
const SEARCH_SKIP = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache", "coverage",
  "vendor", "__pycache__", ".venv", "venv", ".smoke-home", ".smoke-workspace",
]);
const SEARCH_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java",
  ".json", ".md", ".css", ".scss", ".html", ".yml", ".yaml", ".toml", ".sh", ".txt",
]);

async function searchWorkspace(query: string, root: string) {
  const q = query.trim();
  if (!q) return { query: q, results: [] };
  const needle = q.toLowerCase();
  const results: any[] = [];
  const perFile = 40;

  const walk = async (dir: string, depth: number) => {
    if (results.length >= 400 || depth > 8) return;
    let entries: any[];
    try {
      entries = (await listDir(dir)).entries;
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= 400) return;
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      if (e.type === "dir") {
        if (SEARCH_SKIP.has(e.name)) continue;
        await walk(e.path, depth + 1);
        continue;
      }
      const ext = extname(e.name);
      if (!SEARCH_EXT.has(ext)) continue;
      let text = "";
      try {
        const st = await stat(e.path);
        if (st.size > 1_500_000) continue;
        text = (await readFile(e.path, "utf8")) as unknown as string;
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i].toLowerCase().indexOf(needle);
        if (col === -1) continue;
        results.push({
          path: e.path,
          rel: e.path.startsWith(root) ? e.path.slice(root.length + 1) : e.path,
          line: i + 1,
          col: col + 1,
          text: lines[i].slice(0, 400),
        });
        if (results.filter((r) => r.path === e.path).length >= perFile) break;
      }
    }
  };

  await walk(root, 0);
  return { query: q, results };
}

/** Git facts for the IDE's source-control panel. */
async function gitState(cwd: string) {
  // git writes "fatal: not a git repository" to stderr and exits non-zero,
  // so success has to be judged on the exit code, not the output text.
  const run = (args: string[]): Promise<{ out: string; ok: boolean }> =>
    new Promise((res) => {
      try {
        execFile(
          "git",
          ["-C", cwd, ...args],
          { timeout: 12_000, maxBuffer: 8 << 20 },
          (err: any, stdout: string) => res({ out: err ? "" : String(stdout || ""), ok: !err }),
        );
      } catch {
        res({ out: "", ok: false });
      }
    });

  const probe = await run(["rev-parse", "--is-inside-work-tree"]);
  const isRepo = probe.ok && probe.out.trim() === "true";
  const branch = isRepo ? (await run(["rev-parse", "--abbrev-ref", "HEAD"])).out.trim() : "";

  let status: any[] = [];
  let staged: any[] = [];
  if (isRepo) {
    const porcelain = (await run(["status", "--porcelain=v1"])).out;
    for (const line of porcelain.split("\n")) {
      if (line.length < 4) continue;
      const x = line[0], y = line[1];
      const entry = { path: line.slice(3).trim(), staged: x !== " " && x !== "?", untracked: x === "?" && y === "?" };
      (entry.staged ? staged : status).push(entry);
    }
  }

  const logRaw = isRepo
    ? (await run(["log", "--oneline", "-20", "--format=%h%x09%an%x09%ar%x09%s"])).out
    : "";
  const commits = logRaw.split("\n").filter(Boolean).map((l) => {
    const [hash, author, when, ...rest] = l.split("\t");
    return { hash, author, when, subject: rest.join("\t") };
  });

  return { isRepo, branch: branch || "", status, staged, commits };
}

/** Markers that make a directory look like a real project. */
const PROJECT_MARKERS = [
  "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml",
  "go.mod", "pom.xml", "build.gradle", "index.html", "main.py", "app.py",
  "composer.json", "Gemfile", "Makefile", "CMakeLists.txt",
];

/**
 * Scan a workspace folder for projects so the home screen can show them as
 * cards instead of the user navigating a directory tree.
 */
async function listProjects(root: string) {
  const projects: any[] = [];
  const scan = async (dir: string, depth: number) => {
    let entries: any[] = [];
    try {
      entries = (await listDir(dir)).entries;
    } catch {
      return;
    }
    const dirs = entries.filter((e) => e.type === "dir" && !e.name.startsWith("."));
    const files = entries.filter((e) => e.type === "file").map((e) => e.name);

    const markers = PROJECT_MARKERS.filter((m) => files.includes(m));
    const isGit = files.includes(".git") || dirs.some((d) => d.name === ".git");

    if (depth > 0 && (markers.length || isGit)) {
      
      let fileCount = 0;
      let mtime = 0;
      try {
        const tree = await readTree(dir, 3);
        const walk = (n: any) => {
          fileCount++;
          for (const c of n.children || []) walk(c);
        };
        walk(tree);
        try {
          mtime = statSync(dir).mtimeMs;
        } catch {
          mtime = 0;
        }
      } catch {
        /* best effort */
      }
      // A project cover image, if one has been generated for it.
      let cover = "";
      for (const ext of [".jpg", ".png", ".jpeg", ".webp"]) {
        const c = join(dir, "assets" + ext);
        if (existsSync(c)) {
          cover = c;
          break;
        }
      }
      if (!cover) {
        for (const ext of [".jpg", ".png", ".jpeg", ".webp"]) {
          const c = join(dir, `cover${ext}`);
          if (existsSync(c)) {
            cover = c;
            break;
          }
        }
      }
      let origin: "ide" | "chat" | "unknown" = "unknown";
      try {
        if (existsSync(join(dir, ".spyro-ide"))) origin = "ide";
      } catch { /* ignore */ }
      projects.push({
        name: basename(dir),
        path: dir,
        markers,
        isGit,
        fileCount,
        mtime,
        cover,
        origin,
      });
      // Don't descend into a project — its subfolders aren't separate projects.
      return;
    }

    if (depth > 0) {
      for (const d of dirs.slice(0, 40)) await scan(join(dir, d.name), depth - 1);
    }
  };

  try {
    const entries = (await listDir(root)).entries;
    // Also treat the root itself as a project if it looks like one.
    const names = entries.filter((e) => e.type === "file").map((e) => e.name);
    if (PROJECT_MARKERS.some((m) => names.includes(m))) await scan(root, 0);
    for (const e of entries.filter((x) => x.type === "dir" && !x.name.startsWith(".")).slice(0, 60)) {
      await scan(join(root, e.name), 2);
    }
  } catch {
    /* unreadable root */
  }

  projects.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return { root, projects: projects.slice(0, 60) };
}

async function main() {
  let config = loadConfig();
  const registry = new ToolRegistry();

  // Extensions come from the user's plugin folder (installed from the
  // marketplace) plus any project-local ones, mirroring how VS Code layers
  // user extensions and workspace ones.
  const userPluginsDir = resolve(homeDir(), ".claude-free", "plugins");
  const localPluginsDir = resolve(process.cwd(), "plugins");
  const plugins = [
    ...(await loadPlugins(userPluginsDir, registry)),
    ...(await loadPlugins(localPluginsDir, registry)),
  ];
  const pluginsDir = userPluginsDir;

  // --- Capability managers shared by the agent and subagents ---
  const shells = new ShellManager();
  const tasks = new TaskStore();
  const skills = new SkillLoader();
  const mcp = new McpManager();
  const crons = new CronScheduler();
  const memory = new MemoryLoader();
  const sessions = new SessionStore();
  const permissions = new PermissionEngine(config.permissions || emptyRules());
  const hooks = new HookRunner(config.cwd);
  const commands = new CommandLoader();
  const agents = new AgentLoader();
  const pluginMgr = new PluginManager();
  const checkpoints = new CheckpointStore();
  const snapshots = new FileSnapshotStore();
  const outputStyles = new OutputStyleLoader();
  let outputStyleName = "";

  const notify = (opts: { title: string; body?: string; level?: string }) => {
    broadcast({ type: "notification", ...opts });
    hooks.run("Notification", undefined, { ...opts, cwd: config.cwd }).catch(() => {});
  };

  let provider: Provider = createProvider(config.model, config.reasoningEffort);
  const agent = new Agent(provider, registry, {
    cwd: config.cwd,
    autoApprove: config.autoApprove,
    // The agent may read its own source but never write/edit/overwrite it.
    protectedDirs: [APP_ROOT],
    // Extra folders the user granted, for working across projects.
    extraDirs: config.extraDirs || [],
    shells,
    tasks,
    skills,
    mcp,
    crons,
    notify,
    memory,
    permissions,
    hooks,
    agents,
    commands,
    markEdit: (abs: string) => snapshots.markEdit(abs),
    get apiKeys() {
      return config.apiKeys;
    },
    getOutputStyle: () => {
      const s = outputStyles.get(outputStyleName);
      return s ? `# Output style: ${s.name}\n${s.body}` : "";
    },
  });

  // Load project context (AGENTS.md) on startup
  await agent.setCwd(config.cwd);
  await ensureSettings(config.cwd);

  // --- Connected websocket clients + shared run state ---
  const clients = new Set<WebSocket>();
  /**
   * Live collaboration. Every connected window gets a member record; remote
   * windows only get in when a room is open and they present its code.
   */
  const collab = new CollabHub();
  collab.port = config.port;
  const memberOf = new WeakMap<WebSocket, CollabMember>();
  let running = false;
  let controller: AbortController | null = null;
  const approvals = new Map<string, PendingApproval>();
  const asks = new Map<string, PendingAsk>();
  const pendingAuth = new Map<string, PendingAuth>();
  /** Cumulative model spend for the current session, when the provider reports it. */
  let sessionCost = 0;

  function broadcast(msg: Record<string, any>): void {
    const data = JSON.stringify(msg);
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    }
  }

  /** Send to everyone except the socket that caused the message. */
  function broadcastExcept(skip: WebSocket, msg: Record<string, any>): void {
    const data = JSON.stringify(msg);
    for (const c of clients) {
      if (c !== skip && c.readyState === WebSocket.OPEN) c.send(data);
    }
  }

  function broadcastCollab(): void {
    broadcast({ type: "collab_state", ...collab.state() });
  }

  /** True when this socket may still change things. */
  function mayWrite(ws: WebSocket): boolean {
    const m = memberOf.get(ws);
    if (!m) return true; // unregistered socket (this machine's own window)
    if (m.role === "owner") return true;
    if (collab.readOnly) return false;
    return m.role === "editor";
  }

  /** Shut the room and drop every remote window that was let in through it. */
  function closeCollabRoom(): void {
    collab.closeRoom();
    for (const c of [...clients]) {
      const m = memberOf.get(c);
      if (m && !m.local) {
        try {
          c.close(4003, "Collaboration room closed");
        } catch {
          /* already gone */
        }
      }
    }
  }

  function currentStatus(): "idle" | "running" | "needs_input" {
    if (approvals.size > 0 || asks.size > 0) return "needs_input";
    return running ? "running" : "idle";
  }

  /** Session list with the live status of the current session overlaid. */
  function sessionsPayload() {
    // Hide empty sessions. One used to be created on every launch, which buried
    // real conversations under dozens of "New session - 0 msgs" rows.
    const list = sessions.list().filter((s) => (s.messageCount ?? 0) > 0);
    return list.map((s) => ({
      ...s,
      status: s.id === currentSession?.id ? currentStatus() : ("idle" as const),
    }));
  }

  function broadcastSessions(): void {
    broadcast({ type: "sessions", sessions: sessionsPayload() });
  }

  function broadcastShells(): void {
    broadcast({ type: "shells", shells: shells.list().map((h) => ({
      id: h.id,
      command: h.command,
      cwd: h.cwd,
      done: h.done,
      exitCode: h.exitCode,
      startedAt: h.startedAt,
      finishedAt: h.finishedAt,
      tail: (h.output || "").slice(-400),
    })) });
  }

  function broadcastCommands(): void {
    broadcast({ type: "commands", commands: commands.list().map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
      allowedTools: c.allowedTools,
      model: c.model,
    })) });
  }

  function broadcastAgents(): void {
    broadcast({ type: "agents", agents: agents.list().map((a) => ({
      name: a.name,
      description: a.description,
      tools: a.tools,
      model: a.model,
    })) });
  }

  async function broadcastPlugins(): Promise<void> {
    broadcast({
      type: "plugins_state",
      marketplaces: await pluginMgr.listMarketplaces(),
      installed: pluginMgr.listInstalled(),
    });
  }

  /** Light checkpoint metadata for the client (omits heavy file manifests). */
  function checkpointSummaries(sessionId: string) {
    return checkpoints.list(sessionId).map((c) => ({
      id: c.id,
      sessionId: c.sessionId,
      createdAt: c.createdAt,
      label: c.label,
      fileCount: c.fileCount ?? Object.keys(c.files || {}).length,
      messageCount: c.messages?.length ?? 0,
    }));
  }

  /** True until the user has chosen a usable model (drives first-run setup). */
  function needsSetup(): boolean {
    const hasKey = Object.values(config.apiKeys || {}).some((k) => typeof k === "string" && k.trim());
    const hasLocal = config.model.provider === "ollama" || config.model.provider === "openai-compatible";
    return !hasKey && !hasLocal;
  }

  function broadcastOutputStyles(): void {
    broadcast({
      type: "output_styles",
      styles: outputStyles.list().map((s) => ({ name: s.name, description: s.description })),
      active: outputStyleName,
    });
  }

  /** HEAD/GET a loopback URL with a short timeout. Never leaves the machine. */
  /**
   * Probe a loopback URL.
   *
   * Dev servers bind inconsistently: Vite/Next often listen on ::1 only, while
   * others use 127.0.0.1. Trying just one reports a perfectly healthy app as
   * "down", so try the IPv4 and IPv6 loopbacks in turn.
   */
  async function probeLocal(target: URL): Promise<boolean> {
    const port = Number(target.port) || (target.protocol === "https:" ? 443 : 80);
    const path = target.pathname || "/";
    const hosts = ["127.0.0.1", "::1", "localhost"];

    const one = (host: string): Promise<boolean> =>
      new Promise((resolve) => {
        let done = false;
        const finish = (v: boolean) => {
          if (!done) {
            done = true;
            resolve(v);
          }
        };
        try {
          const req = httpRequest({ host, port, path, method: "GET", timeout: 2200 }, (res: any) => {
            res.resume();
            finish(!!res.statusCode && res.statusCode < 500);
          });
          req.on("timeout", () => {
            req.destroy();
            finish(false);
          });
          req.on("error", () => finish(false));
          req.end();
        } catch {
          finish(false);
        }
      });

    for (const host of hosts) {
      if (await one(host)) return true;
    }
    return false;
  }

  
  let sessionUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  async function runAgent(
    userText: string,
    images?: { media_type: string; data: string }[],
    clientId?: string,
  ): Promise<void> {
    if (running) {
      broadcast({ type: "error", message: "Agent is already running." });
      return;
    }
    running = true;
    controller = new AbortController();
    broadcast({ type: "run_start" });
    broadcastSessions();
    const content: ContentPart[] = [];
    if (images?.length) {
      for (const img of images) content.push({ type: "image", media_type: img.media_type, data: img.data });
      content.push({ type: "text", text: userText });
    } else {
      content.push({ type: "text", text: userText });
    }
    const userInput: string | ContentPart[] = images?.length ? content : userText;
    // Snapshot usage before the run so we can attribute it to this turn.
    const usageBefore = { ...sessionUsage };
    try {
      // Snapshot the conversation so the user can rewind to this point.
      const fileManifest = snapshots.capture();
      checkpoints.create(currentSession.id, {
        label: "Before run",
        messages: agent.exportState().messages.map((m) => ({ ...m })),
        summary: agent.exportState().summary,
        todos: agent.exportState().todos,
        diffStats: currentSession.diffStats ? { ...currentSession.diffStats } : undefined,
        files: fileManifest,
        fileCount: Object.keys(fileManifest).length,
      });
      await agent.run(
        userInput,
        {
          onText: (delta) => broadcast({ type: "assistant_text", text: delta }),
          onReasoning: (delta) => broadcast({ type: "assistant_reasoning", text: delta }),
          onToolStart: (call) =>
            broadcast({ type: "tool_start", id: call.id, name: call.name, args: call.arguments }),
          onToolEnd: (call, result) => {
            broadcast({ type: "tool_end", id: call.id, name: call.name, result });
            if (call.name === "bash") broadcastShells();
          },
          onUsage: (usage) => {
            // Providers that report cost (e.g. OpenRouter) let us track spend.
            const reported =
              typeof usage?.cost === "number"
                ? usage.cost
                : typeof usage?.cost_details?.total === "number"
                  ? usage.cost_details.total
                  : typeof usage?.cost_details?.upstream_inference_cost === "number"
                    ? usage.cost_details.upstream_inference_cost
                    : undefined;
            if (reported !== undefined) sessionCost += reported;
            sessionUsage = {
              promptTokens: Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || sessionUsage.promptTokens,
              completionTokens: Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || sessionUsage.completionTokens,
              totalTokens: Number(usage?.total_tokens ?? 0) || sessionUsage.totalTokens,
            };
            broadcast({ type: "usage", usage, cost: sessionCost });
          },
          onError: (message) => broadcast({ type: "error", message }),
          emit: (event) => {
            if (event?.type === "diff" && event.stats) {
              if (!currentSession.diffStats) currentSession.diffStats = { added: 0, removed: 0 };
              currentSession.diffStats.added += event.stats.added || 0;
              currentSession.diffStats.removed += event.stats.removed || 0;
            }
            broadcast(event);
          },
          approve: (req) =>
            new Promise<boolean>((resolvePromise) => {
              const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
              approvals.set(id, { resolve: resolvePromise });
              broadcast({ type: "approval_request", id, ...req });
              broadcastSessions();
            }),
          ask: (req) =>
            new Promise<UserQuestionAnswer[]>((resolvePromise) => {
              const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2)}`;
              asks.set(id, { resolve: resolvePromise });
              broadcast({ type: "ask_request", id, questions: req.questions });
              broadcastSessions();
            }),
        },
        controller.signal,
        clientId,
      );
    } catch (err: any) {
      broadcast({ type: "error", message: err?.message || String(err) });
    } finally {
      running = false;
      controller = null;
      try {
        currentSession.messages = agent.exportState().messages;
        currentSession.summary = agent.exportState().summary;
        currentSession.todos = agent.exportState().todos;
        currentSession.cwd = config.cwd;
        sessions.save(currentSession);
        broadcastSessions();
      } catch {}
      broadcastShells();
      // Attribute this turn's tokens/cost to the message that produced them.
      broadcast({
        type: "run_end",
        usage: {
          promptTokens: sessionUsage.promptTokens - usageBefore.promptTokens,
          completionTokens: sessionUsage.completionTokens - usageBefore.completionTokens,
          totalTokens: sessionUsage.totalTokens - usageBefore.totalTokens,
        },
        cost: sessionCost,
      });
    }
  }

  // Built-in skills directory (bundled with the app)
  const builtinSkillsDir = resolve(APP_ROOT, "server/skills");

  // --- Load skills + MCP servers for the active workspace ---
  async function reloadWorkspaceTools(cwd: string): Promise<void> {
    const comp = pluginMgr.componentDirs();
    // Add built-in skills to the search path
    const allSkillsDirs = [...comp.skills, builtinSkillsDir];
    try {
      await skills.load(cwd, allSkillsDirs);
    } catch {
      // ignore
    }
    try {
      await commands.load(cwd, comp.commands);
    } catch {
      // ignore
    }
    try {
      await agents.load(cwd, comp.agents);
    } catch {
      // ignore
    }
    try {
      await outputStyles.load(cwd);
    } catch {
      // ignore
    }
    try {
      hooks.load(cwd, comp.hookFiles);
    } catch {
      // ignore
    }
    try {
      const mcpConfig = await loadMcpConfig(cwd, comp.mcpFiles);
      const { tools: mcpTools, errors } = await mcp.connectFromConfig(mcpConfig);
      registry.registerMcpTools(mcpTools);
      for (const e of errors) console.warn(`  MCP: ${e}`);
    } catch (err: any) {
      console.warn(`  MCP: ${err?.message || String(err)}`);
    }
  }
  await reloadWorkspaceTools(config.cwd);
  broadcastCommands();
  broadcastAgents();
  broadcastOutputStyles();
  try {
    await memory.load(config.cwd);
  } catch {}
  let currentSession = sessions.create(config.cwd);

  function statePayload() {
    return {
      type: "state",
      cwd: config.cwd,
  providers: DEFAULT_BASE_URLS,
  freeProviders: FREE_PROVIDER_INFO,
  platform: process.platform,
  shell: resolvedShell(),
  needsSetup: needsSetup(),
  tasks: tasks.list(),
  crons: crons.list(),
  skills: skills.list().map((s) => ({ name: s.name, description: s.description })),
  sessions: sessionsPayload(),
  currentSessionId: currentSession.id,
  permissions: permissions.getRules(),
  shells: shells.list().map((h) => ({ id: h.id, command: h.command, cwd: h.cwd, done: h.done, exitCode: h.exitCode, startedAt: h.startedAt, finishedAt: h.finishedAt, tail: (h.output || "").slice(-400) })),
  commands: commands.list().map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint })),
  agents: agents.list().map((a) => ({ name: a.name, description: a.description })),
  outputStyles: outputStyles.list().map((s) => ({ name: s.name, description: s.description })),
  outputStyle: outputStyleName,
  hooks: hooks.list(),
  mcpServers: mcp.servers(),
  context: agent.contextInfo(),
  usage: sessionUsage,
  cost: sessionCost,
  statusLine: config.statusLine?.command || "",
    };
  }

  /** Payload handed to a configured status-line command on stdin. */
  function statusLinePayload() {
    return {
      cwd: config.cwd,
      model: provider.model,
      provider: provider.name,
      sessionId: currentSession.id,
      cost: sessionCost,
      usage: sessionUsage,
      context: agent.contextInfo(),
    };
  }

  async function sendStatusLine(): Promise<void> {
    if (!config.statusLine?.command) {
      broadcast({ type: "statusline", text: "" });
      return;
    }
    const result = await runStatusLine(config.statusLine, statusLinePayload());
    broadcast({ type: "statusline", text: result.text, error: result.error });
  }

  function broadcastState() {
    broadcast(statePayload());
  }


  /**
   * The IDE and the chat are separate surfaces. They must not bleed into each
   * other: the IDE has its own workspace and its own conversation, so switching
   * between them parks one side's state and restores the other's.
   */
  interface SurfaceState {
    // Held in memory rather than reloaded from disk: an untouched session is
    // deliberately never persisted, so loading it back would mint a new one.
    session: ReturnType<typeof sessions.create>;
    cwd: string;
    agent: ReturnType<typeof agent.exportState>;
  }
  const surfaceState = new Map<"chat" | "ide", SurfaceState>();
  let surface: "chat" | "ide" = "chat";
  let chatCwd = config.cwd;

  function parkSurface(next: "chat" | "ide") {
    if (surface === next) return;
    // Persist so a non-empty conversation survives a restart; the in-memory
    // copy below is what makes the swap itself lossless.
    sessions.save(currentSession);
    surfaceState.set(surface, {
      session: currentSession,
      cwd: config.cwd,
      agent: agent.exportState(),
    });
    surface = next;

    const parked = surfaceState.get(next);
    if (parked) {
      currentSession = parked.session;
      config.cwd = parked.cwd;
      agent.setCwd(parked.cwd);
      agent.importState(parked.agent);
    } else {
      // First visit to this surface: give it its own fresh session.
      const base = next === "ide" ? config.cwd : chatCwd;
      currentSession = sessions.create(base);
      agent.reset();
    }
    broadcast({ type: "surface", surface, cwd: config.cwd });
    broadcastSessions();
    broadcastState();
  }
  agent.importState(currentSession);
  try {
    if (hooks.has("SessionStart")) {
      await hooks.run("SessionStart", undefined, { cwd: config.cwd });
    }
  } catch {}


  // --- Cron: fire recurring prompts through the agent ---
  crons.start((job) => {
    if (running) return;
    broadcast({ type: "notification", title: "Scheduled task", body: job.prompt, level: "info" });
    void runAgent(job.prompt);
  });

  // import.meta.dirname needs Node 20.11+; deriving it from the module URL
  // works on every runtime the desktop build might ship with.
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, "../../web/dist");

  /** Output channel: a bounded in-memory log the IDE can read back. */
  const outputLog: { t: number; line: string }[] = [];
  const logLine = (line: string) => {
    outputLog.push({ t: Date.now(), line });
    if (outputLog.length > 3000) outputLog.splice(0, outputLog.length - 3000);
  };
  for (const stream of [process.stdout, process.stderr]) {
    const orig = stream.write.bind(stream);
    (stream as any).write = (chunk: any, ...rest: any[]) => {
      try {
        logLine(String(chunk).replace(/\n$/, ""));
      } catch {
        /* never let logging break output */
      }
      return (orig as any)(chunk, ...rest);
    };
  }
  logLine("Spyro Studio server started");

  // Live workspace updates, so the explorer and open tabs track the agent's
  // writes instead of only catching up once a run has finished.
  /** Servers we believe the agent or terminal started. */
  const portCandidates = new Map<number, PortInfo>();
  /** Ports already known about, so a re-scan doesn't re-report them. */
  const knownListening = new Set<number>();

  const notePorts = (command: string, output: string) => {
    for (const { url, port } of urlsFromOutput(output)) {
      portCandidates.set(port, { port, url, label: labelFor(command, url), process: command, up: true });
    }
  };

  const accounts = new Accounts();

  const watcher = new WorkspaceWatcher((paths) => {
    broadcast({ type: "fs_change", paths });
  });
  watcher.watch(config.cwd);

  const httpServer = createServer(async (req, res) => {
    // Remote requests are served only while a room is open and the caller
    // carries its code: the invite link passes `?room=`, which we pin as a
    // cookie so every later fetch from that browser is authorised without the
    // client having to thread a token through its own calls.
    if (!isLoopback(req.socket.remoteAddress)) {
      const code = roomFromRequest(req);
      if (!collab.verify(code)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "No collaboration room is open for this address. Ask the host for an invite link.",
          }),
        );
        return;
      }
      if ((req.url || "").includes("room=")) {
        res.setHeader("Set-Cookie", `spyro_room=${code}; Path=/; SameSite=Lax`);
      }
    }

    if (req.url?.startsWith("/api/collab")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(collab.state()));
      return;
    }

    if (req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: config.model,
          autoApprove: config.autoApprove,
          permissionMode: agent.getPermissionMode(),
          reasoningEffort: config.reasoningEffort || "auto",
          extraDirs: config.extraDirs || [],
          cwd: config.cwd,
          presets: DEFAULT_PRESETS,
          providers: DEFAULT_BASE_URLS,
          freeProviders: FREE_PROVIDER_INFO,
          platform: process.platform,
          shell: resolvedShell(),
          needsSetup: needsSetup(),
          plugins,
          get apiKeys() {
      return config.apiKeys;
    },
          skills: skills.list().map((s) => ({ name: s.name, description: s.description })),
          tasks: tasks.list(),
          crons: crons.list(),
          commands: commands.list().map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint })),
          agents: agents.list().map((a) => ({ name: a.name, description: a.description })),
          outputStyles: outputStyles.list().map((s) => ({ name: s.name, description: s.description })),
          outputStyle: outputStyleName,
        }),
      );
      return;
    }

    if (req.url === "/api/sandbox") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(detectSupport()));
      return;
    }

    if (req.url?.startsWith("/api/providers/health")) {
      try {
        const statuses = await checkProviders(undefined, config.apiKeys, DEFAULT_BASE_URLS);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ providers: statuses, updatedAt: Date.now() }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    if (req.url?.startsWith("/api/models")) {
      const u = new URL(req.url, "http://localhost");
      const provider = u.searchParams.get("provider") || config.model.provider;
      // Default to the provider's own base URL (not the active model's), so
      // selecting a local provider without typing a URL still works.
      const baseUrl =
        u.searchParams.get("baseUrl") ||
        DEFAULT_BASE_URLS[provider] ||
        config.model.baseUrl;
      try {
        const models = await listModels({
          provider,
          baseUrl,
          apiKey: u.searchParams.get("apiKey") || config.apiKeys[provider] || config.model.apiKey,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models }));
      } catch (err: any) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    if (req.url?.startsWith("/api/local/scan")) {
      try {
        const servers = await scanLocalServers();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ servers }));
      } catch (err: any) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    // Probe a local dev server the agent started, so the UI can show
    // "up ✓" instead of sending the user to a dead link.
    const u0 = (r: any) => new URL(r.url, "http://localhost");


  // Serve files from the open folder so "Run" on an .html file actually shows
    // it. Same confinement as every other read: inside the workspace only.
    if (req.url?.startsWith("/preview/")) {
      const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname.replace(/^\/preview\//, ""));
      const target = resolve(config.cwd, rel);
      const extra = new Set((config.extraDirs || []).map((d) => resolve(d)));
      const allowed = (p: string) =>
        p.startsWith(config.cwd + "/") || p === config.cwd || [...extra].some((d) => p.startsWith(d + "/"));
      if (target.startsWith(APP_ROOT + "/") || !allowed(target) || !existsSync(target) || !statSync(target).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const body = readFileSync(target);
      res.writeHead(200, {
        "Content-Type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (req.url?.startsWith("/api/probe")) {
      const u = new URL(req.url, "http://localhost");
      const target = u.searchParams.get("url") || "";
      // Only ever probe loopback — this must not become an open proxy.
      let ok = false;
      try {
        const parsed = new URL(target);
        const host = parsed.hostname;
        if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) {
          ok = await probeLocal(parsed);
        }
      } catch {
        ok = false;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ up: ok }));
      return;
    }

    // Workspace services. These live outside /api/fs/* because they don't take
    // a single "path" — they scan or summarise the whole workspace.
    if (
      req.url?.startsWith("/api/search") ||
      req.url?.startsWith("/api/git") ||
      req.url?.startsWith("/api/projects")
    ) {
      const u = new URL(req.url, "http://localhost");
      try {
        const payload =
          req.url.startsWith("/api/search")
            ? await searchWorkspace(u.searchParams.get("q") || "", u.searchParams.get("path") || config.cwd)
            : req.url.startsWith("/api/git")
              ? await gitState(u.searchParams.get("path") || config.cwd)
              : await listProjects(u.searchParams.get("path") || config.cwd);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    // Problems panel: run the project's own checker so the view matches the build.
    // "Show changes" — read a file's committed version out of git.
    if (req.url?.startsWith("/api/diff")) {
      let payload: any;
      const root = resolve(u0(req).searchParams.get("path") || config.cwd);
      const file = resolve(u0(req).searchParams.get("file") || "");
      const rel = file.startsWith(root + "/") ? file.slice(root.length + 1) : file;
      const extra = new Set((config.extraDirs || []).map((d) => resolve(d)));
      const allowed = (p: string) =>
        p.startsWith(config.cwd + "/") || p === config.cwd || [...extra].some((d) => p.startsWith(d + "/"));
      if (file.startsWith(APP_ROOT + "/") || !allowed(file)) {
        payload = { error: "That file is outside your workspace." };
      } else {
        const git = (cmd: string[]) => {
          try {
            return execFileSync("git", cmd, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
          } catch {
            return null;
          }
        };
        const committed = git(["show", `HEAD:${rel}`]);
        if (committed === null) {
          payload = { error: "No committed version — this file may be new or untracked.", untracked: true };
        } else {
          payload = { committed, current: existsSync(file) ? readFileSync(file, "utf8") : "" };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    // Ports panel: what servers are up, and can we prove it?
    // --- accounts -------------------------------------------------------
    // Local-only. The password hash and session token never leave this machine.
    if (req.url?.startsWith("/api/account")) {
      const uu = u0(req);
      let payload: any;
      const action = uu.searchParams.get("action");
      if (req.method === "POST") {
        const body = await readBody(req);
        if (action === "create") {
          const r = accounts.create(String(body.name || ""), String(body.email || ""), String(body.password || ""));
          payload = r;
        } else if (action === "signin") {
          const r = accounts.signIn(String(body.email || ""), String(body.password || ""));
          payload = r;
        } else if (action === "resume") {
          const r = accounts.resume(String(body.token || ""));
          payload = r ? { ok: true, account: r } : { ok: false, error: "Session expired." };
        } else if (action === "onboard") {
          accounts.setOnboarded(body.onboarded !== false, body.mode);
          payload = { ok: true, account: accounts.get() };
        } else if (action === "changepassword") {
          const r = accounts.changePassword(String(body.current || ""), String(body.next || ""));
          payload = r.ok ? { ...r, account: accounts.get() } : r;
        } else if (action === "signout") {
          accounts.setOnboarded(accounts.get()?.onboarded ?? false);
          payload = { ok: true };
        }
      } else {
        payload = { hasAccount: accounts.exists(), account: accounts.get() };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.url?.startsWith("/api/ports")) {
      let payload: any;
      try {
      const listening = listeningPorts();
      // Scan every live shell, so servers started by the agent's own bash tool
      // are picked up too — not just ones run from the integrated terminal.
      for (const h of shells.list()) {
        notePorts(h.command, h.output || "");
        // A server that prints nothing still announces itself on a port.
        const guessed = portFromCommand(h.command);
        if (guessed && !portCandidates.has(guessed) && !h.done) {
          portCandidates.set(guessed, {
            port: guessed,
            url: `http://localhost:${guessed}/`,
            label: labelFor(h.command, `http://localhost:${guessed}/`),
            process: h.command,
            up: listening.has(guessed),
          });
        }
      }
      // Anything newly listening that we have not seen is a server too.
      const discovered: PortInfo[] = [...portCandidates.values()].map((p) => ({ ...p, up: listening.has(p.port) }));
      for (const port of listening) {
        if (portCandidates.has(port) || knownListening.has(port)) continue;
        if (port < 3000) continue;
        portCandidates.set(port, {
          port,
          url: `http://localhost:${port}/`,
          label: "Server",
          process: "",
          up: true,
        });
        discovered.push({ port, url: `http://localhost:${port}/`, label: "Server", process: "", up: true });
      }
      for (const p of listening) knownListening.add(p);
      const out = discovered;
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.manual) {
          const port = Number(body.port);
          if (port > 0) portCandidates.set(port, { port, url: `http://localhost:${port}`, label: body.label || "Server", process: "manual", up: listening.has(port) });
        }
        if (body.close) portCandidates.delete(Number(body.close));
      }
      payload = { ports: out, listening: [...listening].slice(0, 400) };
      } catch (e: any) {
        payload = { ports: [], listening: [], error: e?.message || String(e) };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.url?.startsWith("/api/output")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ lines: outputLog.slice(-1000) }));
      return;
    }

    if (req.url?.startsWith("/api/diagnostics")) {
      const root = resolve(u0(req).searchParams.get("path") || config.cwd);
      try {
        const r = await runDiagnostics(root);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(r));
      } catch (e: any) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ problems: [], error: e?.message || String(e) }));
      }
      return;
    }

    if (req.url?.startsWith("/api/db")) {
      const u = new URL(req.url, "http://localhost");
      let payload: any;
      const action = u.searchParams.get("action");
      const dbPath = resolve(u.searchParams.get("path") || "");
      const extra = new Set((config.extraDirs || []).map((d) => resolve(d)));
      const allowed = (p: string) =>
        p.startsWith(config.cwd + "/") || p === config.cwd || [...extra].some((d) => p.startsWith(d + "/"));
      if (dbPath.startsWith(APP_ROOT + "/") || !allowed(dbPath)) {
        payload = { error: "That database is outside your workspace." };
      } else {
        try {
          payload = await (async () => {
          switch (action) {
            case "find":
              return { databases: findDatabases(u.searchParams.get("root") || config.cwd) };
            case "describe":
              return describeDatabase(dbPath);
            case "dump":
              return readSqlDump(dbPath);
            case "tables":
              return dbKind(dbPath) === "sql" ? { ...readSqlDump(dbPath), path: dbPath } : listTables(dbPath);
            case "schema":
              if (dbKind(dbPath) === "sql") {
                const d = readSqlDump(dbPath);
                const t = d.tables.find((x) => x.name === (u.searchParams.get("table") || ""));
                return {
                  columns: (t?.columns || []).map((n) => ({ name: n, type: "", notnull: 0, pk: 0, dflt: null })),
                  sql: t?.statement || "",
                };
              }
              return tableSchema(dbPath, u.searchParams.get("table") || "");
            case "query":
              return runQuery(dbPath, u.searchParams.get("sql") || "", Number(u.searchParams.get("limit")) || 200);
            case "update": {
              // This one is a POST, so the path arrives in the body — take it
              // from there rather than silently falling back to the folder.
              const body = await readBody(req);
              const p = resolve(body.path || dbPath);
              if (p.startsWith(APP_ROOT + "/") || !allowed(p)) return { error: "That database is outside your workspace." };
              return updateCell(p, body.table, body.pk || {}, body.column, body.value ?? null);
            }
            default:
              return { error: "Unknown database action." };
          }
          })();
        } catch (e: any) {
          // Corrupt file, locked database, bad SQL — report it, stay up.
          payload = { error: e?.message || String(e) };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.url?.startsWith("/api/tools") || req.url?.startsWith("/api/market")) {
      const u = new URL(req.url, "http://localhost");
      let payload: any;
      try {
        if (req.url.startsWith("/api/tools")) {
          // What the agent can actually call right now — extensions included.
          payload = { tools: registry.all().map((t) => ({ name: t.name, description: t.description })) };
        } else if (req.url.startsWith("/api/market")) {
        const action = u.searchParams.get("action");
        const msg2: { id?: string } = req.method === "POST" ? await readBody(req) : {};
        mkdirSync(pluginsDir, { recursive: true });
        const fileFor = (id: string) => join(pluginsDir, `${id}.mjs`);
        if (action === "install") {
          const entry = CATALOG.find((c) => c.id === msg2.id);
          if (!entry) payload = { error: "Unknown extension." };
          else {
            writeFileSync(fileFor(entry.id), entry.source, "utf8");
            payload = { ok: true, installed: entry.id, restart: true };
          }
        } else if (action === "uninstall") {
          const target = msg2.id || "";
          for (const f of [fileFor(target), `${fileFor(target)}.disabled`]) {
            if (existsSync(f)) rmSync(f, { force: true });
          }
          payload = { ok: true, installed: msg2.id, restart: true };
        } else if (action === "toggle") {
          const id = msg2.id || "";
          const on = join(pluginsDir, `${id}.mjs`);
          const off = `${on}.disabled`;
          if (existsSync(off)) renameSync(off, on);
          else if (existsSync(on)) renameSync(on, off);
          payload = { ok: true, enabled: existsSync(on), restart: true };
        } else {
          const files = existsSync(pluginsDir) ? readdirSync(pluginsDir) : [];
          const installed = new Set<string>();
          const enabled = new Set<string>();
          for (const f of files) {
            const base = f.replace(/\.mjs(\.disabled)?$/, "");
            installed.add(base);
            if (!f.endsWith(".disabled")) enabled.add(base);
          }
          payload = {
            extensions: CATALOG.map((c) => ({
              ...c,
              installed: installed.has(c.id),
              enabled: enabled.has(c.id),
            })),
            pluginsDir,
          };
        }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    } else if (req.url?.startsWith("/api/fs/")) {
      const u = new URL(req.url, "http://localhost");
      const p = u.searchParams.get("path") || config.cwd;
      try {
        let payload: any;
        if (req.url.startsWith("/api/fs/list")) {
          payload = await listDir(p);
        } else if (req.url.startsWith("/api/fs/tree")) {
          payload = { tree: await readTree(p, Number(u.searchParams.get("depth")) || 4) };
        } else if (req.url.startsWith("/api/fs/read")) {
          payload = await readFileForViewer(p);
        } else if (req.url.startsWith("/api/fs/settings")) {
          // VS Code scopes settings per folder in .vscode/settings.json.
          // The IDE reads and writes them so each project keeps its own config.
          const dir = u.searchParams.get("path") || config.cwd;
          const file = join(resolve(dir), ".vscode", "settings.json");
          if (req.method === "POST") {
            const body = await readBody(req);
            const target = resolve(body.path || dir);
            if (target.startsWith(APP_ROOT + "/")) {
              payload = { error: "That folder is inside the app and is protected." };
            } else {
              mkdirSync(join(target, ".vscode"), { recursive: true });
              writeFileSync(join(target, ".vscode", "settings.json"), JSON.stringify(body.settings ?? {}, null, 2), "utf8");
              payload = { ok: true, settings: body.settings ?? {} };
            }
          } else {
            try {
              payload = { settings: JSON.parse(readFileSync(file, "utf8")) };
            } catch {
              payload = { settings: {} };
            }
          }
        } else if (req.url.startsWith("/api/fs/workspace")) {
          // .code-workspace files describe multi-root workspaces.
          const dir = resolve(u.searchParams.get("path") || config.cwd);
          try {
            const found = readdirSync(dir)
              .filter((f) => f.endsWith(".code-workspace"))
              .map((f) => {
                let folders: string[] = [];
                let name = f.replace(/\.code-workspace$/, "");
                try {
                  const w = JSON.parse(readFileSync(join(dir, f), "utf8"));
                  if (Array.isArray(w.folders)) folders = w.folders.map((x: any) => x.path);
                  if (w.folder) folders = [w.folder];
                  if (w.settings) name = w.settings["window.title"] || name;
                } catch {
                  /* ignore malformed workspace files */
                }
                return { file: join(dir, f), name, folders };
              });
            payload = { workspaces: found };
          } catch {
            payload = { workspaces: [] };
          }
        } else if (req.url.startsWith("/api/fs/op")) {
          // Explorer operations: create, rename, delete. Each one is held to the
          // same workspace guard as the agent's own file tools.
          const body = await readBody(req);
          const action = u.searchParams.get("action");
          const target = resolve(body.path || "");
          const extra = new Set((config.extraDirs || []).map((d) => resolve(d)));
          const allowed = (p: string) =>
            p.startsWith(config.cwd + "/") || p === config.cwd || [...extra].some((d) => p.startsWith(d + "/"));
          if (target.startsWith(APP_ROOT + "/") || target === APP_ROOT) {
            payload = { error: "That folder is inside the app and is protected." };
          } else if (!allowed(target)) {
            payload = { error: "That folder is outside your workspace." };
          } else if (action === "rename") {
            payload = await moveEntry(target, resolve(body.to || ""));
          } else if (action === "delete") {
            payload = await deleteEntry(target);
          } else if (action === "create") {
            payload = await createEntry(target, body.kind === "dir" ? "dir" : "file");
          } else {
            payload = { error: "Unknown operation." };
          }
        } else if (req.url.startsWith("/api/fs/write")) {
          // The IDE editor saves here. Same write-guard as the agent's tools.
          const body = await readBody(req);
          const target = resolve(String(body.path || ""));
          if (target === APP_ROOT || target.startsWith(APP_ROOT + "/")) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "That's Spyro Studio's own folder." }));
            return;
          }
          const parent = dirname(target);
          const granted = (config.extraDirs || []).some((d) => target === d || target.startsWith(d + "/"));
          if (parent !== config.cwd && !granted) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "That folder is outside your workspace." }));
            return;
          }
          payload = await writeTextFile(target, String(body.content ?? ""));
        } else if (req.url.startsWith("/api/fs/home")) {
          payload = { home: homeDir() };
        } else {
          res.writeHead(404);
          res.end("{}");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    let path = (req.url || "/").split("?")[0];
    if (path === "/") path = "/index.html";
    const filePath = join(webDist, path);

    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(data);
    } catch {
      if (existsSync(join(webDist, "index.html"))) {
        const html = await readFile(join(webDist, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } else {
        res.writeHead(404);
        res.end("Not found. Build the web app with `npm run build`.");
      }
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  /**
   * Upgrades never reach the HTTP handler, so they are gated here. Windows on
   * this machine are always welcome. Remote ones only get in while a room is
   * open and the handshake carries its code — from `?room=` on the invite link
   * or the cookie that link set a moment earlier.
   */
  httpServer.on("upgrade", (req, socket, head) => {
    const proceed = () => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    if (isLoopback((socket as any).remoteAddress)) return proceed();
    if (collab.verify(roomFromRequest(req))) return proceed();
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });

  wss.on("connection", (ws: WebSocket) => {
    const send = (msg: Record<string, any>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const local = isLoopback((ws as any)._socket?.remoteAddress);
    const member = collab.add(local ? "owner" : "viewer", local);
    memberOf.set(ws, member);
    clients.add(ws);

    const greet = () =>
      send({
        type: "hello",
        model: config.model,
        autoApprove: config.autoApprove,
        permissionMode: agent.getPermissionMode(),
        reasoningEffort: config.reasoningEffort || "auto",
        extraDirs: config.extraDirs || [],
        cwd: config.cwd,
        presets: DEFAULT_PRESETS,
        providers: DEFAULT_BASE_URLS,
        freeProviders: FREE_PROVIDER_INFO,
        platform: process.platform,
        shell: resolvedShell(),
        needsSetup: needsSetup(),
        plugins,
        get apiKeys() {
          return config.apiKeys;
        },
        skills: skills.list().map((s) => ({ name: s.name, description: s.description })),
        tasks: tasks.list(),
        crons: crons.list(),
        sessions: sessionsPayload(),
        currentSessionId: currentSession.id,
        permissions: permissions.getRules(),
        shells: shells.list().map((h) => ({ id: h.id, command: h.command, cwd: h.cwd, done: h.done, exitCode: h.exitCode, startedAt: h.startedAt, finishedAt: h.finishedAt, tail: (h.output || "").slice(-400) })),
        commands: commands.list().map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint })),
        agents: agents.list().map((a) => ({ name: a.name, description: a.description })),
        outputStyles: outputStyles.list().map((s) => ({ name: s.name, description: s.description })),
        outputStyle: outputStyleName,
        collab: collab.state(),
        you: member.id,
      });

    greet();
    broadcastCollab();

    ws.on("message", async (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const me = memberOf.get(ws);
      if (me) me.lastSeen = Date.now();

      // --- collaboration ---------------------------------------------------
      if (msg.type === "collab_hello") {
        if (me) {
          if (!collab.get(me.id)) collab.rejoin(me);
          collab.rename(me.id, msg.name || me.name);
        }
        send({ type: "collab_state", ...collab.state(), you: me?.id ?? null });
        broadcastExcept(ws, { type: "collab_state", ...collab.state() });
        return;
      }

      if (msg.type === "collab_focus") {
        if (me) collab.focus(me.id, msg.file ?? null, msg.line ?? null);
        broadcastCollab();
        return;
      }

      if (msg.type === "collab_leave") {
        if (me) {
          collab.remove(me.id);
          if (!me.local) me.role = "viewer";
        }
        broadcastCollab();
        return;
      }

      // Host-only switches: open/close the room, hand out edit rights,
      // freeze the session for everyone but the host.
      if (
        msg.type === "collab_create_room" ||
        msg.type === "collab_close_room" ||
        msg.type === "collab_set_role" ||
        msg.type === "collab_set_readonly"
      ) {
        if (!me || me.role !== "owner") {
          send({ type: "error", message: "Only the host can change collaboration settings." });
          return;
        }
        if (msg.type === "collab_create_room") {
          collab.createRoom();
        } else if (msg.type === "collab_close_room") {
          closeCollabRoom();
        } else if (msg.type === "collab_set_role") {
          if (msg.id !== me.id) collab.setRole(msg.id, msg.role);
        } else if (msg.type === "collab_set_readonly") {
          collab.readOnly = !!msg.value;
        }
        broadcastCollab();
        send({ type: "collab_state", ...collab.state(), you: me.id });
        return;
      }

      // Everything below mutates the session, so a viewer stops here. The
      // list is an allow-list: an unknown message type is denied by default.
      if (me && !mayWrite(ws) && !VIEWER_MESSAGES.has(msg.type)) {
        send({ type: "error", message: `View-only access — ${msg.type} refused. Ask the host to allow editing.` });
        return;
      }

      if (msg.type === "set_model") {
        try {
          const prov = msg.model.provider;
          let key: string | undefined;
          if (msg.model.apiKey === undefined) {
            key = config.apiKeys[prov];
          } else if (msg.model.apiKey === "") {
            delete config.apiKeys[prov];
            key = undefined;
          } else {
            config.apiKeys[prov] = msg.model.apiKey;
            key = msg.model.apiKey;
          }
          config.model = { ...msg.model, apiKey: key };
          provider = createProvider(config.model, config.reasoningEffort);
          agent.setProvider(provider);
          saveModelConfig(config.model, config.apiKeys);
          send({ type: "model_updated", model: config.model, apiKeys: config.apiKeys });
        } catch (err: any) {
          send({ type: "error", message: err.message });
        }
        return;
      }

      if (msg.type === "set_auto_approve") {
        config.autoApprove = msg.value;
        (agent as any).opts.autoApprove = msg.value;
        // /auto is the coarse toggle; keep it consistent with the fine-grained
        // permission mode so the two can't disagree.
        const mode: PermissionMode = msg.value ? "bypass" : "default";
        config.permissionMode = mode;
        agent.setPermissionMode(mode);
        writeConfigFile({ permissionMode: mode, autoApprove: msg.value });
        broadcast({ type: "permission_mode", mode, autoApprove: msg.value, planMode: false });
        send({ type: "auto_approve_updated", value: msg.value });
        return;
      }

      if (msg.type === "reset") {
        agent.reset();
        send({ type: "reset_done" });
        send({ type: "todos", todos: [] });
        return;
      }

      if (msg.type === "set_cwd") {
        try {
          const abs = resolve(msg.path);
          const s = await stat(abs);
          if (!s.isDirectory()) throw new Error("Not a directory");
          if (abs === APP_ROOT || abs.startsWith(APP_ROOT + "/")) {
            send({
              type: "error",
              message:
                "That's Spyro Studio's own folder. Pick a different working directory (e.g. your claude-projects folder) so the agent can't edit the app itself.",
            });
            return;
          }
          config.cwd = abs;
          agent.setCwd(abs);
          watcher.watch(abs);
          writeConfigFile({ cwd: abs });
          hooks.load(abs);
          try {
            const projSettings = loadProjectSettings(abs);
            if (projSettings.permissions) {
              config.permissions = projSettings.permissions;
              permissions.update(projSettings.permissions);
              broadcast({ type: "permissions", permissions: permissions.getRules() });
            }
          } catch {}
          try {
            await memory.load(abs);
          } catch {}
          send({ type: "cwd_updated", cwd: abs });
          await reloadWorkspaceTools(abs);
          broadcastCommands();
          broadcastAgents();
          broadcast({
            type: "skills",
            skills: skills.list().map((sk) => ({ name: sk.name, description: sk.description })),
          });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "force_compact") {
        try {
          const note = await agent.forceCompact();
          send({ type: "compact_done", note });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "approval_response") {
        const pending = approvals.get(msg.id);
        if (pending) {
          pending.resolve(msg.approved);
          approvals.delete(msg.id);
        }
        broadcastSessions();
        return;
      }

      if (msg.type === "cancel") {
        controller?.abort();
        running = false;
        send({ type: "cancelled" });
        broadcastSessions();
        return;
      }

      if (msg.type === "get_state") {
        send(statePayload());
        return;
      }

      if (msg.type === "get_context") {
        send({
          type: "context",
          context: agent.contextInfo(),
          usage: sessionUsage,
          cost: sessionCost,
          model: provider.model,
          provider: provider.name,
        });
        return;
      }

      if (msg.type === "get_statusline") {
        sendStatusLine().catch(() => send({ type: "statusline", text: "" }));
        return;
      }

      if (msg.type === "set_statusline") {
        const command = typeof msg.command === "string" ? msg.command.trim() : "";
        config.statusLine = command ? { type: "command", command } : undefined;
        writeConfigFile({ statusLine: config.statusLine });
        broadcast({ type: "statusline_config", command });
        sendStatusLine().catch(() => {});
        return;
      }

      if (msg.type === "hooks_list") {
        send({ type: "hooks", hooks: hooks.list() });
        return;
      }

      if (msg.type === "mcp_list") {
        send({
          type: "mcp",
          servers: mcp.servers(),
          tools: mcp.allTools().map((t) => ({
            name: t.name,
            server: t.server,
            description: t.description,
          })),
          resources: mcp.allResources().map((r) => ({ name: r.name, server: r.server, uri: r.uri })),
          prompts: mcp.allPrompts().map((p) => ({ name: p.name, server: p.server })),
        });
        return;
      }

      if (msg.type === "set_permissions") {
        try {
          permissions.update(msg.permissions);
          config.permissions = msg.permissions;
          writeConfigFile({ permissions: msg.permissions });
          broadcast({ type: "permissions", permissions: permissions.getRules() });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "list_sessions") {
        send({ type: "sessions", sessions: sessionsPayload() });
        return;
      }

      if (msg.type === "swap_surface") {
        parkSurface(msg.surface);
        return;
      }

      if (msg.type === "new_session") {
        sessionCost = 0;
        broadcast({ type: "cost_reset" });
        currentSession = sessions.create(config.cwd);
        agent.reset();
        agent.setCwd(config.cwd);
        send({ type: "session_loaded", id: currentSession.id, messages: [], todos: [] });
        send({ type: "todos", todos: [] });
        broadcastSessions();
        return;
      }

      if (msg.type === "load_session") {
        const data = sessions.load(msg.id);
        if (!data) {
          send({ type: "error", message: "Session not found." });
          return;
        }
        currentSession = data;
        sessionCost = 0;
        broadcast({ type: "cost_reset" });
        agent.importState(data);
        if (data.cwd) {
          config.cwd = data.cwd;
          agent.setCwd(data.cwd);
          writeConfigFile({ cwd: data.cwd });
          hooks.load(data.cwd);
          try {
            await memory.load(data.cwd);
          } catch {}
          await reloadWorkspaceTools(data.cwd);
          send({ type: "cwd_updated", cwd: data.cwd });
          broadcastCommands();
          broadcastAgents();
        }
        send({
          type: "session_loaded",
          id: data.id,
          messages: data.messages,
          todos: data.todos || [],
          summary: data.summary,
        });
        send({ type: "todos", todos: data.todos || [] });
        return;
      }

      if (msg.type === "delete_session") {
        sessions.delete(msg.id);
        broadcastSessions();
        return;
      }

      if (msg.type === "kill_shell") {
        shells.kill(msg.id);
        broadcastShells();
        return;
      }

      if (msg.type === "ask_response") {
        const pending = asks.get(msg.id);
        if (pending) {
          pending.resolve(Array.isArray(msg.answers) ? msg.answers : []);
          asks.delete(msg.id);
        }
        broadcastSessions();
        return;
      }

      if (msg.type === "get_commands") {
        send({ type: "commands", commands: commands.list().map((c) => ({
          name: c.name,
          description: c.description,
          argumentHint: c.argumentHint,
          allowedTools: c.allowedTools,
          model: c.model,
        })) });
        return;
      }

      // ---- IDE terminal -------------------------------------------------
      // A real terminal: start a command in the open folder and stream its
      // output back incrementally, instead of only showing it once it ends.
      if (msg.type === "shell_start") {
        // The integrated terminal is the user's own shell — it is deliberately
        // not confined to the workspace. But Spyro Studio's own installation is
        // off limits everywhere, including here, so it cannot rewrite itself.
        if (msg.command.includes(APP_ROOT)) {
          send({
            type: "shell_output",
            terminalId: msg.terminalId,
            id: null,
            output: `$ ${msg.command}\nBlocked: the app's own installation folder is protected. Open a project folder and run your command there instead.\n`,
            done: true,
            exitCode: 1,
          });
          return;
        }
        const dir = msg.cwd && existsSync(msg.cwd) && statSync(msg.cwd).isDirectory() ? msg.cwd : config.cwd;

        // A terminal keeps its working directory between commands. Each command
        // runs in its own shell here, so a bare `cd` is handled by us and the
        // new directory is reported back for the next command to use.
        const cdMatch = /^\s*cd(?:\s+([\s\S]+?))?\s*$/.exec(msg.command);
        if (cdMatch) {
          const raw = (cdMatch[1] || "").trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
          const home = homedir();
          const next = !raw ? home : raw.startsWith("~") ? raw.replace(/^~/, home) : resolve(dir, raw);
          const isDir = existsSync(next) && (() => { try { return statSync(next).isDirectory(); } catch { return false; } })();
          if (isDir) {
            send({ type: "shell_output", terminalId: msg.terminalId, id: null, output: "", done: true, exitCode: 0 });
            send({ type: "shell_cwd", terminalId: msg.terminalId, cwd: next });
          } else {
            send({ type: "shell_output", terminalId: msg.terminalId, id: null, output: `cd: no such directory: ${raw}\n`, done: true, exitCode: 1 });
          }
          return;
        }

        try {
          const h = shells.start(msg.command, dir, 15 * 60 * 1000);
          const first = shells.read(h.id, 0);
          send({ type: "shell_output", terminalId: msg.terminalId, id: h.id, output: first?.output || "", done: false, exitCode: null });
          // Pump output until the process exits, then stop.
          const pump = async () => {
            let offset = first?.readOffset || 0;
            while (true) {
              await sleep(350);
              const r = shells.read(h.id, offset);
              if (!r) break;
              offset = r.readOffset;
              if (r.output) {
                notePorts(msg.command, r.output);
                broadcast({ type: "shell_output", terminalId: msg.terminalId, id: h.id, output: r.output, done: r.done, exitCode: r.exitCode });
              }
              if (r.done) {
                broadcast({ type: "shell_output", terminalId: msg.terminalId, id: h.id, output: "", done: true, exitCode: r.exitCode });
                break;
              }
            }
            broadcastState();
          };
          void pump();
        } catch (e: any) {
          send({ type: "shell_output", terminalId: msg.terminalId, id: null, output: `${msg.command}\n${e?.message || e}\n`, done: true, exitCode: 1 });
        }
        return;
      }

      if (msg.type === "shell_read") {
        const r = shells.read(msg.id, msg.offset);
        if (r) send({ type: "shell_output", terminalId: msg.terminalId, id: msg.id, output: r.output, done: r.done, exitCode: r.exitCode });
        return;
      }

      if (msg.type === "shell_kill") {
        // Ctrl+C arrives as SIGINT (graceful, with a forced fallback); the Stop
        // button sends no signal and gets the old immediate SIGKILL.
        shells.kill(msg.id, msg.signal === "SIGINT" ? "SIGINT" : "SIGKILL");
        return;
      }

      if (msg.type === "run_command") {
        const c = commands.get(msg.name);
        if (!c) {
          send({ type: "error", message: `Unknown command: /${msg.name}` });
          return;
        }
        const text = commands.expand(c.name, msg.args || "");
        // Restrict the agent to the command's allowed tools for this run.
        let applied = false;
        if (c.allowedTools?.length) {
          agent.setToolRegistry(subsetRegistry(registry, c.allowedTools));
          applied = true;
        }
        try {
          await runAgent(text);
        } finally {
          if (applied) agent.setToolRegistry(registry);
        }
        return;
      }

      if (msg.type === "plugin_list") {
        await broadcastPlugins();
        return;
      }

      if (msg.type === "plugin_add_marketplace") {
        try {
          await pluginMgr.addMarketplace(msg.repo);
          await broadcastPlugins();
          await broadcast({ type: "notification", title: "Marketplace added", level: "success" });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "plugin_remove_marketplace") {
          await pluginMgr.removeMarketplace(msg.name);
        await broadcastPlugins();
        return;
      }

      if (msg.type === "plugin_install") {
        try {
          const installed = await pluginMgr.install(msg.name, msg.marketplace);
          await reloadWorkspaceTools(config.cwd);
          broadcastCommands();
          broadcastAgents();
          await broadcastPlugins();
          send({
            type: "notification",
            title: "Plugin installed",
            body: installed.name,
            level: "success",
          });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "plugin_uninstall") {
        await pluginMgr.uninstall(msg.name);
        await reloadWorkspaceTools(config.cwd);
        broadcastCommands();
        broadcastAgents();
        await broadcastPlugins();
        return;
      }

      if (msg.type === "plugin_toggle") {
        await pluginMgr.setEnabled(msg.name, msg.enabled);
        await reloadWorkspaceTools(config.cwd);
        broadcastCommands();
        broadcastAgents();
        await broadcastPlugins();
        return;
      }

      if (msg.type === "add_dir" || msg.type === "remove_dir") {
        const adding = msg.type === "add_dir";
        try {
          const abs = resolve(msg.path);
          if (!existsSync(abs) || !(await stat(abs)).isDirectory()) {
            send({ type: "error", message: `Not a folder: ${abs}` });
            return;
          }
          if (abs === APP_ROOT || abs.startsWith(APP_ROOT + "/")) {
            send({
              type: "error",
              message:
                "That's Spyro Studio's own folder. The agent must never be able to edit the app itself.",
            });
            return;
          }
          const cur = config.extraDirs || [];
          const next = adding
            ? [...new Set([...cur, abs])]
            : cur.filter((d) => d !== abs);
          config.extraDirs = next;
          writeConfigFile({ extraDirs: next });
          broadcast({ type: "extra_dirs", dirs: next });
          return;
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
          return;
        }
      }

      if (msg.type === "set_reasoning_effort") {
        config.reasoningEffort = msg.effort;
        writeConfigFile({ reasoningEffort: msg.effort });
        provider = createProvider(config.model, msg.effort);
        (agent as any).provider = provider;
        broadcast({ type: "reasoning_effort", effort: msg.effort });
        return;
      }

      if (msg.type === "edit_message") {
        if (running) {
          send({ type: "error", message: "Cannot edit a message while the agent is running." });
          return;
        }
        const msgs = agent.exportState().messages;
        const idx = msgs.findIndex((m: any) => m.client_id === msg.messageId);
        if (idx === -1) {
          send({ type: "error", message: "That message is no longer in the conversation history." });
          return;
        }
        // Drop the original turn and everything the agent said after it, so
        // the re-run starts from the same point the user edited.
        agent.importState({
          messages: msgs.slice(0, idx),
          summary: agent.exportState().summary,
          todos: agent.exportState().todos,
        });
        send({ type: "message_edited", messageId: msg.messageId, text: msg.text });
        await runAgent(msg.text);
        return;
      }

      if (msg.type === "set_permission_mode") {
        const mode = msg.mode;
        const { autoApprove, planMode } = resolvePermissionMode(mode);
        config.permissionMode = mode;
        config.autoApprove = autoApprove;
        agent.setPermissionMode(mode);
        // Persist so the choice survives a restart.
        writeConfigFile({ permissionMode: mode, autoApprove });
        broadcast({ type: "permission_mode", mode, autoApprove, planMode });
        return;
      }

      if (msg.type === "set_plan_mode") {
        agent.setPlanMode(msg.enabled);
        broadcast({ type: "plan_mode", enabled: msg.enabled });
        return;
      }

      if (msg.type === "checkpoint_list") {
        send({ type: "checkpoints", checkpoints: checkpointSummaries(currentSession.id) });
        return;
      }

      if (msg.type === "checkpoint_rewind") {
        const cp = checkpoints.get(currentSession.id, msg.id);
        if (!cp) {
          send({ type: "error", message: "Checkpoint not found." });
          return;
        }
        if (running) {
          send({ type: "error", message: "Cannot rewind while the agent is running." });
          return;
        }
        agent.importState({
          messages: cp.messages.map((m: any) => ({ ...m })),
          summary: cp.summary,
          todos: cp.todos || [],
        });
        // Restore the working tree to match this checkpoint.
        let fileReport: { restored: string[]; created: string[]; deleted: string[]; skipped: string[] } | null = null;
        try {
          fileReport = snapshots.restore(cp.files || {});
        } catch (err: any) {
          send({ type: "error", message: `File rewind failed: ${err?.message || String(err)}` });
        }
        currentSession.messages = agent.exportState().messages;
        currentSession.summary = agent.exportState().summary;
        currentSession.todos = agent.exportState().todos;
        sessions.save(currentSession);
        broadcastSessions();
        send({ type: "session_loaded", id: currentSession.id, messages: currentSession.messages, todos: currentSession.todos });
        if (fileReport) {
          const lines: string[] = [];
          if (fileReport.restored.length) lines.push(`Restored ${fileReport.restored.length} file(s): ${fileReport.restored.join(", ")}`);
          if (fileReport.deleted.length) lines.push(`Removed ${fileReport.deleted.length} file(s) created after this checkpoint: ${fileReport.deleted.join(", ")}`);
          if (fileReport.skipped.length) lines.push(`Skipped ${fileReport.skipped.length} (binary/too large).`);
          broadcast({
            type: "notification",
            title: "Rewound",
            body: lines.length ? lines.join("\n") : "Conversation restored; no file changes to undo.",
            level: "info",
          });
        }
        broadcast({ type: "checkpoints", checkpoints: checkpointSummaries(currentSession.id) });
        return;
      }

      if (msg.type === "set_output_style") {
        outputStyleName = msg.name || "";
        broadcastOutputStyles();
        return;
      }

      if (msg.type === "plugin_update") {
        try {
          const results = msg.name
            ? [await pluginMgr.update(msg.name)]
            : await pluginMgr.updateAll();
          await reloadWorkspaceTools(config.cwd);
          broadcastCommands();
          broadcastAgents();
          await broadcastPlugins();
          const okCount = results.filter((r) => r.status === "updated").length;
          const failed = results.filter((r) => r.status === "failed");
          send({
            type: "notification",
            title: msg.name ? "Plugin update" : "Plugins updated",
            body: failed.length
              ? `${okCount} updated, ${failed.length} failed: ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}`
              : `${okCount} of ${results.length} updated`,
            level: failed.length ? "warning" : "success",
          });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "mcp_oauth_status") {
        const configs = await loadMcpConfig(config.cwd);
        const statuses = Object.entries(configs)
          .filter(([, cfg]) => cfg.url)
          .map(([name, cfg]) => ({
            server: name,
            url: cfg.url,
            authenticated: !!getToken(name)?.access_token,
          }));
        send({ type: "mcp_oauth_status", servers: statuses });
        return;
      }

      if (msg.type === "mcp_oauth_start") {
        try {
          const configs = await loadMcpConfig(config.cwd);
          const cfg = configs[msg.server];
          if (!cfg?.url) {
            send({ type: "error", message: `MCP server "${msg.server}" is not configured with a url.` });
            return;
          }
          const redirectUri = msg.redirectUri || "http://localhost:8787/oauth/callback";
          const metadata = await discoverAuth(cfg.url);
          const reg = await registerClient(metadata, redirectUri);
          const { verifier, challenge } = pkce();
          const pending: PendingAuth = {
            server: msg.server,
            verifier,
            challenge,
            state: randomState(),
            redirectUri,
            metadata,
            clientId: reg?.clientId,
            clientSecret: reg?.clientSecret,
            createdAt: Date.now(),
          };
          pendingAuth.set(msg.server, pending);
          if (!pending.clientId) {
            send({
              type: "mcp_oauth_need_client",
              server: msg.server,
              metadata,
              redirectUri,
            });
            return;
          }
          send({
            type: "mcp_oauth_url",
            server: msg.server,
            url: buildAuthorizeUrl(pending, { clientId: pending.clientId, resource: cfg.url }),
            redirectUri,
          });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "mcp_oauth_callback") {
        const pending = pendingAuth.get(msg.server);
        if (!pending) {
          send({ type: "error", message: "No login in progress for that server. Start authorization again." });
          return;
        }
        try {
          const clientId = pending.clientId;
          if (!clientId) throw new Error("No client_id — supply one before completing login.");
          const code = parseCallback(msg.code, pending.state);
          const token = await exchangeCode(pending.metadata, pending, clientId, code, pending.clientSecret);
          setToken(msg.server, token);
          pendingAuth.delete(msg.server);
          send({ type: "mcp_oauth_done", server: msg.server });
          await reloadWorkspaceTools(config.cwd);
          registry.registerMcpTools(mcp.allTools());
          broadcast({ type: "mcp_tools", tools: mcp.allTools().map((t) => t.name) });
        } catch (err: any) {
          send({ type: "error", message: err?.message || String(err) });
        }
        return;
      }

      if (msg.type === "mcp_oauth_disconnect") {
        clearToken(msg.server);
        pendingAuth.delete(msg.server);
        send({ type: "mcp_oauth_done", server: msg.server });
        await reloadWorkspaceTools(config.cwd);
        return;
      }

      if (msg.type === "user_message") {
        // Everyone else in the room should see the question too — the sender
        // already rendered its own copy locally, so skip that one socket.
        broadcastExcept(ws, {
          type: "peer_message",
          id: msg.clientId || null,
          text: msg.text,
          member: me ? { id: me.id, name: me.name, color: me.color } : null,
        });
        await runAgent(msg.text, msg.images, msg.clientId);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      const m = memberOf.get(ws);
      if (m) {
        collab.remove(m.id);
        broadcastCollab();
      }
      for (const p of approvals.values()) p.resolve(false);
      approvals.clear();
      for (const a of asks.values()) a.resolve([]);
      asks.clear();
      // If the last client disconnects mid-run, stop the agent so the next
      // connection isn't blocked by a stuck "already running" flag.
      if (clients.size === 0 && controller) {
        controller.abort();
        controller = null;
        running = false;
      }
      if (clients.size === 0) {
        hooks.run("SessionEnd", undefined, { cwd: config.cwd }).catch(() => {});
      }
    });
  });

  // A malformed request or a socket that drops mid-response must never take
  // the process down.
  httpServer.on("clientError", (_err, socket) => {
    try {
      socket.destroy();
    } catch {
      /* already gone */
    }
  });

  httpServer.listen(config.port, () => {
    console.log(`\n  Spyro Studio running at http://localhost:${config.port}`);
    console.log(`  Working directory: ${config.cwd}`);
    console.log(`  Model: ${config.model.provider}/${config.model.model}`);
    console.log(`  Auto-approve: ${config.autoApprove}`);
    console.log(`  Tools: ${registry.names().length}`);
    if (skills.list().length) console.log(`  Skills: ${skills.list().map((s) => s.name).join(", ")}`);
    if (plugins.length) console.log(`  Plugins: ${plugins.join(", ")}`);
    console.log("");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
