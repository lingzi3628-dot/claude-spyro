import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentInfo,
  AttachedImage,
  ChatItem,
  Checkpoint,
  CommandInfo,
  ContextInfo,
  CronJob,
  HooksInfo,
  McpServerInfo,
  McpToolInfo,
  InstalledPlugin,
  MarketplaceInfo,
  ModelConfig,
  OutputStyleInfo,
  PermissionRules,
  SessionMeta,
  ShellInfo,
  SkillInfo,
  StoredMessage,
  Task,
  Todo,
  UsageInfo,
  UserQuestionAnswer,
  CollabState,
} from "./types";

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatContext(
  c: ContextInfo | null,
  usage: UsageInfo,
  cost: number,
): string {
  if (!c) return "Context: no information available yet.";
  const pct = c.budgetChars ? Math.min(999, Math.round((c.chars / c.budgetChars) * 100)) : 0;
  return [
    "Context window",
    `  messages: ${c.messages}`,
    `  size: ${fmtNum(c.chars)} chars (${pct}% of ${fmtNum(c.budgetChars)} budget)`,
    c.summaryChars
      ? `  compacted summary: ${fmtNum(c.summaryChars)} chars`
      : "  not compacted",
    `  tokens this session: ${fmtNum(usage.totalTokens)} (in ${fmtNum(usage.promptTokens)} / out ${fmtNum(usage.completionTokens)})`,
    cost > 0 ? `  cost: $${cost.toFixed(4)}` : "  cost: free / not reported",
  ].join("\n");
}

function formatHooks(hooks: HooksInfo): string {
  const events = Object.keys(hooks || {});
  if (!events.length) {
    return 'No hooks configured. Add them under "hooks" in ~/.claude-free/settings.json or .claude/settings.json.';
  }
  return [
    "Hooks:",
    ...events.map(
      (ev) =>
        `  ${ev}\n` +
        (hooks[ev] || [])
          .map((h) => `    ${h.matcher || "*"} → ${h.command}`)
          .join("\n"),
    ),
  ].join("\n");
}

function formatMcp(servers: McpServerInfo[], tools: McpToolInfo[]): string {
  if (!servers.length) {
    return "No MCP servers connected. Add them to .mcp.json or ~/.claude-free/mcp.json, then restart the workspace.";
  }
  const lines = ["MCP servers:"];
  for (const s of servers) {
    const where = s.command || s.url || "";
    lines.push(`  ${s.connected ? "●" : "○"} ${s.name} (${s.transport}, ${s.tools} tool${s.tools === 1 ? "" : "s"})${where ? `\n    ${where}` : ""}`);
    for (const t of tools.filter((x) => x.server === s.name)) {
      lines.push(`      • ${t.name.replace(/^mcp__[^_]+__/, "")}${t.description ? ` — ${t.description.slice(0, 80)}` : ""}`);
    }
  }
  return lines.join("\n");
}

function formatAskAnswers(answers: UserQuestionAnswer[]): string {
  if (!answers || !answers.length) return "(no answer)";
  return answers
    .map((a) => {
      const label = a.header || a.question.slice(0, 40);
      const text = a.answers?.length ? a.answers.join(", ") : "(no answer)";
      return `${label}: ${text}`;
    })
    .join("\n");
}

export function useAgent() {
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [model, setModel] = useState<ModelConfig | null>(null);
  const [presets, setPresets] = useState<ModelConfig[]>([]);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [autoApprove, setAutoApprove] = useState(true);
  const [cwd, setCwd] = useState("");
  /** Bumped whenever the server reports the workspace changed on disk. */
  const [fsTick, setFsTick] = useState(0);
  /** The paths from the most recent change, for live-reveal and flashing. */
  const [fsChange, setFsChange] = useState<{ paths: string[]; at: number }>({ paths: [], at: 0 });
  // Live output for the IDE terminal, keyed by terminal instance id.
  const [shellOutput, setShellOutput] = useState<Record<string, string>>({});
  const shellOutputRef = useRef<Record<string, string>>({});
  /**
   * The shell process currently running in each terminal, keyed by terminal id.
   * Ctrl+C needs this to know *what* to interrupt; null means the prompt is idle.
   */
  const [shellRunning, setShellRunning] = useState<Record<string, string | null>>({});
  /** The working directory each terminal is in, so `cd` sticks between commands. */
  const [shellCwd, setShellCwd] = useState<Record<string, string>>({});
  const [plugins, setPlugins] = useState<string[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [compactNote, setCompactNote] = useState<string | null>(null);
  const [subagent, setSubagent] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [permissions, setPermissionsState] = useState<PermissionRules>({ allow: [], deny: [], ask: [] });
  const [usage, setUsage] = useState<UsageInfo>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [collab, setCollab] = useState<CollabState | null>(null);
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [planMode, setPlanMode] = useState(false);
  // Reasoning belongs to ONE turn. It must not accumulate across the session
  // or it ends up floating above unrelated later messages.
  const [reasoning, setReasoning] = useState("");
  const reasoningStart = useRef(0);
  const [, setReasoningMs] = useState(0);
  const [extraDirs, setExtraDirs] = useState<string[]>([]);
  const [reasoningEffort, setReasoningEffortState] = useState<"auto" | "low" | "medium" | "high">("auto");
  const [permissionMode, setPermissionModeState] = useState<
    "default" | "acceptEdits" | "plan" | "bypass"
  >("default");
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [freeProviders, setFreeProviders] = useState<Record<string, any>>({});
  const [needsSetup, setNeedsSetup] = useState(false);
  const [team, setTeam] = useState<{ id: string; done: string[] } | null>(null);
  const [mcpOauthServers, setMcpOauthServers] = useState<{ server: string; url: string; authenticated: boolean }[]>([]);
  const [mcpOauthUrl, setMcpOauthUrl] = useState<{ server: string; url: string } | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [outputStyles, setOutputStyles] = useState<OutputStyleInfo[]>([]);
  const [outputStyle, setOutputStyle] = useState("");
  const [cost, setCost] = useState(0);
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const [hooks, setHooks] = useState<HooksInfo>({});
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [mcpTools, setMcpTools] = useState<McpToolInfo[]>([]);
  const [statusLine, setStatusLine] = useState("");
  const [statusLineCommand, setStatusLineCommand] = useState("");
  const [statusLineError, setStatusLineError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const seenToolIds = useRef<Set<string>>(new Set());

  const push = useCallback((item: ChatItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const updateTool = useCallback(
    (id: string, patch: Partial<Extract<ChatItem, { kind: "tool" }>>) => {
      setItems((prev) =>
        prev.map((it) => (it.kind === "tool" && it.id === id ? { ...it, ...patch } : it)),
      );
    },
    [],
  );

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case "hello":
          setModel(msg.model);
          setPresets(msg.presets || []);
          setAutoApprove(msg.autoApprove);
          setCwd(msg.cwd);
          setPlugins(msg.plugins || []);
          setApiKeys(msg.apiKeys || {});
          if (msg.tasks) setTasks(msg.tasks);
          if (msg.crons) setCrons(msg.crons);
          if (msg.skills) setSkills(msg.skills);
          if (msg.sessions) setSessions(msg.sessions);
          if (msg.currentSessionId) setCurrentSessionId(msg.currentSessionId);
          if (msg.permissions) setPermissionsState(msg.permissions);
          if (msg.shells) setShells(msg.shells);
          if (msg.commands) setCommands(msg.commands);
          if (msg.agents) setAgents(msg.agents);
          if (msg.providers) setProviders(msg.providers);
          if (msg.freeProviders) setFreeProviders(msg.freeProviders);
          if (typeof msg.needsSetup === "boolean") setNeedsSetup(msg.needsSetup);
          if (msg.permissionMode) setPermissionModeState(msg.permissionMode);
          if (msg.reasoningEffort) setReasoningEffortState(msg.reasoningEffort);
          if (msg.extraDirs) setExtraDirs(msg.extraDirs);
          if (msg.outputStyles) setOutputStyles(msg.outputStyles);
          if (msg.outputStyle !== undefined) setOutputStyle(msg.outputStyle);
          if (msg.context) setContextInfo(msg.context);
          if (msg.hooks) setHooks(msg.hooks);
          if (msg.mcpServers) setMcpServers(msg.mcpServers);
          if (msg.usage) setUsage(msg.usage);
          if (typeof msg.cost === "number") setCost(msg.cost);
          if (typeof msg.statusLine === "string") setStatusLineCommand(msg.statusLine);
          break;
        case "fs_change":
          // The workspace changed underneath us. Carry the paths, not just a
          // counter: the IDE needs to know *which* file to point at so it can
          // reveal and flash it while the agent is still writing.
          setFsTick((t) => t + 1);
          setFsChange({ paths: Array.isArray(msg.paths) ? msg.paths : [], at: Date.now() });
          break;
        case "shell_output": {
          // Append streamed output for the IDE terminal that asked for it.
          const t = msg.terminalId;
          const patch: Record<string, string> = {};
          if (t) {
            const prev = shellOutputRef.current[t] || "";
            const next = prev + (msg.output || "");
            shellOutputRef.current[t] = next;
            // Keep the buffer bounded so long builds don't grow without limit.
            if (next.length > 200_000) {
              shellOutputRef.current[t] = next.slice(-150_000);
            }
            patch[t] = shellOutputRef.current[t];
          }
          setShellOutput((o) => ({ ...o, ...patch }));
          if (t) {
            setShellRunning((r) => {
              const next = msg.done ? null : msg.id || r[t] || null;
              return r[t] === next ? r : { ...r, [t]: next };
            });
          }
          break;
        }
        case "shell_cwd":
          if (msg.terminalId && msg.cwd) {
            setShellCwd((c) => ({ ...c, [msg.terminalId]: msg.cwd }));
          }
          break;
        case "state":
          if (msg.cwd) setCwd(msg.cwd);
          if (msg.tasks) setTasks(msg.tasks);
          if (msg.crons) setCrons(msg.crons);
          if (msg.skills) setSkills(msg.skills);
          if (msg.sessions) setSessions(msg.sessions);
          if (msg.currentSessionId) setCurrentSessionId(msg.currentSessionId);
          if (msg.permissions) setPermissionsState(msg.permissions);
          if (msg.shells) setShells(msg.shells);
          if (msg.commands) setCommands(msg.commands);
          if (msg.agents) setAgents(msg.agents);
          if (msg.providers) setProviders(msg.providers);
          if (msg.freeProviders) setFreeProviders(msg.freeProviders);
          if (typeof msg.needsSetup === "boolean") setNeedsSetup(msg.needsSetup);
          if (msg.context) setContextInfo(msg.context);
          if (msg.hooks) setHooks(msg.hooks);
          if (msg.mcpServers) setMcpServers(msg.mcpServers);
          if (msg.usage) setUsage(msg.usage);
          if (typeof msg.cost === "number") setCost(msg.cost);
          if (typeof msg.statusLine === "string") setStatusLineCommand(msg.statusLine);
          break;
        case "context":
          setContextInfo(msg.context || null);
          if (msg.usage) setUsage(msg.usage);
          if (typeof msg.cost === "number") setCost(msg.cost);
          push({
            kind: "system",
            text: formatContext(
              msg.context || null,
              msg.usage || usage,
              typeof msg.cost === "number" ? msg.cost : cost,
            ),
          });
          break;
        case "hooks":
          setHooks(msg.hooks || {});
          push({ kind: "system", text: formatHooks(msg.hooks || {}) });
          break;
        case "mcp":
          setMcpServers(msg.servers || []);
          setMcpTools(msg.tools || []);
          push({ kind: "system", text: formatMcp(msg.servers || [], msg.tools || []) });
          break;
        case "statusline":
          setStatusLine(msg.text || "");
          setStatusLineError(msg.error || null);
          break;
        case "statusline_config":
          setStatusLineCommand(msg.command || "");
          break;
        case "sessions":
          setSessions(msg.sessions || []);
          break;
        case "shells":
          setShells(msg.shells || []);
          break;
        case "commands":
          setCommands(msg.commands || []);
          break;
        case "agents":
          setAgents(msg.agents || []);
          break;
        case "plugins_state":
          setMarketplaces(msg.marketplaces || []);
          setInstalledPlugins(msg.installed || []);
          break;
        case "plan_mode":
          setPlanMode(msg.enabled);
          break;
        case "checkpoints":
          setCheckpoints(msg.checkpoints || []);
          break;
        case "mcp_oauth_status":
          setMcpOauthServers(msg.servers || []);
          break;
        case "mcp_oauth_url":
          setMcpOauthUrl({ server: msg.server, url: msg.url });
          break;
        case "mcp_oauth_need_client":
          push({ kind: "system", text: `MCP server ${msg.server} needs a client_id for OAuth (no dynamic registration). Set a client_id in Settings to continue.` });
          break;
        case "mcp_oauth_done":
          setMcpOauthUrl(null);
          push({ kind: "system", text: `Signed in to MCP server ${msg.server}.` });
          break;
        case "output_styles":
          if (msg.styles) setOutputStyles(msg.styles);
          if (msg.active !== undefined) setOutputStyle(msg.active);
          break;
        case "ask_request":
          push({ kind: "ask", id: msg.id, questions: msg.questions || [] });
          break;
        case "usage": {
          const u = msg.usage || {};
          const prompt = Number(u.prompt_tokens ?? u.promptTokens ?? 0);
          const completion = Number(u.completion_tokens ?? u.completionTokens ?? 0);
          const total = Number(u.total_tokens ?? u.totalTokens ?? prompt + completion);
          setUsage((prev) => ({
            promptTokens: prev.promptTokens + prompt,
            completionTokens: prev.completionTokens + completion,
            totalTokens: prev.totalTokens + total,
          }));
          if (typeof msg.cost === "number") setCost(msg.cost);
          break;
        }
        case "cost_reset":
          setCost(0);
          break;
        case "reset_done":
          break;
        case "permissions":
          setPermissionsState(msg.permissions || { allow: [], deny: [], ask: [] });
          break;
        case "session_loaded": {
          setCurrentSessionId(msg.id);
          seenToolIds.current.clear();
          const converted = (msg.messages || [])
            .map((m: StoredMessage): ChatItem | null => {
              if (m.role === "user") return { kind: "user", text: String(m.content || "") };
              if (m.role === "assistant" && m.content) return { kind: "assistant", text: m.content };
              return null;
            })
            .filter((x: ChatItem | null): x is ChatItem => x !== null);
          setItems(converted);
          setTodos(msg.todos || []);
          setUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
          setCost(0);
          break;
        }
        case "model_updated":
          setModel(msg.model);
          if (msg.apiKeys) setApiKeys(msg.apiKeys);
          setNeedsSetup(false);
          break;
        case "auto_approve_updated":
          setAutoApprove(msg.value);
          break;
        case "cwd_updated":
          setCwd(msg.cwd);
          break;
        case "todos":
          setTodos(msg.todos || []);
          break;
        case "tasks":
          setTasks(msg.tasks || []);
          break;
        case "crons":
          setCrons(msg.crons || []);
          break;
        case "skills":
          setSkills(msg.skills || []);
          break;
        case "notification":
          push({
            kind: "notification",
            title: msg.title || "Notification",
            body: msg.body,
            level: msg.level || "info",
          });
          break;
        case "plan_ready":
          push({ kind: "plan", plan: msg.plan || "" });
          break;
        case "subagent_start":
          setSubagent(msg.description || "subagent");
          push({ kind: "system", text: `▸ subagent started: ${msg.description}` });
          break;
        case "team_start": {
          const members = (msg.roles || []).map((n: string) => ({ name: n, status: "running" as const }));
          setTeam({ id: msg.teamId, done: [] });
          push({ kind: "team", id: msg.teamId, members });
          break;
        }
        case "team_member_start": {
          setItems((prev) => prev.map((it) =>
            it.kind === "team" && it.id === msg.teamId
              ? { ...it, members: it.members.map((m) => (m.name === msg.member ? { ...m, status: "running" } : m)) }
              : it,
          ));
          break;
        }
        case "team_member_end": {
          setItems((prev) => prev.map((it) =>
            it.kind === "team" && it.id === msg.teamId
              ? { ...it, members: it.members.map((m) => (m.name === msg.member ? { ...m, status: "done" } : m)) }
              : it,
          ));
          setTeam((prev) => (prev && prev.id === msg.teamId ? { ...prev, done: [...prev.done, msg.member] } : prev));
          break;
        }
        case "board_post":
          push({ kind: "system", text: `[team board] ${msg.author} → ${msg.topic}: ${String(msg.body).slice(0, 120)}` });
          break;
        case "team_end":
          setTeam(null);
          break;
        case "subagent_end":
          setSubagent(null);
          break;
        case "peer_message":
          // A remote participant (or another window) sent a prompt — show it
          // inline so everyone sees the conversation, not just the reply.
          if (msg.member) {
            push({ kind: "user", text: msg.text, id: msg.id || undefined });
          }
          break;
        case "collab_state":
          setCollab(msg);
          break;
        case "compact_done":
          setCompactNote(msg.note || "Compacted.");
          push({ kind: "system", text: msg.note || "Context compacted." });
          break;
        case "run_start":
          setRunning(true);
          setLastError(null);
          setReasoning("");
          setReasoningMs(0);
          reasoningStart.current = 0;
          break;
        case "run_end":
          setRunning(false);
          setReasoningMs(reasoningStart.current ? Date.now() - reasoningStart.current : 0);
          if (msg.usage || reasoningStart.current) {
            // Freeze this turn's thinking onto the message it belongs to.
            setItems((prev) => {
              const i = prev.map((x) => x).reverse().findIndex((x) => x.kind === "assistant");
              if (i === -1) return prev;
              const at = prev.length - 1 - i;
              const hit = prev[at] as Extract<ChatItem, { kind: "assistant" }>;
              const next = [...prev];
              next[at] = { ...hit, reasoning, reasoningMs: reasoningStart.current ? Date.now() - reasoningStart.current : 0 };
              return next;
            });
          }
          setReasoning("");
          if (msg.usage) {
            // Attach this turn's numbers to the assistant message that just ended.
            setItems((prev) => {
              for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].kind === "assistant") {
                  const hit = prev[i] as Extract<ChatItem, { kind: "assistant" }>;
                  const next = [...prev];
                  next[i] = { ...hit, usage: msg.usage, cost: msg.cost };
                  return next;
                }
              }
              return prev;
            });
          }
          // Refresh the custom status line now that cost/context moved.
          try {
            ws.send(JSON.stringify({ type: "get_statusline" }));
          } catch {
            /* socket closing */
          }
          break;
        case "cancelled":
          setRunning(false);
          break;
        case "assistant_text":
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.kind === "assistant") {
              const copy = prev.slice();
              copy[copy.length - 1] = { ...last, text: last.text + msg.text };
              return copy;
            }
            return [...prev, { kind: "assistant", text: msg.text }];
          });
          break;
        case "tool_start":
          if (msg.name === "ask_user") break;
          if (!seenToolIds.current.has(msg.id)) {
            seenToolIds.current.add(msg.id);
            push({ kind: "tool", id: msg.id, name: msg.name, args: msg.args, status: "running" });
          }
          break;
        case "tool_end":
          updateTool(msg.id, { result: msg.result, status: "done" });
          break;
        case "diff":
          if (msg.callId) updateTool(msg.callId, { diff: msg.diff });
          break;
        case "approval_request":
          push({ kind: "approval", id: msg.id, name: msg.name, args: msg.args, preview: msg.preview });
          break;
        case "extra_dirs":
          setExtraDirs(msg.dirs);
          break;

        case "reasoning_effort":
          setReasoningEffortState(msg.effort);
          break;

        case "assistant_reasoning":
          if (!reasoningStart.current) reasoningStart.current = Date.now();
          setReasoning((prev) => prev + msg.text);
          break;

        case "error":
          setLastError(msg.message);
          push({ kind: "error", text: msg.message });
          break;
      }
    };

    return () => ws.close();
  }, [push, updateTool]);

  const send = useCallback((msg: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const submit = useCallback(
    (text: string, images?: AttachedImage[]) => {
      if ((!text.trim() && !images?.length) || running) return;
      const mid = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      push({ kind: "user", text: text.trim() || `(${images?.length} image(s))`, id: mid });
      send({
        type: "user_message",
        text,
        images: images?.map((i) => ({ media_type: i.media_type, data: i.data })),
        clientId: mid,
      });
    },
    [running, push, send],
  );

  const approve = useCallback(
    (id: string, approved: boolean) => {
      send({ type: "approval_response", id, approved });
      setItems((prev) => prev.filter((it) => !(it.kind === "approval" && it.id === id)));
    },
    [send],
  );

  const cancel = useCallback(() => send({ type: "cancel" }), [send]);

  const setReasoningEffort = useCallback(
    (effort: "auto" | "low" | "medium" | "high") => {
      setReasoningEffortState(effort);
      send({ type: "set_reasoning_effort", effort });
    },
    [send],
  );

  const addDir = useCallback((path: string) => send({ type: "add_dir", path }), [send]);
  const getContext = useCallback(() => send({ type: "get_context" }), [send]);
  const listHooks = useCallback(() => send({ type: "hooks_list" }), [send]);
  const listMcp = useCallback(() => send({ type: "mcp_list" }), [send]);
  const refreshStatusLine = useCallback(() => send({ type: "get_statusline" }), [send]);
  const updateStatusLine = useCallback(
    (command: string) => send({ type: "set_statusline", command }),
    [send],
  );
  /** Start a command in a real shell and stream its output back. */
  const shellStart = useCallback(
    (command: string, cwd: string, terminalId: string) => send({ type: "shell_start", command, cwd, terminalId }),
    [send],
  );
  const shellKill = useCallback(
    (id: string, signal?: "SIGINT" | "SIGKILL" | "SIGTERM") => send({ type: "shell_kill", id, signal }),
    [send],
  );

  /** Park/restore the other surface's conversation (chat <-> ide). */
  const swapSurface = useCallback(
    (surface: "chat" | "ide") => send({ type: "swap_surface", surface }),
    [send],
  );
  const removeDir = useCallback((path: string) => send({ type: "remove_dir", path }), [send]);

  const setPermissionMode = useCallback(
    (mode: "default" | "acceptEdits" | "plan" | "bypass") => {
      setPermissionModeState(mode);
      send({ type: "set_permission_mode", mode });
    },
    [send],
  );

  /** Edit an earlier message: server truncates history and re-runs from there. */
  const editMessage = useCallback(
    (messageId: string, text: string) => {
      setItems((prev) => {
        const i = prev.findIndex((it) => it.kind === "user" && it.id === messageId);
        if (i === -1) return prev;
        return [...prev.slice(0, i), { kind: "user", text, id: messageId, edited: true }];
      });
      send({ type: "edit_message", messageId, text });
    },
    [send],
  );
  const reset = useCallback(() => {
    send({ type: "reset" });
    setItems([]);
    setTodos([]);
    setUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
          setCost(0);
    seenToolIds.current.clear();
  }, [send]);

  const forceCompact = useCallback(() => send({ type: "force_compact" }), [send]);

  const setWorkspaceCwd = useCallback(
    (path: string) => {
      send({ type: "set_cwd", path });
    },
    [send],
  );

  const pushSystem = useCallback((text: string) => {
    setItems((prev) => [...prev, { kind: "system", text }]);
  }, []);

  const setModelConfig = useCallback(
    (cfg: ModelConfig) => {
      send({ type: "set_model", model: cfg });
    },
    [send],
  );

  const toggleAutoApprove = useCallback(
    (value: boolean) => {
      setAutoApprove(value);
      send({ type: "set_auto_approve", value });
    },
    [send],
  );

  const listSessions = useCallback(() => send({ type: "list_sessions" }), [send]);

  const newSession = useCallback(() => {
    send({ type: "new_session" });
    setItems([]);
    setTodos([]);
    setUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
          setCost(0);
    seenToolIds.current.clear();
  }, [send]);

  const loadSession = useCallback(
    (id: string) => {
      send({ type: "load_session", id });
    },
    [send],
  );

  const deleteSession = useCallback(
    (id: string) => {
      send({ type: "delete_session", id });
    },
    [send],
  );

  const setPermissions = useCallback(
    (rules: PermissionRules) => {
      setPermissionsState(rules);
      send({ type: "set_permissions", permissions: rules });
    },
    [send],
  );

  const killShell = useCallback(
    (id: string) => {
      send({ type: "kill_shell", id });
    },
    [send],
  );

  const answer = useCallback(
    (id: string, answers: UserQuestionAnswer[]) => {
      send({ type: "ask_response", id, answers });
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "ask" && it.id === id
            ? { kind: "user", text: formatAskAnswers(answers) }
            : it,
        ),
      );
    },
    [send],
  );

  const runCommand = useCallback(
    (name: string, args: string) => {
      const raw = "/" + name + (args ? " " + args : "");
      push({ kind: "user", text: raw });
      send({ type: "run_command", name, args });
    },
    [send, push],
  );

  const pluginList = useCallback(() => send({ type: "plugin_list" }), [send]);
  const pluginAddMarketplace = useCallback(
    (repo: string) => send({ type: "plugin_add_marketplace", repo }),
    [send],
  );
  const pluginRemoveMarketplace = useCallback(
    (name: string) => send({ type: "plugin_remove_marketplace", name }),
    [send],
  );
  const pluginInstall = useCallback(
    (name: string, marketplace?: string) => send({ type: "plugin_install", name, marketplace }),
    [send],
  );
  const pluginUninstall = useCallback(
    (name: string) => send({ type: "plugin_uninstall", name }),
    [send],
  );
  const pluginToggle = useCallback(
    (name: string, enabled: boolean) => send({ type: "plugin_toggle", name, enabled }),
    [send],
  );
  const pluginUpdate = useCallback(
    (name?: string) => send({ type: "plugin_update", name }),
    [send],
  );

  const togglePlanMode = useCallback(
    (enabled: boolean) => {
      setPlanMode(enabled);
      send({ type: "set_plan_mode", enabled });
    },
    [send],
  );

  const mcpOauthStatus = useCallback(() => send({ type: "mcp_oauth_status" }), [send]);
  const mcpOauthStart = useCallback((server: string) => send({ type: "mcp_oauth_start", server }), [send]);
  const mcpOauthSubmit = useCallback(
    (server: string, code: string) => send({ type: "mcp_oauth_callback", server, code }),
    [send],
  );
  const mcpOauthDisconnect = useCallback(
    (server: string) => send({ type: "mcp_oauth_disconnect", server }),
    [send],
  );

  const listCheckpoints = useCallback(() => send({ type: "checkpoint_list" }), [send]);
  const rewindCheckpoint = useCallback(
    (id: string) => send({ type: "checkpoint_rewind", id }),
    [send],
  );
  const setActiveOutputStyle = useCallback(
    (name: string) => send({ type: "set_output_style", name }),
    [send],
  );

  return {
    connected,
    fsTick,
    fsChange,
    running,
    items,
    model,
    presets,
    apiKeys,
    autoApprove,
    cwd,
    plugins,
    lastError,
    todos,
    tasks,
    crons,
    skills,
    compactNote,
    subagent,
    sessions,
    currentSessionId,
    permissions,
    usage,
    cost,
    shells,
    extraDirs,
    addDir,
    getContext,
    listHooks,
    listMcp,
    refreshStatusLine,
    updateStatusLine,
    removeDir,
    swapSurface,
    shellStart,
    shellKill,
    shellOutput,
    shellRunning,
    shellCwd,
    reasoning,
    reasoningEffort,
    setReasoningEffort,
    clearReasoning: () => setReasoning(""),
    commands,
    agents,
    permissionMode,
    setPermissionMode,
    editMessage,
    providers,
    freeProviders,
    needsSetup,
    marketplaces,
    installedPlugins,
    submit,
    approve,
    answer,
    runCommand,
    cancel,
    reset,
    forceCompact,
    pushSystem,
    setCwd,
    setWorkspaceCwd,
    setModelConfig,
    toggleAutoApprove,
    listSessions,
    newSession,
    loadSession,
    deleteSession,
    setPermissions,
    killShell,
    pluginList,
    pluginAddMarketplace,
    pluginRemoveMarketplace,
    pluginInstall,
    pluginUninstall,
    pluginToggle,
    pluginUpdate,
    planMode,
    togglePlanMode,
    team,
    mcpOauthServers,
    mcpOauthUrl,
    mcpOauthStatus,
    mcpOauthStart,
    mcpOauthSubmit,
    mcpOauthDisconnect,
    checkpoints,
    listCheckpoints,
    rewindCheckpoint,
    outputStyles,
    outputStyle,
    contextInfo,
    hooks,
    mcpServers,
    mcpTools,
    statusLine,
    statusLineCommand,
    statusLineError,
    setActiveOutputStyle,
    collab,
    collabCreateRoom: () => send({ type: "collab_create_room" }),
    collabCloseRoom: () => send({ type: "collab_close_room" }),
    collabSetReadOnly: (value: boolean) => send({ type: "collab_set_readonly", value }),
    collabSetRole: (id: string, role: "editor" | "viewer") => send({ type: "collab_set_role", id, role }),
    collabRename: (id: string, name: string) => send({ type: "collab_rename", id, name }),
  };
}
