import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve, } from "node:path";

export interface MemoryFile {
  path: string;
  content: string;
}

const MEMORY_NAMES = ["CLAUDE.md", "CLAUDE.local.md"];

/**
 * Loads project + user memory files (CLAUDE.md) into the agent's context.
 * Search order: user-global memory, then each directory from an ancestor
 * boundary down to the working directory (closest last, so it takes precedence).
 */
export class MemoryLoader {
  private files: MemoryFile[] = [];

  async load(cwd: string): Promise<MemoryFile[]> {
    this.files = [];
    const seen = new Set<string>();

    const add = async (p: string) => {
      if (seen.has(p) || !existsSync(p)) return;
      seen.add(p);
      try {
        const content = (await readFile(p, "utf8")).trim();
        if (content) this.files.push({ path: p, content });
      } catch {
        // ignore unreadable files
      }
    };

    // 1. User-global memory (applies to every project).
    await add(join(homedir(), ".claude", "CLAUDE.md"));
    await add(join(homedir(), ".claude-free", "CLAUDE.md"));

    // 2. Project memory: walk up from cwd, stopping at home (or filesystem root
    //    if cwd is outside home), then add files root-most → cwd-most.
    const home = resolve(homedir());
    const chain: string[] = [];
    let dir = resolve(cwd);
    for (let i = 0; i < 64; i++) {
      chain.unshift(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      if (dir === home) break; // don't traverse above the home dir
      dir = parent;
    }
    for (const d of chain) {
      for (const name of MEMORY_NAMES) await add(join(d, name));
    }

    return this.list();
  }

  list(): MemoryFile[] {
    return this.files.map((f) => ({ ...f }));
  }

  /** Combined memory text for the system prompt, or "" if none. */
  combine(): string {
    if (!this.files.length) return "";
    return this.files
      .map((f) => `## ${this.displayPath(f.path)}\n${f.content}`)
      .join("\n\n");
  }

  private displayPath(p: string): string {
    const home = homedir();
    if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
    return p;
  }
}
