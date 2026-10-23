export function emptyRules() {
    return { allow: [], deny: [], ask: [] };
}
function parseRule(rule) {
    const trimmed = rule.trim();
    const m = /^([A-Za-z_][\w-]*)\(([\s\S]*)\)$/.exec(trimmed);
    if (m)
        return { tool: m[1], spec: m[2] };
    return { tool: trimmed };
}
/** The argument a rule's spec is matched against, per tool. */
function primaryArg(name, args) {
    switch (name) {
        case "bash":
            return args.command !== undefined ? String(args.command) : undefined;
        case "read_file":
        case "write_file":
        case "edit_file":
        case "multi_edit":
        case "notebook_read":
        case "notebook_edit":
            return args.path !== undefined ? String(args.path) : undefined;
        case "webfetch":
            return args.url !== undefined ? String(args.url) : undefined;
        case "web_search":
            return args.query !== undefined ? String(args.query) : undefined;
        case "glob":
        case "grep":
            return args.pattern !== undefined ? String(args.pattern) : undefined;
        case "task":
            return args.prompt !== undefined ? String(args.prompt) : undefined;
        case "skill":
            return args.name !== undefined ? String(args.name) : undefined;
        default:
            return undefined;
    }
}
function globToRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$");
}
function specMatches(spec, value) {
    if (spec === "" || spec === "*")
        return true;
    // Claude-style prefix rule: `git commit:*` matches commands starting with `git commit`.
    if (spec.endsWith(":*"))
        return value.startsWith(spec.slice(0, -2));
    if (spec.includes("*"))
        return globToRegex(spec).test(value);
    return value === spec;
}
/**
 * Evaluates allow/deny/ask rules against tool calls.
 * Rule syntax: `tool` or `tool(spec)` where spec glob-matches the tool's primary
 * argument (bash command, file path, url, query, …). `*` is a wildcard and a
 * trailing `:*` means "command starts with".
 */
export class PermissionEngine {
    rules;
    constructor(rules) {
        this.rules = normalize(rules);
    }
    update(rules) {
        this.rules = normalize(rules);
    }
    getRules() {
        return {
            allow: [...this.rules.allow],
            deny: [...this.rules.deny],
            ask: [...this.rules.ask],
        };
    }
    check(name, args) {
        const value = primaryArg(name, args);
        if (this.rules.deny.some((r) => ruleMatches(r, name, value)))
            return "deny";
        if (this.rules.ask.some((r) => ruleMatches(r, name, value)))
            return "ask";
        if (this.rules.allow.some((r) => ruleMatches(r, name, value)))
            return "allow";
        return "default";
    }
}
function ruleMatches(rule, name, value) {
    const { tool, spec } = parseRule(rule);
    if (tool.toLowerCase() !== name.toLowerCase())
        return false;
    if (spec === undefined)
        return true;
    if (value === undefined)
        return true; // spec given but tool has no primary arg
    return specMatches(spec, value);
}
function normalize(rules) {
    return {
        allow: (rules?.allow || []).filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim()),
        deny: (rules?.deny || []).filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim()),
        ask: (rules?.ask || []).filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim()),
    };
}
