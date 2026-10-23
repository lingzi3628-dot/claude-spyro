import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OutputStyle {
  name: string;
  description: string;
  body: string;
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, body: (match[2] || "").trim() };
}

/** Load custom output styles from `<cwd>/.claude/output-styles` and `~/.claude-free/output-styles`. */
export class OutputStyleLoader {
  private styles = new Map<string, OutputStyle>();

  private dirs(cwd: string): string[] {
    return [
      join(cwd, ".claude", "output-styles"),
      join(homedir(), ".claude-free", "output-styles"),
    ];
  }

  async load(cwd: string): Promise<OutputStyle[]> {
    this.styles.clear();
    const seen = new Set<string>();
    for (const dir of this.dirs(cwd)) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith(".md")) continue;
        try {
          const raw = await readFile(join(dir, entry), "utf8");
          const { meta, body } = parseFrontmatter(raw);
          const name = meta.name || entry.replace(/\.md$/i, "");
          if (seen.has(name)) continue;
          seen.add(name);
          this.styles.set(name, {
            name,
            description: meta.description || name,
            body,
          });
        } catch {
          // ignore malformed
        }
      }
    }
    return this.list();
  }

  list(): OutputStyle[] {
    return [...this.styles.values()];
  }

  get(name: string): OutputStyle | undefined {
    return this.styles.get(name);
  }
}
