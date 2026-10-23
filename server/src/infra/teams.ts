import { randomUUID } from "node:crypto";

export interface BoardEntry {
  id: string;
  author: string;
  topic: string;
  body: string;
  at: number;
}

const MAX_ENTRIES = 200;

/**
 * A shared blackboard that a team of parallel agents can post to and read
 * from, so they can hand findings to each other without a shared transcript.
 */
export class TeamBoard {
  readonly id = `team_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  private entries: BoardEntry[] = [];
  private listeners = new Set<(e: BoardEntry) => void>();

  post(author: string, topic: string, body: string): BoardEntry {
    const entry: BoardEntry = {
      id: `b_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      author,
      topic: topic.trim() || "note",
      body,
      at: Date.now(),
    };
    this.entries.push(entry);
    while (this.entries.length > MAX_ENTRIES) this.entries.shift();
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        // ignore listener errors
      }
    }
    return entry;
  }

  /** Read entries, optionally filtered by author or topic. */
  read(opts: { author?: string; topic?: string; since?: number } = {}): BoardEntry[] {
    return this.entries.filter(
      (e) =>
        (!opts.author || e.author === opts.author) &&
        (!opts.topic || e.topic.toLowerCase() === opts.topic.toLowerCase()) &&
        (opts.since === undefined || e.at > opts.since),
    );
  }

  /** A compact transcript, optionally excluding one agent's own posts. */
  render(excludeAuthor?: string): string {
    const items = this.read().filter((e) => e.author !== excludeAuthor);
    if (!items.length) return "(the board is empty)";
    return items
      .map((e) => `[${e.topic}] ${e.author}: ${e.body}`)
      .join("\n");
  }

  onPost(fn: (e: BoardEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get size(): number {
    return this.entries.length;
  }
}