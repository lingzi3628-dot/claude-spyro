import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { emptyRules } from "./permissions.js";
/**
 * Read and merge settings from `~/.claude-free/settings.json` and
 * `<cwd>/.claude/settings.json`. Project-level settings take precedence.
 */
export function loadProjectSettings(cwd) {
    const merged = {};
    const paths = [
        join(homedir(), ".claude-free", "settings.json"),
        join(homedir(), ".claude", "settings.json"),
        join(cwd, ".claude", "settings.json"),
    ];
    for (const p of paths) {
        if (!existsSync(p))
            continue;
        try {
            const raw = JSON.parse(readFileSync(p, "utf8"));
            if (raw.permissions)
                merged.permissions = { ...emptyRules(), ...raw.permissions };
            if (typeof raw.autoApprove === "boolean")
                merged.autoApprove = raw.autoApprove;
            if (typeof raw.model === "string")
                merged.model = raw.model;
            if (typeof raw.temperature === "number")
                merged.temperature = raw.temperature;
            if (typeof raw.maxTokens === "number")
                merged.maxTokens = raw.maxTokens;
        }
        catch {
            // ignore malformed settings
        }
    }
    return merged;
}
