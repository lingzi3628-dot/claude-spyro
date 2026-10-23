import type { Tool } from "./types.js";
import { spawn } from "node:child_process";
import { } from "../infra/shell.js";
import { planCommand } from "../infra/sandbox.js";
import { existsSync } from "node:fs";

interface Probe {
  id: string;
  label: string;
  versionCmd: string;
  /** How to actually prove the toolchain works. */
  verify?: { cmd: string; expect: RegExp; note: string };
  install?: string;
  /** Shown instead of the raw command output when the tool is absent. */
  missingMeans?: string;
}

const PROBES: Probe[] = [
  { id: "node", label: "Node.js", versionCmd: "node --version" },
  {
    id: "npm",
    label: "npm",
    versionCmd: "npm --version",
    verify: {
      cmd: "cd \"$(mktemp -d)\" && npm init -y >/dev/null 2>&1 && echo ok",
      expect: /ok/,
      note: "installs packages from the registry",
    },
  },
  {
    id: "python",
    label: "Python",
    versionCmd: "python3 --version",
    verify: {
      cmd: "python3 -c \"import sqlite3, json, http.server; print('ok')\"",
      expect: /ok/,
      note: "runs Python scripts",
    },
  },
  {
    id: "pip",
    label: "pip",
    versionCmd: "python3 -m pip --version 2>&1 | head -1",
    // Not having system pip is normal; a virtualenv always ships one. Say so
    // plainly instead of printing a confusing "No module named pip" line.
    missingMeans: "no system pip — use a virtualenv: python3 -m venv .venv",
    verify: {
      cmd: 'D="$(mktemp -d)" && python3 -m venv "$D/v" >/dev/null 2>&1 && "$D/v/bin/python" -m pip --version 2>&1 | head -1',
      expect: /pip/,
      note: "works inside a virtualenv",
    },
  },
  {
    id: "sqlite",
    label: "SQLite",
    versionCmd: "sqlite3 --version 2>/dev/null | head -1",
  },
  { id: "git", label: "Git", versionCmd: "git --version" },
  {
    id: "gcc",
    label: "C/C++ compiler",
    versionCmd: "cc --version 2>/dev/null | head -1 || gcc --version 2>/dev/null | head -1",
    install: "sudo apt install build-essential",
  },
  {
    id: "go",
    label: "Go",
    versionCmd: "go version 2>/dev/null",
    install: "sudo apt install golang-go",
  },
  {
    id: "rust",
    label: "Rust",
    versionCmd: "rustc --version 2>/dev/null",
    install: "sudo apt install rustc cargo",
  },
  {
    id: "java",
    label: "Java",
    versionCmd: "java -version 2>&1 | head -1",
    install: "sudo apt install default-jdk",
  },
  {
    id: "docker",
    label: "Docker",
    versionCmd: "docker --version 2>/dev/null",
    install: "see https://docs.docker.com/engine/install/",
  },
  {
    id: "nextjs",
    label: "Next.js",
    versionCmd: "npx next --version 2>/dev/null",
    install: "npm install next@latest react@latest react-dom@latest",
    missingMeans: "no Next.js in project — run npx create-next-app to scaffold",
    verify: {
      cmd: "ls app/ 2>/dev/null && echo 'App Router' || (ls pages/ 2>/dev/null && echo 'Pages Router')",
      expect: /Router/,
      note: "detects App Router (app/) or Pages Router (pages/)",
    },
  },
  {
    id: "typescript",
    label: "TypeScript",
    versionCmd: "npx tsc --version 2>/dev/null",
    install: "npm install -D typescript @types/node @types/react @types/react-dom",
    missingMeans: "no TypeScript — most Next.js projects use it",
    verify: {
      cmd: "ls tsconfig.json 2>/dev/null && echo 'tsconfig.json present'",
      expect: /tsconfig/,
      note: "checks for TypeScript config",
    },
  },
  {
    id: "eslint",
    label: "ESLint",
    versionCmd: "npx eslint --version 2>/dev/null",
    install: "npm install -D eslint eslint-config-next",
    missingMeans: "no ESLint — recommended for Next.js",
    verify: {
      cmd: "ls .eslintrc* eslint.config.* 2>/dev/null | head -1",
      expect: /./,
      note: "checks for ESLint config",
    },
  },
  {
    id: "tailwind",
    label: "Tailwind CSS",
    versionCmd: "npx tailwindcss --version 2>/dev/null",
    install: "npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p",
    missingMeans: "no Tailwind — optional but common in Next.js",
    verify: {
      cmd: "ls tailwind.config.* 2>/dev/null && echo 'Tailwind config present'",
      expect: /Tailwind/,
      note: "checks for Tailwind config",
    },
  },
];

function runCapture(command: string, cwd: string, timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const plan = planCommand(command, cwd, { workspace: cwd, allowNetwork: false });
    if (!existsSync(plan.command)) return resolve({ ok: false, out: "(no runnable shell)" });
    const child = spawn(plan.command, plan.args, { ...plan.opts, detached: true });
    let out = "";
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      resolve({ ok: false, out: out.trim() || "(timed out)" });
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, out: "" });
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ ok: true, out: out.trim() });
    });
  });
}

export const doctorTool: Tool = {
  name: "doctor",
  description:
    "Report which languages, package managers and build tools this machine can actually run. " +
    "Call this BEFORE telling the user something is unavailable — guessing wastes their time.",
  parameters: {
    type: "object",
    properties: {
      deep: {
        type: "boolean",
        description: "Also run a real build/probe for each tool (slower, but definitive).",
      },
    },
  },
  requiresApproval: false,
  async execute(args: { deep?: boolean }, ctx: any) {
    const cwd = ctx?.cwd || process.cwd();
    const deep = args?.deep === true;
    const lines: string[] = [];
    const available: string[] = [];
    const missing: string[] = [];

    for (const p of PROBES) {
      const res = await runCapture(p.versionCmd, cwd, 12000);
      const first = (res.out.split("\n").find((l) => l.trim()) || "").trim();
      const absent =
        !first || /not found|No such file|command not found|No module named/i.test(first);
      if (!absent) {
        available.push(p.label);
        let note = "";
        if (deep && p.verify) {
          const v = await runCapture(p.verify.cmd, cwd, 60000);
          const ok = v.ok && p.verify.expect.test(v.out);
          note = ok ? " · verified" : ` · limited (${p.verify.note})`;
        }
        lines.push(`  ✓ ${p.label.padEnd(16)} ${first.slice(0, 58)}${note}`);
      } else {
        missing.push(p.label);
        lines.push(
          `  ✗ ${p.label.padEnd(16)} ${p.missingMeans || "not installed"}${p.install ? `  →  ${p.install}` : ""}`,
        );
      }
    }

    // Disk and RAM decide whether big projects are realistic here.
    const disk = await runCapture("df -h / /tmp 2>/dev/null | tail -2", cwd, 10000);
    const ram = await runCapture(
      "free -h 2>/dev/null | awk 'NR==2{print $2, $7}' || vm_stat 2>/dev/null | head -1",
      cwd,
      10000,
    );
    const resources =
      `\nResources:\n  disk  ${(disk.out.split("\n")[0] || "").slice(0, 70)}\n` +
      `  /tmp  ${(disk.out.split("\n")[1] || "").slice(0, 70)}\n` +
      `  RAM   ${(ram.out.split("\n")[0] || "unknown").slice(0, 60)}\n`;

    const header =
      "Toolchain report for this machine (probed, not guessed):\n\n" +
      lines.join("\n") +
      "\n\n" +
      `Available: ${available.length ? available.join(", ") : "none"}\n` +
      `Missing:   ${missing.length ? missing.join(", ") : "none"}\n` +
      resources +
      "\n" +
      (available.includes("npm") && available.includes("Python")
        ? "Node/npm and Python both work — you can build and run web apps, APIs, scripts and data tools here. " +
          "Ask the user to run long `npm install`s if a registry is slow, but do not claim the sandbox blocks execution."
        : "Some toolchains are missing; prefer what is listed as available, or tell the user what to install.") +
      "\n\nFor big builds (next build, webpack, monorepos): raise timeout_ms above the " +
      "default, or use run_in_background and poll bash_output.";

    return header;
  },
};