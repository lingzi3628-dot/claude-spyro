import { spawn } from "node:child_process";
import { shellArgv, killTree } from "./shell.js";

/**
 * Claude Code-style status line.
 *
 * The user configures a shell command (in `~/.claude-free/config.json` under
 * `statusLine`) and we run it with a JSON payload on stdin; the first line it
 * prints is shown in the UI. This mirrors Claude Code's contract:
 *
 *   { "statusLine": { "type": "command", "command": "my-statusline.sh" } }
 *
 * The payload includes cwd, model, session id, token usage and cost so a
 * script can render anything from a git branch to a spend counter.
 */
export interface StatusLineConfig {
  type: "command";
  command: string;
}

export interface StatusLinePayload {
  cwd: string;
  model?: string;
  provider?: string;
  sessionId?: string;
  cost?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  context?: {
    messages: number;
    chars: number;
    budgetChars: number;
    summaryChars: number;
    compacted: boolean;
  };
}

export interface StatusLineResult {
  text: string;
  error?: string;
}

const MAX_OUTPUT = 4_000;

/** Run the configured status-line command. Never throws. */
export function runStatusLine(
  config: StatusLineConfig | undefined,
  payload: StatusLinePayload,
  timeoutMs = 5_000,
): Promise<StatusLineResult> {
  if (!config || config.type !== "command" || !config.command?.trim()) {
    return Promise.resolve({ text: "" });
  }

  return new Promise((resolve) => {
    const sh = shellArgv(config.command);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(sh.command, sh.args, {
        cwd: payload.cwd,
        env: { ...process.env, CLAUDE_PROJECT_DIR: payload.cwd },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: any) {
      resolve({ text: "", error: err?.message || String(err) });
      return;
    }

    let out = "";
    let err = "";
    let settled = false;
    const done = (result: StatusLineResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      killTree(child.pid, "SIGKILL");
      done({ text: "", error: "status line command timed out" });
    }, Math.max(500, timeoutMs));

    child.stdout?.on("data", (d) => {
      out += d.toString();
      if (out.length > MAX_OUTPUT * 4) killTree(child.pid, "SIGKILL");
    });
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", (e: any) => done({ text: "", error: e?.message || String(e) }));
    child.on("close", (code) => {
      const text = out.trim().split(/\r?\n/)[0] || "";
      if (code !== 0) {
        done({ text, error: err.trim() || `status line exited with code ${code}` });
        return;
      }
      done({ text: text.slice(0, MAX_OUTPUT) });
    });

    try {
      child.stdin?.write(JSON.stringify(payload));
      child.stdin?.end();
    } catch {
      // stdin already closed
    }
  });
}
