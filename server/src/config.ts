import type { PermissionRules } from "./infra/permissions.js";
import { emptyRules } from "./infra/permissions.js";
import { loadProjectSettings } from "./infra/settings.js";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypass";

/** How a mode maps onto the two primitives we actually enforce. */
export function resolvePermissionMode(mode: PermissionMode): {
  autoApprove: boolean;
  planMode: boolean;
} {
  switch (mode) {
    case "acceptEdits":
      return { autoApprove: true, planMode: false };
    case "plan":
      return { autoApprove: false, planMode: true };
    case "bypass":
      return { autoApprove: true, planMode: false };
    case "default":
    default:
      return { autoApprove: false, planMode: false };
  }
}

export type ProviderId =
  | "openrouter"
  | "ollama"
  | "openai"
  | "anthropic"
  | "openai-compatible"
  | "huggingface"
  | "groq"
  | "cerebras"
  | "gemini"
  | "mistral"
  | "nvidia"
  | "together"
  | "deepseek"
  | "xai"
  | "github";

export interface ModelConfig {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
}

export interface ServerConfig {
  model: ModelConfig;
  autoApprove: boolean;
  /**
   * Claude-Code-style permission mode. Derives autoApprove + planMode so the
   * existing enforcement paths stay in one place.
   *   default      - ask before running anything
   *   acceptEdits  - auto-apply file edits, still ask before shell commands
   *   plan         - read-only research, propose before acting
   *   bypass       - run everything without asking
   */
  permissionMode?: PermissionMode;
  /**
   * Extra folders the agent may also work in, like Claude Code's `--add-dir`.
   * The primary cwd stays the default for new files; these are for reading and
   * editing alongside it.
   */
  extraDirs?: string[];
  /**
   * How hard the model should think. Maps to the provider's own knob
   * (OpenAI reasoning_effort, Anthropic thinking budget, Ollama think).
   * "auto" leaves it to the provider default.
   */
  reasoningEffort?: "auto" | "low" | "medium" | "high";
  cwd: string;
  port: number;
  /** Extra provider presets the UI can switch between. */
  presets: ModelConfig[];
  /**
   * Per-provider API keys. Stored separately so the user can switch providers
   * and keys freely without one key overwriting or locking another.
   */
  apiKeys: Record<string, string>;
  permissions: PermissionRules;
  /**
   * Custom status line (Claude Code parity). The command is run with a JSON
   * payload on stdin; its first stdout line is displayed in the UI.
   */
  statusLine?: { type: "command"; command: string };
}

const CONFIG_DIR = join(homedir(), ".claude-free");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Absolute path to the Spyro Studio app's own source tree.
 * The agent must NEVER write here — that's what broke it before.
 * This is computed from the compiled server location, not from cwd,
 * so it stays correct no matter where the agent is pointed.
 */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Default port for the Spyro Studio server. */
export const DEFAULT_PORT = 8791;
/** The old default, kept so an existing config does not pin the conflict. */
export const LEGACY_DEFAULT_PORT = 8787;

/** The agent's dedicated workspace — a plain folder, outside the app. */
export const DEFAULT_WORKSPACE = join(homedir(), "claude-projects");

export const DEFAULT_PRESETS: ModelConfig[] = [
  // --- Free OpenRouter models (no extra signup) ---
  { provider: "openrouter", model: "nvidia/nemotron-3.5-super-vl:free", baseUrl: "https://openrouter.ai/api/v1" },
  { provider: "openrouter", model: "qwen/qwen3-coder:free", baseUrl: "https://openrouter.ai/api/v1" },
  { provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324:free", baseUrl: "https://openrouter.ai/api/v1" },
  { provider: "openrouter", model: "z-ai/glm-4.5-air:free", baseUrl: "https://openrouter.ai/api/v1" },
  { provider: "openrouter", model: "anthropic/claude-3.5-sonnet", baseUrl: "https://openrouter.ai/api/v1" },

  // --- Other free tiers (bring your own free key) ---
  {
    provider: "huggingface",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    baseUrl: "https://router.huggingface.co/v1",
  },
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  { provider: "cerebras", model: "llama-3.3-70b", baseUrl: "https://api.cerebras.ai/v1" },
  {
    provider: "gemini",
    model: "gemini-2.0-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  { provider: "mistral", model: "mistral-small-latest", baseUrl: "https://api.mistral.ai/v1" },
  {
    provider: "nvidia",
    model: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  },
  { provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", baseUrl: "https://api.together.xyz/v1" },
  { provider: "github", model: "openai/gpt-4o-mini", baseUrl: "https://models.github.ai/inference" },
  { provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
  { provider: "xai", model: "grok-2-latest", baseUrl: "https://api.x.ai/v1" },

  // --- Local ---
  { provider: "ollama", model: "qwen2.5-coder:7b", baseUrl: "http://localhost:11434/v1" },
  { provider: "ollama", model: "qwen2.5-coder:1.5b", baseUrl: "http://localhost:11434/v1" },
  { provider: "openai", model: "gpt-4o", baseUrl: "https://api.openai.com/v1" },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com/v1",
  },
];

export const DEFAULT_BASE_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  "openai-compatible": "http://localhost:8000/v1",
  // Free-tier / OpenAI-compatible providers (verified reachable).
  huggingface: "https://router.huggingface.co/v1",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  mistral: "https://api.mistral.ai/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  together: "https://api.together.xyz/v1",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  github: "https://models.github.ai/inference",
};

/** Providers that offer a usable free tier, with how to get a key. */
export const FREE_PROVIDER_INFO: Record<string, { label: string; freeTier: string; keyUrl: string }> = {
  huggingface: { label: "Hugging Face", freeTier: "Free credits on a free account", keyUrl: "https://huggingface.co/settings/tokens" },
  groq: { label: "Groq", freeTier: "Free tier, very fast", keyUrl: "https://console.groq.com/keys" },
  cerebras: { label: "Cerebras", freeTier: "Free tier, fast", keyUrl: "https://cloud.cerebras.ai" },
  gemini: { label: "Google Gemini", freeTier: "Free tier via AI Studio", keyUrl: "https://aistudio.google.com/apikey" },
  mistral: { label: "Mistral", freeTier: "Free tier (small models)", keyUrl: "https://console.mistral.ai/api-keys" },
  nvidia: { label: "NVIDIA NIM", freeTier: "Free developer credits", keyUrl: "https://build.nvidia.com" },
  together: { label: "Together AI", freeTier: "Free trial credits", keyUrl: "https://api.together.ai/settings/api-keys" },
  github: { label: "GitHub Models", freeTier: "Free with a GitHub token", keyUrl: "https://github.com/settings/tokens" },
  deepseek: { label: "DeepSeek", freeTier: "Very low cost", keyUrl: "https://platform.deepseek.com/api_keys" },
  xai: { label: "xAI", freeTier: "Paid", keyUrl: "https://console.x.ai" },
  openrouter: { label: "OpenRouter", freeTier: "Free models (50/day)", keyUrl: "https://openrouter.ai/keys" },
};

/**
 * Env var names that can supply a default key for each provider.
 * These are only defaults — a key saved from the UI always wins, so the
 * user is never locked to whichever key happens to be exported.
 */
const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openrouter: ["OPENROUTER_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  huggingface: ["HF_TOKEN", "HUGGINGFACE_API_KEY", "HUGGINGFACEHUB_API_TOKEN"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  xai: ["XAI_API_KEY"],
  github: ["GITHUB_TOKEN"],
  ollama: [],
  "openai-compatible": [],
};

function envKeyFor(provider: string): string | undefined {
  for (const name of PROVIDER_ENV_KEYS[provider] || []) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

/** All provider keys, with env defaults filled in and saved keys taking precedence. */
export function resolveApiKeys(file: Partial<ServerConfig>): Record<string, string> {
  const apiKeys: Record<string, string> = {};
  for (const p of Object.keys(DEFAULT_BASE_URLS)) {
    const k = envKeyFor(p);
    if (k) apiKeys[p] = k;
  }
  // A generic API_KEY applies to the active provider only.
  const active = file.model?.provider;
  if (process.env.API_KEY && active) apiKeys[active] = process.env.API_KEY;
  // Migrate a legacy single stored key into the per-provider map.
  if (file.model?.apiKey && file.model.provider) {
    apiKeys[file.model.provider] = file.model.apiKey;
  }
  // Keys saved from the UI always win.
  for (const [p, k] of Object.entries(file.apiKeys || {})) {
    if (typeof k === "string") apiKeys[p] = k;
  }
  return apiKeys;
}

export function readConfigFile(): Partial<ServerConfig> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function writeConfigFile(cfg: Partial<ServerConfig>): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const merged = { ...readConfigFile(), ...cfg };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

export function loadConfig(): ServerConfig {
  const file = readConfigFile();
  const cwd0 = process.env.CLAUDE_FREE_CWD || file.cwd || DEFAULT_WORKSPACE;
  const settings = loadProjectSettings(cwd0);

  const provider = (process.env.PROVIDER as ModelConfig["provider"]) ||
    file.model?.provider ||
    "openrouter";
  const model = process.env.MODEL || settings.model || file.model?.model || DEFAULT_PRESETS[0].model;

  // Per-provider keys: env defaults, then UI-saved keys (which always win).
  const apiKeys = resolveApiKeys(file);
  const apiKey = apiKeys[provider] ?? file.model?.apiKey;
  const baseUrl = process.env.BASE_URL || file.model?.baseUrl ||
    DEFAULT_BASE_URLS[provider];

  const modelCfg: ModelConfig = {
    provider,
    model,
    apiKey,
    baseUrl,
    temperature: file.model?.temperature ?? settings.temperature ?? 0,
    maxTokens: file.model?.maxTokens ?? settings.maxTokens ?? 8192,
    headers: file.model?.headers,
  };

  // The agent's working folder must be a real workspace, NOT the app's own source.
  // Fall back to the default workspace if none is set or if it's set to the app root.
  let cwd = process.env.CLAUDE_FREE_CWD || file.cwd || DEFAULT_WORKSPACE;
  if (resolve(cwd) === APP_ROOT) {
    cwd = DEFAULT_WORKSPACE;
  }
  // Create the workspace on first run so it's always usable.
  try {
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
  } catch {
    // ignore — non-fatal
  }

  return {
    model: modelCfg,
    autoApprove: file.autoApprove ?? settings.autoApprove ?? true,
    reasoningEffort: file.reasoningEffort ?? "auto",
    extraDirs: Array.isArray(file.extraDirs) ? file.extraDirs.filter((d) => typeof d === "string") : [],
    permissionMode: file.permissionMode ?? (file.autoApprove ?? settings.autoApprove) === false ? "default" : "bypass",
    cwd,
    // 8787 is Turbopack's default, so any Next.js 16 project the user runs
    // fails with EADDRINUSE. Our own port stays out of the way.
    port: Number(
      process.env.PORT ||
        // A saved 8787 was just the old default, not a deliberate choice.
        (file.port && file.port !== LEGACY_DEFAULT_PORT ? file.port : DEFAULT_PORT),
    ),
    presets: file.presets?.length ? file.presets : DEFAULT_PRESETS,
    apiKeys,
    permissions: file.permissions || settings.permissions || emptyRules(),
  };
}

export function saveModelConfig(cfg: ModelConfig, apiKeys?: Record<string, string>): void {
  // Persist the full per-provider key map so switching providers never
  // drops another provider's saved key. Falls back to merging the file.
  let keys: Record<string, string>;
  if (apiKeys) {
    keys = { ...apiKeys };
    if (cfg.apiKey) keys[cfg.provider] = cfg.apiKey;
    else delete keys[cfg.provider];
  } else {
    const file = readConfigFile();
    keys = { ...(file.apiKeys || {}) };
    if (cfg.apiKey) keys[cfg.provider] = cfg.apiKey;
    else delete keys[cfg.provider];
  }
  writeConfigFile({ model: cfg, apiKeys: keys });
}

export { CONFIG_PATH };
