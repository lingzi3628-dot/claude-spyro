import { spawn, type ChildProcess } from "node:child_process";
import { shellArgv, killTree } from "./shell.js";
import { randomUUID } from "node:crypto";

export interface ShellHandle {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  output: string;
  /** How many bytes of `output` the agent has already consumed. */
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

const MAX_OUTPUT = 400_000;

/**
 * Manages long-running / background shell commands so the agent can start a
 * process, keep working, and poll its output later with bash_output / kill_shell.
 */
export class ShellManager {
  private shells = new Map<string, ShellHandle>();
  private procs = new Map<string, ChildProcess>();
  /** Pending SIGKILL escalations for interrupted (SIGINT) shells. */
  private escalations = new Map<string, NodeJS.Timeout>();

  /** Start a command in the background and return immediately. */
  start(command: string, cwd: string, timeoutMs = 120000): ShellHandle {
    const id = `sh_${randomUUID().slice(0, 8)}`;
    const handle: ShellHandle = {
      id,
      command,
      cwd,
      output: "",
      readOffset: 0,
      done: false,
      exitCode: null,
      timedOut: false,
      startedAt: Date.now(),
    };
    this.shells.set(id, handle);

    const sh = shellArgv(command);
    // A terminal shows output as it happens; a pipe makes many runtimes block
    // until 8KB or exit. Unbuffer Python (and friends) so a dev server's banner
    // arrives immediately instead of never.
    const child = spawn(sh.command, sh.args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1", UNBUFFERED: "1" },
    });
    this.procs.set(id, child);
    if (child.pid) handle.pid = child.pid;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      handle.timedOut = true;
      killTree(child.pid, "SIGKILL");
    }, timeoutMs);

    const append = (s: string) => {
      handle.output += s;
      if (handle.output.length > MAX_OUTPUT) {
        const overflow = handle.output.length - MAX_OUTPUT;
        handle.output = handle.output.slice(overflow);
        handle.readOffset = Math.max(0, handle.readOffset - overflow);
      }
    };

    child.stdout.on("data", (d) => append(d.toString()));
    child.stderr.on("data", (d) => append(d.toString()));
    const settle = () => {
      clearTimeout(timer);
      clearTimeout(this.escalations.get(id));
      this.escalations.delete(id);
    };
    child.on("error", (err) => {
      settle();
      append(`\n[spawn error: ${err.message}]`);
      handle.done = true;
      handle.exitCode = -1;
      handle.finishedAt = Date.now();
      this.procs.delete(id);
    });
    child.on("close", (code) => {
      settle();
      handle.exitCode = code;
      handle.done = true;
      handle.finishedAt = Date.now();
      if (timedOut) append(`\n[timed out after ${timeoutMs}ms]`);
      else if (handle.output && !handle.output.endsWith("\n")) append("\n");
      this.procs.delete(id);
    });

    return { ...handle };
  }

  get(id: string): ShellHandle | undefined {
    return this.shells.get(id);
  }

  /** Read output produced since `sinceOffset` (or the stored cursor). */
  read(id: string, sinceOffset?: number): ShellReadResult | null {
    const h = this.shells.get(id);
    if (!h) return null;
    const start = Math.max(0, sinceOffset ?? h.readOffset);
    const chunk = h.output.slice(start);
    const newOffset = h.output.length;
    if (sinceOffset === undefined) h.readOffset = newOffset;
    return {
      output: chunk,
      readOffset: newOffset,
      totalLength: h.output.length,
      done: h.done,
      exitCode: h.exitCode,
    };
  }

  /**
   * Stop a running shell.
   *
   * A terminal's Ctrl+C sends SIGINT, the same signal a real terminal sends, so
   * well-behaved programs get to shut down and print their last words. A process
   * that ignores it is force-killed shortly after — otherwise "Ctrl+C" would
   * appear to do nothing, which is exactly the complaint we are fixing.
   */
  kill(id: string, signal: NodeJS.Signals = "SIGKILL"): boolean {
    const proc = this.procs.get(id);
    if (!proc) return false;

    if (signal !== "SIGINT") {
      killTree(proc.pid, signal);
      return true;
    }

    killTree(proc.pid, "SIGINT");
    clearTimeout(this.escalations.get(id));
    const timer = setTimeout(() => {
      this.escalations.delete(id);
      // Still alive after a grace period: it is ignoring SIGINT.
      const still = this.procs.get(id);
      if (still) killTree(still.pid, "SIGKILL");
    }, 2500);
    // Never hold the event loop open just for an escalation.
    if (typeof timer.unref === "function") timer.unref();
    this.escalations.set(id, timer);
    return true;
  }

  list(): ShellHandle[] {
    return [...this.shells.values()].map((h) => ({ ...h }));
  }

  /** Forget finished shells older than `maxAgeMs` to bound memory. */
  prune(maxAgeMs = 30 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, h] of this.shells) {
      if (h.done && (h.finishedAt || 0) < cutoff) this.shells.delete(id);
    }
  }

  killAll(): void {
    for (const proc of this.procs.values()) killTree(proc.pid, "SIGKILL");
    for (const t of this.escalations.values()) clearTimeout(t);
    this.escalations.clear();
    this.procs.clear();
  }
}
