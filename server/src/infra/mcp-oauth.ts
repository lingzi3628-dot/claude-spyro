import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * OAuth 2.1 support for remote MCP servers.
 *
 * Implements the MCP auth flow: WWW-Authenticate discovery → protected-resource
 * metadata → authorization-server metadata → dynamic client registration →
 * PKCE authorization → code exchange, plus refresh and token storage.
 *
 * Tokens are stored per-server in ~/.claude-free/mcp-tokens.json with 0600
 * permissions where the platform allows it.
 */

const TOKEN_FILE = join(homedir(), ".claude-free", "mcp-tokens.json");

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
  scope?: string;
  client_id?: string;
  client_secret?: string;
}

export interface AuthMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

export interface PendingAuth {
  server: string;
  verifier: string;
  challenge: string;
  state: string;
  redirectUri: string;
  metadata: AuthMetadata;
  clientId?: string;
  clientSecret?: string;
  createdAt: number;
}

// --- PKCE ------------------------------------------------------------------

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

// --- Token storage ---------------------------------------------------------

function readStore(): Record<string, StoredToken> {
  try {
    if (existsSync(TOKEN_FILE)) return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    // ignore
  }
  return {};
}

function writeStore(store: Record<string, StoredToken>): void {
  try {
    if (!existsSync(join(homedir(), ".claude-free"))) {
      mkdirSync(join(homedir(), ".claude-free"), { recursive: true });
    }
    writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
    try {
      // Tighten permissions if the file already existed with looser ones.
      writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
    } catch {
      // ignore
    }
  } catch {
    // ignore write failures
  }
}

export function getToken(server: string): StoredToken | undefined {
  return readStore()[server];
}

export function setToken(server: string, token: StoredToken): void {
  const store = readStore();
  store[server] = token;
  writeStore(store);
}

export function clearToken(server: string): void {
  const store = readStore();
  delete store[server];
  writeStore(store);
}

/** True when a stored access token is missing or expired. */
export function needsRefresh(t: StoredToken | undefined): boolean {
  if (!t?.access_token) return true;
  if (t.expires_at && Date.now() >= t.expires_at - 30_000) return true;
  return false;
}

// --- Metadata discovery ----------------------------------------------------

function rootOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

/**
 * Discover the authorization server for an MCP endpoint.
 * Falls back to well-known defaults when metadata endpoints are unavailable.
 */
export async function discoverAuth(url: string): Promise<AuthMetadata> {
  const root = rootOf(url);
  const u = new URL(url);

  let authServerUrls: string[] = [];
  // 1. The WWW-Authenticate challenge may point at resource metadata.
  try {
    const res = await fetch(url, { method: "GET" });
    const challenge = res.headers.get("www-authenticate") || "";
    const m = /resource_metadata="([^"]+)"/.exec(challenge);
    if (m) authServerUrls.push(m[1]);
    if (!m) {
      authServerUrls.push(`${root}/.well-known/oauth-protected-resource${u.pathname}`);
      authServerUrls.push(`${root}/.well-known/oauth-protected-resource`);
    }
  } catch {
    authServerUrls.push(`${root}/.well-known/oauth-protected-resource${u.pathname}`);
  }

  let metadataUrl: string | undefined;
  for (const candidate of authServerUrls) {
    try {
      const res = await fetch(candidate, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const body: any = await res.json();
      if (Array.isArray(body.authorization_servers) && body.authorization_servers.length) {
        metadataUrl = body.authorization_servers[0];
      }
      break;
    } catch {
      // try next
    }
  }
  // Fall back to the MCP host itself as the authorization server.
  const authServer = metadataUrl || root;

  const candidates = [
    `${authServer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
    `${authServer.replace(/\/$/, "")}/.well-known/openid-configuration`,
  ];
  for (const c of candidates) {
    try {
      const res = await fetch(c, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const body: any = await res.json();
      if (body.authorization_endpoint && body.token_endpoint) {
        return {
          issuer: body.issuer,
          authorization_endpoint: body.authorization_endpoint,
          token_endpoint: body.token_endpoint,
          registration_endpoint: body.registration_endpoint,
          code_challenge_methods_supported: body.code_challenge_methods_supported,
        };
      }
    } catch {
      // try next
    }
  }

  throw new Error(
    `Could not discover OAuth metadata for ${url}. The server may not support OAuth, or its ` +
      `.well-known/oauth-authorization-server endpoint is unreachable.`,
  );
}

/** Register a client dynamically (RFC 7591) when the server supports it. */
export async function registerClient(
  meta: AuthMetadata,
  redirectUri: string,
  name = "Spyro Studio",
): Promise<{ clientId: string; clientSecret?: string } | null> {
  if (!meta.registration_endpoint) return null;
  try {
    const res = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    if (!body.client_id) return null;
    return { clientId: body.client_id, clientSecret: body.client_secret };
  } catch {
    return null;
  }
}

/** Build the URL the user must open to authorize. */
export function buildAuthorizeUrl(
  p: PendingAuth,
  opts: { clientId: string; scopes?: string[]; resource?: string },
): string {
  const url = new URL(p.metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("code_challenge", p.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", p.state);
  if (opts.scopes?.length) url.searchParams.set("scope", opts.scopes.join(" "));
  if (opts.resource) url.searchParams.set("resource", opts.resource);
  return url.toString();
}

/** Exchange an authorization code (or refresh token) for tokens. */
export async function exchangeCode(
  meta: AuthMetadata,
  p: PendingAuth,
  clientId: string,
  code: string,
  clientSecret?: string,
): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: p.redirectUri,
    client_id: clientId,
    code_verifier: p.verifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return normalizeToken(json, clientId, clientSecret);
}

/** Use a refresh token to get a new access token. */
export async function refreshToken(
  meta: AuthMetadata,
  _server: string,
  token: StoredToken,
): Promise<StoredToken> {
  if (!token.refresh_token) throw new Error("No refresh token stored for this server.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    client_id: token.client_id || "",
  });
  if (token.client_secret) body.set("client_secret", token.client_secret);

  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Token refresh failed (HTTP ${res.status}).`);
  const json: any = await res.json();
  // Servers may omit the refresh token on refresh — keep the old one.
  return normalizeToken({ refresh_token: token.refresh_token, ...json }, token.client_id, token.client_secret);
}

function normalizeToken(json: any, clientId?: string, clientSecret?: string): StoredToken {
  const expiresIn = Number(json.expires_in);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    token_type: json.token_type || "Bearer",
    expires_at: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : undefined,
    scope: json.scope,
    client_id: json.client_id || clientId,
    client_secret: json.client_secret || clientSecret,
  };
}

/**
 * Extract the `code` (and verify `state`) from whatever the user pasted back —
 * the full redirect URL or just the code.
 */
export function parseCallback(pasted: string, expectedState: string): string {
  const raw = pasted.trim();
  if (!raw) throw new Error("Nothing was pasted.");
  if (raw.includes("code=")) {
    const url = new URL(raw);
    const err = url.searchParams.get("error");
    if (err) {
      throw new Error(`Authorization failed: ${err}${url.searchParams.get("error_description") ? " — " + url.searchParams.get("error_description") : ""}`);
    }
    const state = url.searchParams.get("state");
    if (state && state !== expectedState) {
      throw new Error("Authorization state mismatch — this response is not for this login attempt.");
    }
    const code = url.searchParams.get("code");
    if (!code) throw new Error("No authorization code in the pasted URL.");
    return code;
  }
  return raw;
}