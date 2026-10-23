import { Tool } from "./types.js";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";

async function runCmd(cmd: string, args: string[], opts?: any) {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...opts, timeout: opts?.timeout ?? 120000 }, (err: any, stdout: any, stderr: any) => {
      resolve({ stdout: stdout || "", stderr: stderr || (err ? err.message : ""), code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
    });
  });
}

export const testRunnerTool: Tool = {
  name: "test_runner",
  description:
    "Run tests in the project. Auto-detects the test framework (Jest, Vitest, pytest, cargo test, go test, npm test). " +
    "Returns structured pass/fail results with timing.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["detect", "run", "run_file", "coverage"],
        description: "detect: find test framework; run: run all tests; run_file: run specific test file; coverage: run with coverage",
      },
      file: { type: "string", description: "Specific test file to run (for run_file)" },
      pattern: { type: "string", description: "Test name pattern (grep)" },
      framework: { type: "string", description: "Override auto-detection (jest, vitest, pytest, cargo, go, npm)" },
    },
    required: ["action"],
  },
  async execute(args, _ctx) {
    const cwd = _ctx.cwd;
    const action = String(args.action || "detect");

    // Detect test framework
    function detectFramework(): string {
      if (args.framework) return args.framework;
      const pkg = join(cwd, "package.json");
      if (existsSync(pkg)) {
        try {
          const p = JSON.parse(readFileSync(pkg, "utf8"));
          const deps = { ...p.dependencies, ...p.devDependencies };
          if (deps.vitest) return "vitest";
          if (deps.jest) return "jest";
          if (p.scripts?.test) return "npm";
        } catch { }
      }
      if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "setup.cfg"))) return "pytest";
      if (existsSync(join(cwd, "Cargo.toml"))) return "cargo";
      if (existsSync(join(cwd, "go.mod"))) return "go";
      return "npm";
    }

    const framework = detectFramework();

    switch (action) {
      case "detect": {
        const lines = [`Detected framework: ${framework}`];
        // Check for test files
        const testDirs = ["test", "tests", "__tests__", "spec"];
        for (const d of testDirs) {
          const p = join(cwd, d);
          if (existsSync(p)) {
            try {
              const files = readdirSync(p, { recursive: true } as any).filter((f: string) => /\.(test|spec)\.(js|ts|jsx|tsx|py|rs|go)$/.test(f));
              lines.push(`  ${d}/: ${files.length} test files`);
            } catch { }
          }
        }
        return lines.join("\n");
      }

      case "run": {
        const cmd = buildCommand(framework, cwd, args);
        if (!cmd) return `Error: could not build command for ${framework}`;
        const start = Date.now();
        try {
          const r: any = await runCmd(cmd[0], cmd.slice(1), { cwd, maxBuffer: 10 * 1024 * 1024 });
          const duration = Date.now() - start;
          return formatResult(framework, r.stdout, r.stderr, r.code ?? 0, duration);
        } catch (e: any) {
          const duration = Date.now() - start;
          return formatResult(framework, e.stdout || "", e.stderr || e.message, e.code || 1, duration);
        }
      }

      case "run_file": {
        if (!args.file) return "Error: file required for run_file";
        const cmd = buildCommand(framework, cwd, { ...args, file: args.file });
        if (!cmd) return `Error: could not build command for ${framework}`;
        const start = Date.now();
        try {
          const r: any = await runCmd(cmd[0], cmd.slice(1), { cwd, maxBuffer: 10 * 1024 * 1024 });
          const duration = Date.now() - start;
          return formatResult(framework, r.stdout, r.stderr, r.code ?? 0, duration);
        } catch (e: any) {
          const duration = Date.now() - start;
          return formatResult(framework, e.stdout || "", e.stderr || e.message, e.code || 1, duration);
        }
      }

      case "coverage": {
        const cmd = buildCommand(framework, cwd, { ...args, coverage: true });
        if (!cmd) return `Error: could not build command for ${framework}`;
        const start = Date.now();
        try {
          const r: any = await runCmd(cmd[0], cmd.slice(1), { cwd, maxBuffer: 10 * 1024 * 1024 });
          const duration = Date.now() - start;
          return formatResult(framework, r.stdout, r.stderr, r.code ?? 0, duration);
        } catch (e: any) {
          const duration = Date.now() - start;
          return formatResult(framework, e.stdout || "", e.stderr || e.message, e.code || 1, duration);
        }
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
};

function buildCommand(framework: string, cwd: string, args: any): string[] | null {
  void cwd;
  const pattern = args.pattern ? ["-t", args.pattern] : [];
  const file = args.file ? [args.file] : [];

  switch (framework) {
    case "vitest":
      return ["npx", "vitest", "run", ...pattern, ...file, ...(args.coverage ? ["--coverage"] : [])];
    case "jest":
      return ["npx", "jest", ...pattern, ...file, ...(args.coverage ? ["--coverage"] : [])];
    case "npm":
      return ["npm", "test", ...(args.pattern ? ["--", "--grep", args.pattern] : [])];
    case "pytest":
      return ["python", "-m", "pytest", "-v", ...pattern.map((p: string) => `-k ${p}`), ...file, ...(args.coverage ? ["--cov"] : [])];
    case "cargo":
      return ["cargo", "test", ...pattern.map((p: string) => p), ...(args.coverage ? [] : [])];
    case "go":
      return ["go", "test", "./...", ...(args.pattern ? ["-run", args.pattern] : []), ...(args.coverage ? ["-cover"] : [])];
    default:
      return null;
  }
}

function formatResult(framework: string, stdout: string, stderr: string, code: number, duration: number): string {
  const lines: string[] = [];
  lines.push(`Framework: ${framework}`);
  lines.push(`Exit code: ${code} ${code === 0 ? "✅ PASS" : "❌ FAIL"}`);
  lines.push(`Duration: ${duration}ms`);
  lines.push("");

  // Extract summary line (common patterns)
  const summaryPatterns = [
    /Tests:\s*(\d+)\s*passed.*?(\d+)\s*failed/i,
    /(\d+)\s*passed.*?(\d+)\s*failed/i,
    /test result:.*?(\d+)\s*passed.*?(\d+)\s*failed/i,
    /(\d+)\s*tests? passed/i,
    /Ran \d+ tests? in/i,
  ];

  for (const pat of summaryPatterns) {
    const m = stdout.match(pat) || stderr.match(pat);
    if (m) {
      lines.push(`Summary: ${m[0]}`);
      break;
    }
  }

  lines.push("");
  lines.push("Output:");
  lines.push(stdout.slice(0, 8000));
  if (stderr.trim()) {
    lines.push("");
    lines.push("Stderr:");
    lines.push(stderr.slice(0, 4000));
  }

  return lines.join("\n");
}
