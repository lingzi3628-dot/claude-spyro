export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  subject: string;
  description?: string;
  status: TaskStatus;
  owner?: string;
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  createdAt: number;
  nextRun: number;
  runCount: number;
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface CommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
}

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  header?: string;
  options?: UserQuestionOption[];
  multiple?: boolean;
}

export interface UserQuestionAnswer {
  header?: string;
  question: string;
  answers: string[];
}

export interface MarketplacePluginEntry {
  name: string;
  source?: string;
  description?: string;
  version?: string;
}

export interface MarketplaceInfo {
  name: string;
  repo: string;
  path: string;
  description?: string;
  plugins: MarketplacePluginEntry[];
}

export interface PluginComponents {
  commands?: string;
  agents?: string;
  skills?: string;
  hooks?: string;
  mcp?: string;
}

export interface InstalledPlugin {
  name: string;
  path: string;
  version?: string;
  description?: string;
  marketplace?: string;
  enabled: boolean;
  components: PluginComponents;
}

export type NotifyLevel = "info" | "success" | "warning" | "error";

export type ChatItem =
  | { kind: "user"; text: string; id?: string; edited?: boolean }
  | {
      kind: "assistant";
      text: string;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      cost?: number;
      /** Chain-of-thought for this turn, with how long it took. */
      reasoning?: string;
      reasoningMs?: number;
    }
  | { kind: "system"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, any>;
      result?: string;
      status: "running" | "done" | "denied";
      diff?: string;
    }
  | { kind: "error"; text: string }
  | { kind: "notification"; title: string; body?: string; level: NotifyLevel }
  | { kind: "plan"; plan: string }
  | {
      kind: "approval";
      id: string;
      name: string;
      args: Record<string, any>;
      preview?: string;
    }
  | {
      kind: "ask";
      id: string;
      questions: UserQuestion[];
    }
  | { kind: "team"; id: string; members: { name: string; status: "running" | "done" }[] };

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  cwd: string;
  status?: "idle" | "running" | "needs_input";
  diffStats?: { added: number; removed: number };
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ContextInfo {
  messages: number;
  chars: number;
  budgetChars: number;
  summaryChars: number;
  compacted: boolean;
}

export interface HookDefInfo {
  matcher?: string;
  command: string;
  timeout?: number;
}

export type HooksInfo = Partial<Record<string, HookDefInfo[]>>;

export interface McpServerInfo {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  url?: string;
  connected: boolean;
  tools: number;
}

export interface McpToolInfo {
  name: string;
  server: string;
  description?: string;
}

export interface ShellInfo {
  id: string;
  command: string;
  cwd: string;
  done: boolean;
  exitCode: number | null;
  startedAt: number;
  finishedAt?: number;
  tail: string;
}

export interface PermissionRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface RemoteModel {
  id: string;
  name?: string;
  context?: number;
  free?: boolean;
}

export type ProviderHealth = "ok" | "needs-key" | "down";

export interface ProviderStatus {
  id: string;
  baseUrl: string;
  health: ProviderHealth;
  models?: number;
  latencyMs: number;
  error?: string;
}

export interface DetectedServer {
  id: string;
  label: string;
  provider: "ollama" | "openai-compatible";
  baseUrl: string;
  hint: string;
  reachable: boolean;
  models: RemoteModel[];
  error?: string;
}

export interface StoredMessage {
  role: string;
  content: string | null;
  name?: string;
  tool_calls?: { id: string; name: string; arguments: Record<string, any> }[];
}

export interface PlanModeState {
  enabled: boolean;
}

export interface Checkpoint {
  id: string;
  sessionId: string;
  createdAt: number;
  label: string;
  fileCount?: number;
  messageCount?: number;
}

export interface OutputStyleInfo {
  name: string;
  description: string;
}

export interface AttachedImage {
  media_type: string;
  data: string;
  name: string;
}

export interface CollabMember {
  id: string;
  name: string;
  color: string;
  role: "owner" | "editor" | "viewer";
  local: boolean;
  file: string | null;
  line: number | null;
  joinedAt: number;
  lastSeen: number;
}

export interface CollabState {
  room: string | null;
  readOnly: boolean;
  members: CollabMember[];
  url: string | null;
  lan: string | null;
  port: number;
}
