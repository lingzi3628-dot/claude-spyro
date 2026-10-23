import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename, } from "node:path";
import { } from "node:fs/promises";

const ROOT = join(homedir(), ".claude-free");
const PLUGINS_DIR = join(ROOT, "plugins");
const MARKETPLACES_DIR = join(ROOT, "marketplaces");
const REGISTRY_PATH = join(PLUGINS_DIR, "registry.json");

export interface MarketplacePluginEntry {
  name: string;
  source?: string;
  description?: string;
  version?: string;
}

export interface MarketplaceInfo {
  name: string;
  repo: string;
  path: string;
  description?: string;
  plugins: MarketplacePluginEntry[];
}

export interface PluginComponents {
  commands?: string;
  agents?: string;
  skills?: string;
  hooks?: string;
  mcp?: string;
}

export interface InstalledPlugin {
  name: string;
  path: string;
  version?: string;
  description?: string;
  marketplace?: string;
  enabled: boolean;
  components: PluginComponents;
}

interface RegistryFile {
  plugins: Record<string, InstalledPlugin & { repo?: string }>;
}

function ensureDirs(): void {
  for (const d of [ROOT, PLUGINS_DIR, MARKETPLACES_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function readRegistry(): RegistryFile {
  try {
    if (existsSync(REGISTRY_PATH)) return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {}
  return { plugins: {} };
}

function writeRegistry(reg: RegistryFile): void {
  ensureDirs();
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

/** Resolve a shorthand like `owner/repo` to a full git URL. */
export function resolveRepo(input: string): string {
  const s = input.trim();
  if (existsSync(s)) return s;
  if (/^https?:\/\//.test(s) || /^git@/.test(s) || /^git:/.test(s)) return s;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s}.git`;
  if (/^[\w.-]+\/[\w.-]+\.git$/.test(s)) return `https://github.com/${s}`;
  return s;
}

function repoName(repo: string): string {
  const s = repo.trim().replace(/\.git\/?$/, "").replace(/\/+$/, "");
  return basename(s) || "marketplace";
}

function gitClone(repo: string, dest: string): Promise<void> {
  return new Promise((res, rej) => {
    execFile(
      "git",
      ["clone", "--depth", "1", "--", repo, dest],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) rej(new Error(`git clone failed: ${stderr?.trim() || err.message}`));
        else res();
      },
    );
  });
}

function readJsonFile(path: string): any {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Find a plugin manifest inside a directory (plugin.json or .claude-plugin/plugin.json). */
function findPluginManifest(dir: string): { file: string; data: any } | null {
  const candidates = [
    join(dir, "plugin.json"),
    join(dir, ".claude-plugin", "plugin.json"),
  ];
  for (const c of candidates) {
    const data = readJsonFile(c);
    if (data && typeof data === "object" && data.name) return { file: c, data };
  }
  return null;
}

/** Recursively copy a directory, replacing the destination. */
function copyDir(src: string, dest: string): void {
  cpSync(src, dest, { recursive: true, dereference: true });
}

function resolveComponent(pluginDir: string, value: string | undefined, relDefault: string): string | undefined {
  const rel = value || relDefault;
  const abs = resolve(pluginDir, rel);
  return existsSync(abs) ? abs : undefined;
}

/** Normalise a plugin manifest into InstalledPlugin shape (without registry fields). */
function manifestToPlugin(name: string, dir: string, data: any): InstalledPlugin {
  const components: PluginComponents = {};
  const cmd = resolveComponent(dir, data.commands, "commands");
  if (cmd) components.commands = cmd;
  const ag = resolveComponent(dir, data.agents, "agents");
  if (ag) components.agents = ag;
  const sk = resolveComponent(dir, data.skills, "skills");
  if (sk) components.skills = sk;
  const hk = resolveComponent(dir, data.hooks, "hooks.json");
  if (hk) components.hooks = hk;
  const mc = resolveComponent(dir, data.mcp, "mcp.json");
  if (mc) components.mcp = mc;
  return {
    name: data.name || name,
    path: dir,
    version: data.version || undefined,
    description: data.description || undefined,
    enabled: true,
    components,
  };
}

function gitPull(repoDir: string): Promise<void> {
  return new Promise((res, rej) => {
    execFile("git", ["-C", repoDir, "pull", "--ff-only"], { timeout: 120_000 }, (err, _o, stderr) => {
      if (err) rej(new Error(`git pull failed: ${stderr?.trim() || err.message}`));
      else res();
    });
  });
}

function gitRevParseHead(dir: string): Promise<string | undefined> {
  return new Promise((res) => {
    execFile("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 15_000 }, (err, stdout) => {
      res(err ? undefined : stdout.trim());
    });
  });
}

export interface PluginUpdateResult {
  name: string;
  status: "updated" | "unchanged" | "failed";
  from?: string;
  to?: string;
  error?: string;
}

export class PluginManager {
  /** List every cloned marketplace repo and the plugins it offers. */
  async listMarketplaces(): Promise<MarketplaceInfo[]> {
    const out: MarketplaceInfo[] = [];
    if (!existsSync(MARKETPLACES_DIR)) return out;
    for (const name of readdirSync(MARKETPLACES_DIR)) {
      const dir = join(MARKETPLACES_DIR, name);
      const manifest = readJsonFile(join(dir, ".claude-plugin", "marketplace.json")) ||
        readJsonFile(join(dir, "marketplace.json"));
      if (!manifest) continue;
      const plugins: MarketplacePluginEntry[] = Array.isArray(manifest.plugins)
        ? manifest.plugins.map((p: any) => ({
            name: String(p.name || ""),
            source: typeof p.source === "string" ? p.source : undefined,
            description: typeof p.description === "string" ? p.description : undefined,
            version: typeof p.version === "string" ? p.version : undefined,
          }))
        : [];
      out.push({
        name: manifest.name || name,
        repo: name,
        path: dir,
        description: manifest.description || undefined,
        plugins: plugins.filter((p) => p.name),
      });
    }
    return out;
  }

  /** Add a marketplace by git URL (or `owner/repo`). Clones the repo. */
  async addMarketplace(repo: string): Promise<MarketplaceInfo> {
    const url = resolveRepo(repo);
    const name = repoName(url);
    const dest = join(MARKETPLACES_DIR, name);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    ensureDirs();
    await gitClone(url, dest);
    const marketplaces = await this.listMarketplaces();
    const found = marketplaces.find((m) => m.name === name || m.path === dest);
    if (!found) throw new Error(`No marketplace.json found in ${url}`);
    return found;
  }

  async removeMarketplace(name: string): Promise<void> {
    const dir = join(MARKETPLACES_DIR, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  /**
   * Install a plugin. Pass a git URL, `owner/repo`, or a plugin name from a
   * previously added marketplace (`install("name", "marketplace-name")`).
   */
  async install(nameOrRepo: string, marketplace?: string): Promise<InstalledPlugin> {
    ensureDirs();

    // Resolve a plugin entry from a marketplace.
    let source: string | undefined;
    let name = nameOrRepo;
    let marketPath: string | undefined;
    if (marketplace) {
      const markets = await this.listMarketplaces();
      const market = markets.find((m) => m.name === marketplace || m.repo === marketplace);
      if (!market) throw new Error(`Unknown marketplace "${marketplace}".`);
      const entry = market.plugins.find((p) => p.name === nameOrRepo);
      if (!entry) throw new Error(`Plugin "${nameOrRepo}" not found in ${market.name}.`);
      name = entry.name;
      source = entry.source;
      marketPath = market.path;
    }

    const dest = join(PLUGINS_DIR, name);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });

    if (source) {
      // Relative source = a path inside the already-cloned marketplace.
      const marketDir = marketPath!;
      const abs = resolve(marketDir, source);
      if (!existsSync(abs)) throw new Error(`Plugin source "${source}" not found in marketplace.`);
      copyDir(abs, dest);
    } else {
      // Treat as a git URL / shorthand and clone directly.
      const url = resolveRepo(nameOrRepo);
      await gitClone(url, dest);
    }

    const manifest = findPluginManifest(dest);
    const plugin = manifest ? manifestToPlugin(name, dest, manifest.data) : {
      name,
      path: dest,
      enabled: true,
      components: {},
    };

    const reg = readRegistry();
    reg.plugins[plugin.name] = {
      ...plugin,
      // Remember where it came from so update() knows how to refresh it.
      repo: source ? undefined : nameOrRepo,
      marketplace: source ? marketplace : undefined,
    };
    writeRegistry(reg);
    return plugin;
  }

  /**
   * Update one installed plugin. Refreshes its marketplace first (so a
   * marketplace-provided plugin picks up a new source revision), then
   * pulls/re-copies and re-reads the manifest.
   */
  async update(name: string): Promise<PluginUpdateResult> {
    const reg = readRegistry();
    const p = reg.plugins[name];
    if (!p) return { name, status: "failed", error: `Plugin "${name}" is not installed.` };
    const from = await gitRevParseHead(p.path);

    try {
      if (p.marketplace) {
        // Marketplace-backed: refresh the marketplace clone, then re-copy the
        // plugin's source directory over the installed copy.
        const markets = await this.listMarketplaces();
        const market = markets.find((m) => m.name === p.marketplace || m.repo === p.marketplace);
        if (!market) throw new Error(`Unknown marketplace "${p.marketplace}".`);
        await gitPull(market.path);
        const entry = market.plugins.find((e) => e.name === name);
        if (entry?.source) {
          const src = resolve(market.path, entry.source);
          if (!existsSync(src)) throw new Error(`Plugin source "${entry.source}" not found.`);
          if (existsSync(p.path)) {
            rmSync(p.path, { recursive: true, force: true });
          }
          cpSync(src, p.path, { recursive: true, dereference: true });
        }
      } else if (p.repo) {
        await gitPull(p.path);
      } else {
        throw new Error("This plugin was not installed from git; reinstall it to update.");
      }

      const manifest = findPluginManifest(p.path);
      const fresh = manifest ? manifestToPlugin(name, p.path, manifest.data) : { ...p, components: {} };
      reg.plugins[name] = { ...fresh, enabled: p.enabled, marketplace: p.marketplace, repo: p.repo };
      writeRegistry(reg);

      const to = await gitRevParseHead(p.path);
      return { name, status: from && to && from !== to ? "updated" : "unchanged", from, to };
    } catch (err: any) {
      return { name, status: "failed", error: err?.message || String(err) };
    }
  }

  /** Update every installed plugin that came from git. */
  async updateAll(): Promise<PluginUpdateResult[]> {
    const out: PluginUpdateResult[] = [];
    const reg = readRegistry();
    for (const p of Object.values(reg.plugins)) {
      if (!p.marketplace && !p.repo) {
        out.push({ name: p.name, status: "failed", error: "Not installed from git." });
        continue;
      }
      out.push(await this.update(p.name));
    }
    return out;
  }

  async uninstall(name: string): Promise<void> {
    const reg = readRegistry();
    const p = reg.plugins[name];
    if (p?.path && existsSync(p.path)) rmSync(p.path, { recursive: true, force: true });
    delete reg.plugins[name];
    writeRegistry(reg);
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    const reg = readRegistry();
    const p = reg.plugins[name];
    if (!p) throw new Error(`Plugin "${name}" is not installed.`);
    p.enabled = enabled;
    writeRegistry(reg);
  }

  listInstalled(): InstalledPlugin[] {
    const reg = readRegistry();
    return Object.values(reg.plugins);
  }

  /**
   * Absolute paths of every contributed component directory/file from enabled
   * plugins — used to feed the command/agent/skill loaders, hooks and MCP.
   */
  componentDirs(): {
    commands: string[];
    agents: string[];
    skills: string[];
    hookFiles: string[];
    mcpFiles: string[];
  } {
    const out = { commands: [] as string[], agents: [] as string[], skills: [] as string[], hookFiles: [] as string[], mcpFiles: [] as string[] };
    for (const p of this.listInstalled()) {
      if (!p.enabled) continue;
      const c = p.components;
      if (c.commands && existsSync(c.commands)) out.commands.push(c.commands);
      if (c.agents && existsSync(c.agents)) out.agents.push(c.agents);
      if (c.skills && existsSync(c.skills)) out.skills.push(c.skills);
      if (c.hooks && existsSync(c.hooks)) out.hookFiles.push(c.hooks);
      if (c.mcp && existsSync(c.mcp)) out.mcpFiles.push(c.mcp);
    }
    return out;
  }
}

export { findPluginManifest, copyDir, readJsonFile };
