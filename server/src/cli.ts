/**
 * Spyro Studio — headless CLI.
 *
 *   claude-free -p "fix the failing test"
 *   claude-free -p "review this PR" --json | jq .
 *
 * Drives the same server the UI uses, over WebSocket, so headless runs get
 * identical behaviour: memory, hooks, skills, plugins, snapshots, permissions.
 * If a server is already running it is reused; otherwise a temporary one is
 * started and shut down afterwards.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { WebSocket } from "ws";

export interface CliOptions {
  prompt?: string;
  json: boolean;
  model?: string;
  provider?: string;
  cwd?: string;
  system?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "plan" | "bypass";
  maxTurns: number;
  port?: number;
  help: boolean;
  version: boolean;
  outputStyle?: string;
  quiet: boolean;
  timeoutSec: number;
  effort?: "auto" | "low" | "medium" | "high";
  resume?: string;
  /** Continue the most recent session instead of starting a new one. */
  continueSession: boolean;
  /** Extra folders the agent may work in. */
  addDirs: string[];
}

const USAGE = `Spyro Studio — headless agent

Usage:
  claude-free -p "your prompt"            run one task and print the result
  claude-free -p "..." --json             emit JSON events (one per line)

Options:
  -p, --print <prompt>      Prompt to run (required)
      --json                JSON output instead of plain text
      --model <id>          Override the model
      --provider <id>       Override the provider
      --cwd <path>          Run inside this directory
      --system <text>       Extra system prompt
      --output-style <name> Apply a stored output style
      --allowed-tools <a,b> Auto-approve these tools
      --disallowed-tools <a,b>
                            Never run these tools
      --permission-mode <m> default | acceptEdits | plan | bypass
      --max-turns <n>       Stop after n tool-use rounds (default 25)
      --timeout <s>         Give up if nothing happens for n seconds (default 1800)
      --effort <level>      How hard to think: auto | low | medium | high
      --resume <id>         Continue an existing session
  -c, --continue            Continue the most recent session
      --add-dir <path>      Also allow work in this folder (repeatable)
      --output-format <f>   text | json | stream-json (default: text)
      --dangerously-skip-permissions
                            Same as --permission-mode bypass
      --port <n>            Connect to a specific server port
  -q, --quiet               Suppress progress lines
  -h, --help                This help
  -v, --version             Print the version

Examples:
  claude-free -p "summarise README.md"
  claude-free -p "run the tests and fix failures" --max-turns 40
  claude-free -p "review the diff" --permission-mode bypass --json > out.jsonl`;

export function parseArgs(argv: string[]): CliOptions {
  const o: CliOptions = {
    json: false,
    maxTurns: 25,
    help: false,
    version: false,
    quiet: false,
    timeoutSec: 1800,
    continueSession: false,
    addDirs: [],
  };
  const list = (v?: string) =>
    (v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "-p": case "--print": o.prompt = next(); break;
      case "--json": o.json = true; break;
      case "--model": o.model = next(); break;
      case "--provider": o.provider = next(); break;
      case "--cwd": o.cwd = next(); break;
      case "--system": o.system = next(); break;
      case "--output-style": o.outputStyle = next(); break;
      case "--allowed-tools": o.allowedTools = list(next()); break;
      case "--disallowed-tools": o.disallowedTools = list(next()); break;
      case "--permission-mode": o.permissionMode = next() as CliOptions["permissionMode"]; break;
      case "--max-turns": o.maxTurns = Number(next()) || o.maxTurns; break;
      case "--timeout": o.timeoutSec = Number(next()) || o.timeoutSec; break;
      case "--effort": o.effort = next() as CliOptions["effort"]; break;
      case "--resume": o.resume = next(); break;
      case "-c": case "--continue": o.continueSession = true; break;
      case "--add-dir": o.addDirs.push(...list(next())); break;
      case "--output-format": {
        const f = next();
        if (f === "json" || f === "stream-json") o.json = true;
        else o.json = false;
        break;
      }
      case "--dangerously-skip-permissions": o.permissionMode = "bypass"; break;
      case "--port": o.port = Number(next()); break;
      case "-q": case "--quiet": o.quiet = true; break;
      case "-h": case "--help": o.help = true; break;
      case "-v": case "--version": o.version = true; break;
      default:
        // Allow `claude-free "do the thing"` without -p.
        if (!a.startsWith("-") && o.prompt === undefined) o.prompt = a;
        break;
    }
  }
  return o;
}

function probe(url: string, timeoutMs = 1200): Promise<boolean> {
  return new Promise((res) => {
    const req = http.get(url, (r) => {
      r.resume();
      res((r.statusCode ?? 0) >= 200 && (r.statusCode ?? 0) < 500);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      res(false);
    });
    req.on("error", () => res(false));
  });
}

async function findPort(start: number, tries = 40): Promise<number> {
  for (let p = start; p < start + tries; p++) {
    if (!(await probe(`http://127.0.0.1:${p}/api/state`, 500))) return p;
  }
  return start;
}

function serverEntry(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const cands = [
    join(here, "index.js"),
    resolve(here, "../../server/dist/index.js"),
    resolve(here, "../../../server/dist/index.js"),
  ];
  return cands.find((c) => existsSync(c)) || null;
}

const write = (s: string) => process.stdout.write(s);
const err = (s: string) => process.stderr.write(s);

/** Read the installed version from the nearest package.json. */
function appVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [resolve(here, "../../package.json"), resolve(here, "../package.json")]) {
    try {
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).version || "unknown";
    } catch {
      // try the next candidate
    }
  }
  return "unknown";
}

export async function runCli(argv: string[]): Promise<number> {
  const o = parseArgs(argv);

  if (o.help || (!o.prompt && !o.version)) {
    write(USAGE + "\n");
    return o.help ? 0 : 1;
  }
  if (o.version) {
    write(`Spyro Studio ${appVersion()}\n`);
    return 0;
  }
  if (!o.prompt) {
    err("error: no prompt given. Use -p \"your prompt\".\n");
    return 1;
  }

  const preferred = o.port || Number(process.env.CLAUDE_FREE_PORT) || 8787;
  let port = preferred;
  let temp: ReturnType<typeof spawn> | null = null;

  const reuse = await probe(`http://127.0.0.1:${port}/api/state`);
  if (!reuse) {
    const entry = serverEntry();
    if (!entry) {
      err("error: could not find server/dist/index.js — run `npm run build`.\n");
      return 1;
    }
    port = await findPort(preferred);
    temp = spawn(process.execPath, [entry], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        PORT: String(port),
        ...(o.cwd ? { CLAUDE_FREE_CWD: resolve(o.cwd) } : {}),
      },
    });
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 400));
      up = await probe(`http://127.0.0.1:${port}/api/state`);
    }
    if (!up) {
      temp.kill("SIGTERM");
      err("error: the local server did not start.\n");
      return 1;
    }
  }

  const cleanup = () => {
    try {
      temp?.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  };

  return new Promise<number>((resolveExit) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let finalText = "";
    let lastActivity = Date.now();
    let turns = 0;
    let done = false;

    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(hardStop);
      clearTimeout(idle);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      cleanup();
      resolveExit(code);
    };

    const send = (m: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };

    ws.on("error", () => {
      err("error: could not talk to the local server.\n");
      finish(1);
    });

    const startPrompt = () => {
      const prompt = o.system ? `${o.system}\n\n${o.prompt}` : o.prompt!;
      send({ type: "user_message", text: prompt });
    };
    let awaitingContinue = false;

    ws.on("open", () => {
      // Apply overrides, then run.
      if (o.model) {
        send({
          type: "set_model",
          model: {
            provider: o.provider || undefined,
            model: o.model,
            baseUrl: undefined,
            apiKey: undefined,
          },
        });
      }
      if (o.permissionMode) send({ type: "set_permission_mode", mode: o.permissionMode });
      if (o.effort) send({ type: "set_reasoning_effort", effort: o.effort });
      if (o.cwd) send({ type: "set_cwd", path: resolve(o.cwd) });
      if (o.resume) send({ type: "load_session", id: o.resume });
      for (const d of o.addDirs) send({ type: "add_dir", path: resolve(d) });

      // Headless has nobody to click "approve": be explicit about it.
      if (o.allowedTools?.length || o.disallowedTools?.length) {
        send({
          type: "set_permissions",
          permissions: {
            allow: o.allowedTools || [],
            deny: o.disallowedTools || [],
            ask: [],
          },
        });
      }

      if (o.continueSession && !o.resume) {
        awaitingContinue = true;
        send({ type: "list_sessions" });
        return;
      }

      setTimeout(startPrompt, o.resume ? 400 : 120);
    });

    ws.on("message", (raw: Buffer) => {
      lastActivity = Date.now();
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (m.type) {
        case "sessions":
          if (!awaitingContinue) break;
          awaitingContinue = false;
          {
            const latest = [...(m.sessions || [])].sort(
              (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0),
            )[0];
            if (latest) {
              if (!o.quiet && !o.json) err(`· continuing session ${latest.id} — ${latest.title}\n`);
              send({ type: "load_session", id: latest.id });
              setTimeout(startPrompt, 400);
            } else {
              if (!o.quiet && !o.json) err("· no previous session found; starting a new one\n");
              startPrompt();
            }
          }
          break;

        case "assistant_text":
          finalText += m.text;
          if (!o.json && !o.quiet) write(m.text);
          break;

        case "assistant_reasoning":
          if (o.json) write(JSON.stringify({ type: "reasoning", text: m.text }) + "\n");
          else if (!o.quiet) err(m.text);
          break;

        case "tool_start":
          turns++;
          if (o.json) write(JSON.stringify({ type: "tool_start", name: m.name, args: m.args }) + "\n");
          else if (!o.quiet) err(`\n· ${m.name}\n`);
          break;

        case "tool_end":
          if (o.json) {
            write(
              JSON.stringify({ type: "tool_end", name: m.name, result: m.result }) + "\n",
            );
          }
          if (turns >= o.maxTurns && m.name) {
            if (o.json) write(JSON.stringify({ type: "stopped", reason: "max-turns" }) + "\n");
            if (!o.quiet) err(`\n[stopped: reached --max-turns ${o.maxTurns}]\n`);
            finish(0);
          }
          break;

        case "usage":
          if (o.json) write(JSON.stringify({ type: "usage", usage: m.usage }) + "\n");
          break;

        case "error":
          if (o.json) write(JSON.stringify({ type: "error", message: m.message }) + "\n");
          else err(`\nerror: ${m.message}\n`);
          finish(1);
          break;

        case "approval_request":
          // Nobody is there to approve; refuse rather than hang.
          send({ type: "approval_response", id: m.id, approved: false });
          break;

        case "user_question":
          send({ type: "user_question_response", id: m.id, answers: [] });
          break;

        case "run_end":
          if (o.json) {
            write(
              JSON.stringify({
                type: "result",
                result: finalText,
                turns,
                usage: m.usage,
                cost: m.cost,
              }) + "\n",
            );
          } else if (!o.quiet) {
            err(`\n[done · ${turns} tool call${turns === 1 ? "" : "s"}]\n`);
          }
          finish(0);
          break;

        case "cancelled":
          finish(130);
          break;
      }
    });

    // Watchdog: a script must never hang forever. Refused approvals, a wedged
    // model or a dead socket all end as a clear non-zero exit.
    const hardStop = setTimeout(() => {
      if (!done) {
        err(`\nerror: timed out after ${o.timeoutSec}s\n`);
        finish(1);
      }
    }, Math.max(30, o.timeoutSec) * 1000);

    let idle = setTimeout(onIdle, Math.min(120, Math.max(30, o.timeoutSec)) * 1000);
    function onIdle() {
      if (done) return;
      idle = setTimeout(onIdle, Math.min(120, Math.max(30, o.timeoutSec)) * 1000);
      // Only complain if the agent said nothing at all — a slow local model is
      // normal, so give it a long grace period before giving up.
      if (Date.now() - lastActivity > Math.max(120, o.timeoutSec) * 1000) {
        err("\nerror: no activity; giving up\n");
        finish(1);
      }
    }
  });
}