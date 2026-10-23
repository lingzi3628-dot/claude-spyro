import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool } from "./types.js";
import { safeResolve } from "./types.js";

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

export const grepTool: Tool = {
  name: "grep",
  description:
    "Search file contents with a regular expression. Returns matching lines as path:line:text. " +
    "Use the include parameter to filter by file glob-like extension (e.g. '*.ts').",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for." },
      path: { type: "string", description: "Directory to search. Defaults to cwd." },
      include: { type: "string", description: "Only search files whose path ends with this (e.g. '.ts')." },
      ignore_case: { type: "boolean", description: "Case-insensitive search." },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const root = safeResolve(ctx.cwd, String(args.path || "."));
    let re: RegExp;
    try {
      re = new RegExp(String(args.pattern), args.ignore_case ? "i" : "");
    } catch (err: any) {
      return `Invalid regex: ${err.message}`;
    }

    const results: string[] = [];
    outer: for await (const file of walk(root)) {
      if (args.include && !file.endsWith(String(args.include))) continue;
      let content: string;
      try {
        const s = await stat(file);
        if (s.size > 2_000_000) continue;
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push(`${relative(ctx.cwd, file)}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
          if (results.length >= 500) break outer;
        }
      }
    }
    return results.length ? results.join("\n") : "No matches found.";
  },
};
