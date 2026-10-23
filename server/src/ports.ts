import { readFileSync, existsSync } from "node:fs";

/**
 * Detects servers the agent (or the integrated terminal) started, the way VS
 * Code's Ports panel does.
 *
 * Two signals are combined: URLs the process actually printed, and listening
 * TCP sockets on localhost. The printed URLs are what identify *what* the
 * server is; the sockets are what prove it is actually up.
 */
export interface PortInfo {
  port: number;
  url: string;
  label: string;
  process: string;
  up: boolean;
}

const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)[^\s'"<>)\]]*)/g;
// Not every server prints a full URL. Python's http.server, for one, says
// "Serving HTTP on 127.0.0.1 port 8000 ..." and nothing else.
const HOSTPORT_RE = /(?:^|\s)(?:https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\s+port\s+(\d{2,5})/gi;

/** Pull candidate local URLs out of command output. */
export function urlsFromOutput(text: string): { url: string; port: number }[] {
  const out: { url: string; port: number }[] = [];
  const seen = new Set<string>();
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    // 0.0.0.0 / [::] are bind addresses, not addresses you can visit.
    const url = m[1]
      .replace(/[.,;]$/, "")
      .replace(/\/\/0\.0\.0\.0(?=[:/]|$)/g, "//localhost")
      .replace(/\/\/(?:\[::\]|::)(?=[:/]|$)/g, "//localhost");
    let port = 0;
    try {
      port = Number(new URL(url).port || (/^https/.test(url) ? 443 : 80));
    } catch {
      continue;
    }
    if (!port || port < 1024 || port > 65535) continue;
    if (seen.has(String(port))) continue;
    seen.add(String(port));
    out.push({ url, port });
  }
  HOSTPORT_RE.lastIndex = 0;
  let h: RegExpExecArray | null;
  while ((h = HOSTPORT_RE.exec(text)) !== null) {
    const port = Number(h[2]);
    if (!port || seen.has(String(port))) continue;
    seen.add(String(port));
    // A wildcard bind address is not something you can open in a browser.
    const host = h[1] === "0.0.0.0" ? "localhost" : h[1];
    out.push({ url: `http://${host}:${port}/`, port });
  }
  return out;
}

/** Listening localhost TCP ports, read from /proc (Linux) without extra deps. */
export function listeningPorts(): Set<number> {
  const out = new Set<number>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    let raw = "";
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      // 0A = TCP_LISTEN
      if (cols[3] !== "0A") continue;
      const hex = cols[1].split(":")[1];
      if (!hex) continue;
      const port = parseInt(hex, 16);
      if (Number.isFinite(port) && port > 0 && port < 65536) out.add(port);
    }
  }
  return out;
}

/**
 * Guess the port straight from the command line.
 *
 * Plenty of servers never print a usable URL — and some print nothing at all
 * when their output is piped — so the command is the more reliable signal.
 */
export function portFromCommand(command: string): number | null {
  const c = command.replace(/\s+/g, " ");
  const patterns = [
    /--port[= ](\d{2,5})/i,
    /\.port[= ](\d{2,5})/i,
    /\bport[= ](\d{2,5})\b/i,
    /localhost:(\d{2,5})/i,
    /:(\d{2,5})\b/,
    /\b(\d{4,5})\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(c);
    if (m) {
      const n = Number(m[1]);
      if (n > 1023 && n < 65536) return n;
    }
  }
  return null;
}

/** Guess a friendly label for a server from the command that started it. */
export function labelFor(command: string, url: string): string {
  const c = command.toLowerCase();
  if (/\bvite\b/.test(c)) return "Vite";
  if (/\bnext\b/.test(c)) return "Next.js";
  if (/react-scripts|ng serve/.test(c)) return "React";
  if (/\bwebpack\b|\bparcel\b/.test(c)) return "Bundler";
  if (/http\.server|serve\b|http-server/.test(c)) return "Static server";
  if (/\buvicorn\b|\bfastapi\b|\bflask\b/.test(c)) return "Python API";
  if (/\bdjango\b/.test(c)) return "Django";
  if (/\bexpress\b|\bnodemon\b|\bnode\b/.test(c)) return "Node server";
  if (/\brails\b|\bbundle exec/.test(c)) return "Rails";
  if (/\bphp\b/.test(c)) return "PHP";
  if (/\bcargo run\b/.test(c)) return "Rust server";
  if (/\bgo run\b/.test(c)) return "Go server";
  try {
    const p = new URL(url).pathname;
    if (p && p !== "/") return p;
  } catch {
    /* ignore */
  }
  return "Server";
}
