import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
/**
 * Loads plugins from a directory. Each plugin is a .js/.mjs file that
 * default-exports a Plugin object (or a factory function returning one).
 */
export async function loadPlugins(dir, registry) {
    if (!existsSync(dir))
        return [];
    const loaded = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isFile() || !/\.(m?js|cjs)$/.test(e.name))
            continue;
        try {
            const mod = await import(pathToFileURL(resolve(join(dir, e.name))).href);
            const factory = mod.default ?? mod.plugin;
            const plugin = typeof factory === "function" ? await factory() : factory;
            if (!plugin?.name)
                continue;
            for (const tool of plugin.tools || [])
                registry.register(tool);
            if (plugin.onLoad)
                await plugin.onLoad(registry);
            loaded.push(plugin.name);
        }
        catch (err) {
            console.error(`[plugins] failed to load ${e.name}: ${err.message}`);
        }
    }
    return loaded;
}
