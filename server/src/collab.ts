import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";

/**
 * Live collaboration: who is connected, what they are allowed to do, and the
 * invite link that lets someone else on your network join.
 *
 * The server normally only ever serves this machine. A collaboration room is
 * the switch that opens it: close the room and remote sockets are refused
 * again, so "share my session" is never accidentally left on.
 */
export type CollabRole = "owner" | "editor" | "viewer";

export interface CollabMember {
  id: string;
  name: string;
  color: string;
  role: CollabRole;
  /** True for windows opened on this machine (they own the session). */
  local: boolean;
  /** File the member has open, when they report one. */
  file: string | null;
  line: number | null;
  joinedAt: number;
  lastSeen: number;
}

const COLORS = [
  "#7c9cff",
  "#ff8fab",
  "#7dd3a0",
  "#ffc857",
  "#c084fc",
  "#67e8f9",
  "#fb923c",
  "#f472b6",
];

/** True for 127.0.0.1 / ::1 / ::ffff:127.0.0.1 — this machine. */
export function isLoopback(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, "").toLowerCase();
  return a === "::1" || a === "localhost" || a.startsWith("127.");
}

/** First non-loopback IPv4 on this machine, for the invite link. */
export function lanAddress(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const i of infos || []) {
      const family = (i as any).family;
      if ((family === "IPv4" || family === 4) && !i.internal) return i.address;
    }
  }
  return null;
}

/** Six unambiguous characters — no O/0/I/1, so it reads aloud safely. */
export function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Room code from a request: `?room=` in the URL, else the `spyro_room` cookie
 * that we set when the invite link is first opened. The cookie means every
 * later fetch and the WebSocket handshake are authorised without the client
 * having to thread a token through anything.
 */
export function roomFromRequest(req: {
  url?: string;
  headers?: { cookie?: string };
}): string | null {
  const q = (req.url || "").split("?")[1];
  if (q) {
    const r = new URLSearchParams(q).get("room");
    if (r && r.trim()) return r.trim().toUpperCase();
  }
  const cookie = req.headers?.cookie;
  if (cookie) {
    for (const part of cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === "spyro_room") {
        const v = part.slice(eq + 1).trim();
        if (v) return v.toUpperCase();
      }
    }
  }
  return null;
}

export class CollabHub {
  /** Set while a room is open; this is what an invite link carries. */
  room: string | null = null;
  /** When set, nobody but the owner may change anything. */
  readOnly = false;
  /** Port the server is listening on, so the invite link can be built. */
  port = 0;

  private members = new Map<string, CollabMember>();
  private palette = 0;

  createRoom(): string {
    this.room = randomRoomCode();
    this.palette = 0;
    return this.room;
  }

  closeRoom(): string | null {
    const was = this.room;
    this.room = null;
    this.readOnly = false;
    return was;
  }

  setReadOnly(value: boolean): void {
    this.readOnly = !!value;
  }

  /** LAN link someone else can open; null while no room (and no LAN IP). */
  inviteUrl(): string | null {
    const lan = lanAddress();
    if (!this.room || !lan || !this.port) return null;
    return `http://${lan}:${this.port}/?room=${this.room}`;
  }

  /** Codes are compared case-insensitively so a pasted link never fails. */
  verify(code: string | null | undefined): boolean {
    if (!this.room || !code) return false;
    return String(code).trim().toUpperCase() === this.room;
  }

  add(role: CollabRole, local: boolean, name?: string): CollabMember {
    const id = `c${randomBytes(6).toString("hex")}`;
    const member: CollabMember = {
      id,
      name: name || (local ? "You" : "Guest"),
      color: COLORS[this.palette++ % COLORS.length],
      role,
      local,
      file: null,
      line: null,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.members.set(id, member);
    return member;
  }

  get(id: string): CollabMember | undefined {
    return this.members.get(id);
  }

  /** Put a member back on the roster after they announced "collab_leave". */
  rejoin(member: CollabMember): CollabMember {
    this.members.set(member.id, member);
    return member;
  }

  remove(id: string): void {
    this.members.delete(id);
  }

  rename(id: string, name: string): CollabMember | undefined {
    const m = this.members.get(id);
    if (!m) return undefined;
    const clean = String(name).replace(/\s+/g, " ").trim().slice(0, 40);
    if (clean) m.name = clean;
    m.lastSeen = Date.now();
    return m;
  }

  focus(id: string, file: string | null, line?: number | null): void {
    const m = this.members.get(id);
    if (!m) return;
    m.file = file ? String(file).slice(0, 400) : null;
    m.line = typeof line === "number" && line > 0 ? Math.round(line) : null;
    m.lastSeen = Date.now();
  }

  setRole(id: string, role: CollabRole): CollabMember | undefined {
    const m = this.members.get(id);
    if (!m || m.role === "owner") return m;
    m.role = role;
    return m;
  }

  list(): CollabMember[] {
    return [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  online(): number {
    return this.members.size;
  }

  state(): {
    room: string | null;
    readOnly: boolean;
    members: CollabMember[];
    url: string | null;
    lan: string | null;
    port: number;
  } {
    return {
      room: this.room,
      readOnly: this.readOnly,
      members: this.list(),
      url: this.inviteUrl(),
      lan: lanAddress(),
      port: this.port,
    };
  }
}

/**
 * What a viewer (no write access) may still do. Everything else is refused —
 * an allow-list, so a new message type is closed by default rather than open.
 */
export const VIEWER_MESSAGES: ReadonlySet<string> = new Set([
  "get_state",
  "list_sessions",
  "load_session",
  "checkpoint_list",
  "get_commands",
  "plugin_list",
  "shell_read",
  "collab_hello",
  "collab_focus",
  "collab_join",
  "collab_leave",
]);
