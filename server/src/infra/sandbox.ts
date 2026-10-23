import { spawnSync, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { shellArgv, isWindows } from "./shell.js";

/**
 * OS-level sandboxing for the bash tool.
 *
 * Layers, strongest first — each is used only if the host supports it:
 *   1. bubblewrap (bwrap) — namespace isolation: read-only system, rw workspace,
 *      optional network off. Best isolation, needs the binary.
 *   2. unshare(CLONE_NEWNET) — drops the network without bwrap.
 *   3. prlimit — kernel resource limits (CPU, address space, file size, procs).
 *      Always available where the prlimit binary exists.
 *   4. policy checks — always on: pattern-based blocking of destructive commands.
 *
 * When no kernel isolation is available the sandbox degrades gracefully and
 * reports it, rather than pretending to isolate.
 */

export interface SandboxSupport {
  bwrap: boolean;
  unshare: boolean;
  prlimit: boolean;
  /** The strongest layer we can actually enforce here. */
  strongest: "bwrap" | "netns" | "rlimits" | "policy-only";
}

let cachedSupport: SandboxSupport | null = null;

function findBinary(name: string): string | undefined {
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const p = join(dir, name);
    try {
      if (existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  for (const p of [`/usr/bin/${name}`, `/bin/${name}`, `/usr/local/bin/${name}`]) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Probe which isolation primitives this host actually permits. */
export function detectSupport(): SandboxSupport {
  if (cachedSupport) return cachedSupport;

  const bwrapBin = findBinary("bwrap");
  let bwrap = false;
  if (bwrapBin) {
    try {
      const r = spawnSync(
        bwrapBin,
        ["--ro-bind", "/", "/", "--unshare-all", "--die-with-parent", "/bin/true"],
        { timeout: 8000, stdio: "ignore" },
      );
      bwrap = r.status === 0;
    } catch {
      bwrap = false;
    }
  }

  const unshareBin = findBinary("unshare");
  let unshare = false;
  if (unshareBin) {
    try {
      const r = spawnSync(unshareBin, ["--net", "/bin/true"], { timeout: 8000, stdio: "ignore" });
      unshare = r.status === 0;
    } catch {
      unshare = false;
    }
  }

  const prlimit = !!findBinary("prlimit");

  cachedSupport = {
    bwrap,
    unshare,
    prlimit,
    strongest: bwrap ? "bwrap" : unshare ? "netns" : prlimit ? "rlimits" : "policy-only",
  };
  return cachedSupport;
}

export interface ResourceLimits {
  /** CPU seconds. */
  cpuSeconds?: number;
  /** Address space in bytes (RLIMIT_AS). */
  memoryBytes?: number;
  /** Max file size in bytes (RLIMIT_FSIZE). */
  fileSizeBytes?: number;
  /** Max child processes (RLIMIT_NPROC). */
  maxProcesses?: number;
  /** Max open files (RLIMIT_NOFILE). */
  maxOpenFiles?: number;
}

export const DEFAULT_LIMITS: Required<Pick<ResourceLimits, "cpuSeconds" | "maxProcesses" | "maxOpenFiles">> = {
  // Generous: real builds (webpack/next/tsc on a large codebase) burn CPU for
  // minutes. A tight cap silently kills legitimate work, while no cap at all
  // lets one runaway command wedge the machine.
  cpuSeconds: 900,
  maxProcesses: 512,
  maxOpenFiles: 8192,
};

/**
 * Build the bwrap argv for a command. Returns null when bwrap is unavailable.
 * System paths are read-only; only the workspace and temp are writable.
 */
export function buildBwrapArgs(
  bwrapBin: string,
  workspace: string,
  cmd: string,
  opts: { allowNetwork: boolean; extraWriteDirs?: string[] } = { allowNetwork: false },
): string[] {
  const args = [
    bwrapBin,
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/sbin", "/sbin",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", "/etc", "/etc",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--bind", workspace, workspace,
    "--chdir", workspace,
    "--die-with-parent",
    "--new-session",
  ];
  for (const d of opts.extraWriteDirs || []) {
    if (d && existsSync(d)) args.push("--bind", d, d);
  }
  if (!opts.allowNetwork) args.push("--unshare-net");
  args.push("--", "/bin/bash", "-lc", cmd);
  return args;
}

// --- Policy layer (always on) ------------------------------------------------

export interface PolicyViolation {
  pattern: RegExp;
  reason: string;
  severity: "block" | "warn";
}

export const DEFAULT_POLICY: PolicyViolation[] = [
  { pattern: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+\/(\s|$)/, reason: "recursive delete of the filesystem root", severity: "block" },
  { pattern: /\bmkfs(\.|\s)/, reason: "formatting a filesystem", severity: "block" },
  { pattern: /\bdd\b[^|;]*\bof=\/dev\//, reason: "writing raw to a block device", severity: "block" },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/, reason: "powering off or rebooting the machine", severity: "block" },
  { pattern: /\bchmod\s+(-[a-zA-Z]+\s+)*777\s+\//, reason: "world-writable permissions on system paths", severity: "warn" },
  { pattern: /:\(\)\s*\{.*\|.*&.*\}\s*;?\s*:/, reason: "fork bomb", severity: "block" },
  { pattern: /\bchown\b[^|;]*\s\/(\s|$)/, reason: "changing ownership of system paths", severity: "warn" },
  { pattern: />\s*\/dev\/(sd|nvme|hd)/, reason: "redirecting output to a raw disk device", severity: "block" },
];

/** Check a command against the policy list. Returns blocking reasons. */
export function assessCommand(
  command: string,
  policy: PolicyViolation[] = DEFAULT_POLICY,
): { blocks: string[]; warnings: string[] } {
  const blocks: string[] = [];
  const warnings: string[] = [];
  for (const rule of policy) {
    if (rule.pattern.test(command)) {
      if (rule.severity === "block") blocks.push(rule.reason);
      else warnings.push(rule.reason);
    }
  }
  return { blocks, warnings };
}

/**
 * Full sandbox resolution for a command: returns how it should be spawned.
 * Prefer this over calling spawn() directly.
 */
export interface SandboxPlan {
  command: string;
  args: string[];
  opts: SpawnOptions;
  /** Which isolation layer is actually in effect. */
  layer: SandboxSupport["strongest"];
  warnings: string[];
  blocked: string[];
}

/**
 * Point TMPDIR at a roomy directory.
 *
 * /tmp is often a small tmpfs (a few hundred MB here). Heavy builds — next
 * build, webpack, tsc, npm — all stage large amounts of scratch data there
 * and fail confusingly with ENOSPC once it fills. Prefer our own scratch dir
 * on the user's main disk, and only fall back to /tmp if that fails.
 */
function withBigTmp(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.TMPDIR && env.TMPDIR !== "/tmp") return env;
  try {
    const home = env.HOME || env.USERPROFILE || "";
    if (!home) return env;
    const scratch = join(home, ".claude-free", "tmp");
    mkdirSync(scratch, { recursive: true });
    return { ...env, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
  } catch {
    return env;
  }
}

export function planCommand(
  command: string,
  cwd: string,
  opts: {
    workspace: string;
    limits?: ResourceLimits;
    allowNetwork?: boolean;
    policy?: PolicyViolation[];
    env?: NodeJS.ProcessEnv;
    /**
     * Layers already tried and found unusable at runtime. Detection can pass
     * and the exec still fail (binary vanishes, bwrap refuses, a stale cache),
     * so callers retry with the failed layer excluded.
     */
    exclude?: SandboxSupport["strongest"][];
  },
): SandboxPlan {
  const support = detectSupport();
  const skip = new Set(opts.exclude || []);
  const { blocks, warnings } = assessCommand(command, opts.policy);
  const base: SpawnOptions = {
    cwd,
    env: withBigTmp(opts.env || process.env),
  };
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };

  // 1. bwrap — full namespace isolation
  const bwrapBin = support.bwrap && !skip.has("bwrap") ? findBinary("bwrap") : undefined;
  if (bwrapBin) {
    return {
      command: bwrapBin,
      args: buildBwrapArgs(bwrapBin, opts.workspace, command, {
        allowNetwork: opts.allowNetwork ?? false,
      }),
      opts: base,
      layer: "bwrap",
      warnings,
      blocked: blocks,
    };
  }

  // 2/3. prlimit — resource limits (POSIX only; no equivalent on Windows)
  const prlimitBin = support.prlimit && !isWindows() && !skip.has("rlimits")
    ? findBinary("prlimit")
    : undefined;
  if (prlimitBin) {
    const rl: string[] = [];
    rl.push(`--cpu=${Math.max(1, Math.floor(limits.cpuSeconds))}`);
    // RLIMIT_NPROC is counted PER USER, not per process tree, so it provides
    // no isolation outside a user namespace — and a low value actively breaks
    // things: every command fails with "fork: Resource temporarily unavailable"
    // once the user already has that many processes. Keep it generous.
    rl.push(`--nproc=${Math.max(limits.maxProcesses, 8192)}`);
    rl.push(`--nofile=${limits.maxOpenFiles}`);
    return {
      command: prlimitBin,
      args: [...rl, "--", shellArgv(command).command, ...shellArgv(command).args],
      opts: base,
      layer: "rlimits",
      warnings,
      blocked: blocks,
    };
  }

  // 4. policy only
  const sh = shellArgv(command);
  return {
    command: sh.command,
    args: sh.args,
    opts: base,
    layer: "policy-only",
    warnings,
    blocked: blocks,
  };
}