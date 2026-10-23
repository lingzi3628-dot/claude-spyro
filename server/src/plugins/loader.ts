import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolRegistry } from "../tools/index.js";
import type { Tool } from "../tools/types.js";

export interface Plugin {
  name: string;
  tools?: Tool[];
  onLoad?: (registry: ToolRegistry) => void | Promise<void>;
}

/**
 * Loads plugins from a directory. Each plugin is a .js/.mjs file that
 * default-exports a Plugin object (or a factory function returning one).
 */
export async function loadPlugins(dir: string, registry: ToolRegistry): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const loaded: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !/\.(m?js|cjs)$/.test(e.name)) continue;
    try {
      const mod = await import(pathToFileURL(resolve(join(dir, e.name))).href);
      const factory = mod.default ?? mod.plugin;
      const plugin: Plugin = typeof factory === "function" ? await factory() : factory;
      if (!plugin?.name) continue;
      for (const tool of plugin.tools || []) registry.register(tool);
      if (plugin.onLoad) await plugin.onLoad(registry);
      loaded.push(plugin.name);
    } catch (err: any) {
      console.error(`[plugins] failed to load ${e.name}: ${err.message}`);
    }
  }
  return loaded;
}
