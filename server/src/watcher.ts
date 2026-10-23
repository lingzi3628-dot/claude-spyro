import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";

const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "target", "vendor", "__pycache__", ".venv", "venv", ".cache", ".turbo",
  ".svelte-kit", ".parcel-cache", "tmp",
]);

/**
 * Watches a workspace so the IDE reflects what the agent is doing *while* it
 * does it, rather than only after the run finishes.
 *
 * Editors report coarse events (a whole directory can change at once), so we
 * emit a quiet tick plus the set of touched paths and let the client work out
 * what actually needs reloading.
 */
export class WorkspaceWatcher {
  private watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  private pending = new Set<string>();
  private onTick: (paths: string[]) => void;

  constructor(onTick: (paths: string[]) => void) {
    this.onTick = onTick;
  }

  watch(root: string): void {
    this.unwatchAll();
    if (!root) return;
    try {
      const w = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename);
        const top = rel.split(/[\\/]/)[0];
        if (IGNORE.has(top)) return;
        this.pending.add(resolve(root, rel));
        this.schedule();
      });
      w.on("error", () => {
        /* a watch can die when a folder is replaced; the next one takes over */
      });
      this.watchers.push(w);
    } catch {
      // Recursive watching is not supported everywhere; the IDE still works,
      // it just will not live-update on those platforms.
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    // Editors write in bursts; coalesce so a single save is one refresh.
    this.timer = setTimeout(() => {
      const paths = [...this.pending];
      this.pending.clear();
      this.timer = null;
      if (paths.length) this.onTick(paths);
    }, 220);
  }

  unwatchAll(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
