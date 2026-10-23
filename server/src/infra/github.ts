import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.github.com";

export interface GhRepoRef {
  owner: string;
  repo: string;
}

/** Read a token from env, then `~/.config/gh/hosts.yml`, then the app config. */
export function githubToken(apiKeys: Record<string, string> = {}): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (apiKeys.github) return apiKeys.github;
  const ghHosts = join(homedir(), ".config", "gh", "hosts.yml");
  if (existsSync(ghHosts)) {
    try {
      const m = /oauth_token:\s*(\S+)/.exec(readFileSync(ghHosts, "utf8"));
      if (m) return m[1];
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * Parse "owner/repo", "PR #12", or a full GitHub URL into a repo reference.
 * Returns null when nothing repo-like was found.
 */
export function parseRepoRef(input: string, fallbackCwd?: string): GhRepoRef | null {
  const s = input.trim();
  const url = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i.exec(s);
  if (url) return { owner: url[1], repo: url[2] };
  const slug = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (slug) return { owner: slug[1], repo: slug[2] };
  if (fallbackCwd) return fromGitRemote(fallbackCwd);
  return null;
}

function fromGitRemote(cwd: string): GhRepoRef | null {
  const urlFile = join(cwd, ".git", "config");
  if (!existsSync(urlFile)) return null;
  try {
    const m = /url\s*=\s*(?:https?:\/\/|git@)github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?/i.exec(
      readFileSync(urlFile, "utf8"),
    );
    if (m) return { owner: m[1], repo: m[2] };
  } catch {
    // ignore
  }
  return null;
}

export class GitHubClient {
  constructor(private token: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    accept = "application/vnd.github+json",
  ): Promise<T> {
    const headers: Record<string, string> = {
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "claude-free-spyro",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
    };
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    const raw = await res.text();
    if (!raw.trim()) return undefined as T;
    // Diff endpoints return plain text; everything else returns JSON.
    if (accept.includes("diff")) return raw as unknown as T;
    return JSON.parse(raw) as T;
  }

  listPullRequests(ref: GhRepoRef, state = "open", limit = 20): Promise<any[]> {
    return this.request("GET", `/repos/${ref.owner}/${ref.repo}/pulls?state=${state}&per_page=${limit}`);
  }

  getPullRequest(ref: GhRepoRef, number: number): Promise<any> {
    return this.request("GET", `/repos/${ref.owner}/${ref.repo}/pulls/${number}`);
  }

  getPullRequestFiles(ref: GhRepoRef, number: number): Promise<any[]> {
    return this.request("GET", `/repos/${ref.owner}/${ref.repo}/pulls/${number}/files?per_page=100`);
  }

  getPullRequestDiff(ref: GhRepoRef, number: number): Promise<string> {
    return this.request("GET", `/repos/${ref.owner}/${ref.repo}/pulls/${number}`, undefined, "application/vnd.github.v3.diff");
  }

  createReviewComment(ref: GhRepoRef, number: number, body: string, path: string, line: number): Promise<any> {
    return this.request("POST", `/repos/${ref.owner}/${ref.repo}/pulls/${number}/comments`, {
      body,
      path,
      line,
    });
  }

  submitReview(ref: GhRepoRef, number: number, body: string, event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"): Promise<any> {
    return this.request("POST", `/repos/${ref.owner}/${ref.repo}/pulls/${number}/reviews`, {
      body,
      event,
    });
  }

  listIssues(ref: GhRepoRef, state = "open", limit = 20): Promise<any[]> {
    return this.request("GET", `/repos/${ref.owner}/${ref.repo}/issues?state=${state}&per_page=${limit}`);
  }

  createIssue(ref: GhRepoRef, title: string, body: string): Promise<any> {
    return this.request("POST", `/repos/${ref.owner}/${ref.repo}/issues`, { title, body });
  }

  getChecks(ref: GhRepoRef, refName: string): Promise<any> {
    return this.request("GET", `/repos/${ref.owner}/${ref.repo}/commits/${refName}/check-runs`);
  }
}

/** Human-readable one-liner for a PR. */
export function formatPr(pr: any): string {
  const flags = [
    pr.draft ? "draft" : null,
    pr.locked ? "locked" : null,
    pr.mergeable_state && pr.mergeable_state !== "clean" ? `mergeable:${pr.mergeable_state}` : null,
  ].filter(Boolean);
  return (
    `#${pr.number} ${pr.title}\n` +
    `by ${pr.user?.login || "?"} · ${pr.head?.ref || "?"} → ${pr.base?.ref || "?"} · ` +
    `${pr.changed_files ?? "?"} files, +${pr.additions ?? 0}/-${pr.deletions ?? 0}` +
    (flags.length ? `\n[${flags.join(", ")}]` : "")
  );
}