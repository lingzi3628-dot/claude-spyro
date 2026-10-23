import type { ToolDef } from "../types.js";
import type { TodoStore } from "../todos.js";

export type { ToolDef };

export interface ShellHandle {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  output: string;
  readOffset: number;
  done: boolean;
  exitCode: number | null;
  timedOut: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface ShellReadResult {
  output: string;
  readOffset: number;
  totalLength: number;
  done: boolean;
  exitCode: number | null;
}

export interface ShellCapability {
  start(command: string, cwd: string, timeoutMs?: number): ShellHandle;
  read(id: string, sinceOffset?: number): ShellReadResult | null;
  kill(id: string): boolean;
  list(): ShellHandle[];
  get?(id: string): ShellHandle | undefined;
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

export interface TaskInput {
  subject: string;
  description?: string;
  status?: TaskStatus;
  owner?: string;
}

export interface TaskStoreCapability {
  create(input: TaskInput): Task;
  get(id: string): Task | undefined;
  list(): Task[];
  update(
    id: string,
    patch: Partial<Pick<Task, "subject" | "description" | "status" | "owner" | "result">>,
  ): Task | undefined;
  stop(id: string): Task | undefined;
  describe?(): string;
}

export interface Skill {
  name: string;
  description: string;
  path: string;
  body: string;
  dir: string;
}

export interface SkillCapability {
  list(): Skill[];
  get(name: string): Skill | undefined;
}

export interface McpTool {
  name: string;
  remoteName: string;
  server: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpCapability {
  allTools(): McpTool[];
  callTool(server: string, remoteName: string, args: Record<string, any>): Promise<string>;
  allResources?(): { name: string; server: string; uri: string; description?: string; mimeType?: string }[];
  readResource?(server: string, uri: string): Promise<string>;
  allPrompts?(): {
    name: string;
    server: string;
    description?: string;
    arguments?: { name: string; description?: string; required?: boolean }[];
  }[];
  getPrompt?(server: string, name: string, args: Record<string, string>): Promise<string>;
}

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  createdAt: number;
  nextRun: number;
  runCount: number;
}

export interface CronCapability {
  create(schedule: string, prompt: string): CronJob | null;
  list(): CronJob[];
  delete(id: string): boolean;
}

export interface SubagentOptions {
  /** Short description shown to the user (3-5 words). */
  description: string;
  /** The task the subagent must accomplish. */
  prompt: string;
  /** Restrict the subagent to these tool names (defaults to a safe read/write set). */
  allowedTools?: string[];
  maxSteps?: number;
  /** Optional system instructions that override the default subagent preamble. */
  systemPrompt?: string;
}

export interface TeamRole {
  name: string;
  focus: string;
}

export interface TeamOptions {
  /** The shared goal every member works toward. */
  task: string;
  /** The roles to run in parallel. */
  roles: TeamRole[];
  maxSteps?: number;
  /** Cap how many members run at once (default: all). */
  concurrency?: number;
}

/** Shared blackboard so parallel team members can exchange findings. */
export interface BoardCapability {
  post(author: string, topic: string, body: string): void;
  read(opts: { author?: string; topic?: string; since?: number }): unknown[];
  render(excludeAuthor?: string): string;
  onPost(fn: (e: any) => void): () => void;
}

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  header?: string;
  options?: UserQuestionOption[];
  /** Allow selecting more than one option. */
  multiple?: boolean;
}

export interface UserQuestionAnswer {
  header?: string;
  question: string;
  answers: string[];
}

/** A user-defined subagent definition loaded from .claude/agents/*.md. */
export interface AgentInfo {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  body: string;
}

export interface AgentCapability {
  list(): AgentInfo[];
  get(name: string): AgentInfo | undefined;
  catalog?(): string;
}

export interface CommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface CommandCapability {
  list(): CommandInfo[];
  catalog(): string;
}

export type NotifyLevel = "info" | "success" | "warning" | "error";

export interface ToolContext {
  cwd: string;
  todos: TodoStore;
  /** Absolute dirs the agent must never write/edit (e.g. the app's own source). */
  protectedDirs: string[];
  /** Ask the client to approve a potentially dangerous action. */
  approve: (req: { name: string; args: Record<string, any>; preview?: string }) => Promise<boolean>;
  emit: (event: Record<string, any>) => void;
  /** Id of the tool call currently executing (used to attach emitted data, e.g. diffs). */
  callId?: string;

  /** Background shell manager (bash_output / kill_shell). */
  shells?: ShellCapability;
  /** Persistent task board (task_create / task_list / …). */
  tasks?: TaskStoreCapability;
  /** Skills loaded from .claude/skills (skill tool). */
  skills?: SkillCapability;
  /** Connected MCP servers (dynamic mcp__* tools). */
  mcp?: McpCapability;
  /** Cron scheduler for recurring prompts (cron_create / …). */
  crons?: CronCapability;
  /** Run a nested, isolated subagent (task tool). */
  runSubagent?: (opts: SubagentOptions) => Promise<string>;
  /** Run several subagents in parallel that share a board (team tool). */
  runTeam?: (opts: TeamOptions) => Promise<string>;
  /** Surface a notification to the user's UI. */
  notify?: (opts: { title: string; body?: string; level?: NotifyLevel }) => void;
  /** Ask the user one or more clarifying questions and await their answers. */
  askUser?: (req: { questions: UserQuestion[] }) => Promise<UserQuestionAnswer[]>;
  /** Capture a file's pre-edit state before this tool mutates it. */
  markEdit?: (absPath: string) => void;
  /** Configured per-provider API keys (github tools read GITHUB_TOKEN from here). */
  apiKeys?: Record<string, string>;
  /** The team blackboard (only present inside team members). */
  board?: BoardCapability;
  /** The name this subagent goes by on the board. */
  memberName?: string;
  /** User-defined subagents (task tool's subagent_type). */
  agents?: AgentCapability;
  /** Custom slash commands (.claude/commands/*.md). */
  commands?: CommandCapability;
}

/** True if the resolved path lives inside a protected directory. */
export function isProtected(ctx: ToolContext, absPath: string): boolean {
  return ctx.protectedDirs.some(
    (dir) => absPath === dir || absPath.startsWith(dir.replace(/\/$/, "") + "/"),
  );
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  /** If true, the agent asks the client for approval before running. */
  requiresApproval?: boolean;
  execute(args: Record<string, any>, ctx: ToolContext): Promise<string>;
}

export function toToolDefs(tools: Tool[]): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export function safeResolve(cwd: string, p: string): string {
  if (!p) return cwd;
  return p.startsWith("/") ? p : new URL(p, `file://${cwd}/`).pathname;
}

export interface CollabCapability {
  state(): { room: string | null; readOnly: boolean; members: any[]; url: string | null; lan: string | null; port: number };
  createRoom(): string;
  closeRoom(): string | null;
  setReadOnly(value: boolean): void;
  setRole(id: string, role: "owner" | "editor" | "viewer"): any;
  rename(id: string, name: string): any;
  list(): any[];
  inviteUrl(): string | null;
}
