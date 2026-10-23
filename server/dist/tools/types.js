/** True if the resolved path lives inside a protected directory. */
export function isProtected(ctx, absPath) {
    return ctx.protectedDirs.some((dir) => absPath === dir || absPath.startsWith(dir.replace(/\/$/, "") + "/"));
}
export function toToolDefs(tools) {
    return tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
    }));
}
export function safeResolve(cwd, p) {
    if (!p)
        return cwd;
    return p.startsWith("/") ? p : new URL(p, `file://${cwd}/`).pathname;
}
