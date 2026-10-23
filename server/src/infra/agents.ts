import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, sep } from "node:path";
import type { AgentInfo } from "../tools/types.js";

export interface AgentDef extends AgentInfo {
  /** Absolute path to the definition file. */
  path: string;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, body: (match[2] || "").trim() };
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Load user-defined subagents from `<cwd>/.claude/agents`, `~/.claude/agents`,
 *  `~/.claude-free/agents`, plus any plugin agent dirs. */
export class AgentLoader {
  private agents = new Map<string, AgentDef>();

  /** Directories searched in priority order. */
  private dirs(cwd: string, extra: string[] = []): string[] {
    return [
      join(cwd, ".claude", "agents"),
      join(homedir(), ".claude", "agents"),
      join(homedir(), ".claude-free", "agents"),
      ...extra,
    ];
  }

  async load(cwd: string, extra: string[] = []): Promise<AgentDef[]> {
    this.agents.clear();
    const seen = new Set<string>();
    for (const dir of this.dirs(cwd, extra)) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith(".md")) continue;
        const full = join(dir, entry);
        let s: Awaited<ReturnType<typeof stat>>;
        try {
          s = await stat(full);
        } catch {
          continue;
        }
        if (s.isDirectory()) continue;
        try {
          const raw = await readFile(full, "utf8");
          const { meta, body } = parseFrontmatter(raw);
          if (!body.trim()) continue;
          const name = meta.name || basename(full).replace(/\.md$/i, "");
          if (seen.has(name)) continue;
          seen.add(name);
          const tools = meta.tools
            ? meta.tools.split(",").map((t) => t.trim()).filter(Boolean)
            : undefined;
          this.agents.set(name, {
            name,
            description: meta.description || name,
            tools,
            model: meta.model || undefined,
            body,
            path: full,
          });
        } catch {
          // ignore malformed agent files
        }
      }
    }
    return this.list();
  }

  list(): AgentDef[] {
    return [...this.agents.values()];
  }

  get(name: string): AgentDef | undefined {
    return this.agents.get(name);
  }

  /** Compact catalog for the system prompt / UI. */
  catalog(): string {
    const all = this.list();
    if (!all.length) return "";
    return all.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  }
}

/** Names of all agent dirs from a set of plugin directories (relative path kept). */
export function agentDirsFromPlugins(pluginDirs: string[]): string[] {
  return pluginDirs;
}

export { toPosix };
