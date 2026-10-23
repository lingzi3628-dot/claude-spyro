import { GitHubClient, githubToken, parseRepoRef, formatPr } from "../infra/github.js";
/** Build a client from the configured token, or explain what's missing. */
function client(ctx) {
    // Public repos are readable without a token; a token just raises rate limits
    // and unlocks private repos and posting reviews.
    return new GitHubClient(githubToken(ctx.apiKeys) || "");
}
const NO_TOKEN_HINT = " (No GitHub token set — this only works on public repos and has low rate limits. " +
    "Set GITHUB_TOKEN or add a GitHub token in Settings to raise limits and post reviews.)";
function resolveRef(repoArg, cwd) {
    return parseRepoRef(String(repoArg || ""), cwd);
}
export const githubPrListTool = {
    name: "github_pr_list",
    description: "List pull requests for a GitHub repository (owner/repo, a GitHub URL, or omit to use the current " +
        "folder's git remote). Use this before reviewing a PR.",
    parameters: {
        type: "object",
        properties: {
            repo: { type: "string", description: "owner/repo or GitHub URL. Defaults to the current repo." },
            state: { type: "string", enum: ["open", "closed", "all"], description: "Default open." },
        },
    },
    async execute(args, ctx) {
        const c = client(ctx);
        const ref = resolveRef(args.repo, ctx.cwd);
        if (!ref)
            return "Error: could not determine the repository. Pass owner/repo or run inside a git repo.";
        const prs = await c.listPullRequests(ref, args.state || "open", 20);
        if (!prs.length)
            return `No ${args.state || "open"} pull requests in ${ref.owner}/${ref.repo}.${NO_TOKEN_HINT}`;
        return prs.map((pr) => formatPr(pr)).join("\n\n");
    },
};
export const githubPrViewTool = {
    name: "github_pr_view",
    description: "Fetch a pull request's title, body, stats, and changed files (with per-file add/delete counts). " +
        "Use this to understand what a PR does before reviewing it.",
    parameters: {
        type: "object",
        properties: {
            number: { type: "number", description: "PR number." },
            repo: { type: "string", description: "owner/repo or URL. Defaults to the current repo." },
        },
        required: ["number"],
    },
    async execute(args, ctx) {
        const c = client(ctx);
        const ref = resolveRef(args.repo, ctx.cwd);
        if (!ref)
            return "Error: could not determine the repository.";
        const pr = await c.getPullRequest(ref, Number(args.number));
        const files = await c.getPullRequestFiles(ref, Number(args.number));
        const fileLines = files
            .map((f) => `  ${f.status.padEnd(9)} +${f.additions}/-${f.deletions}  ${f.filename}`)
            .join("\n");
        return `${formatPr(pr)}\n\n${pr.body || "(no description)"}\n\nChanged files:\n${fileLines}${NO_TOKEN_HINT}`;
    },
};
export const githubPrDiffTool = {
    name: "github_pr_diff",
    description: "Fetch the unified diff of a pull request. Optionally limit to one file path. Use this to actually " +
        "read the changes when reviewing a PR.",
    parameters: {
        type: "object",
        properties: {
            number: { type: "number", description: "PR number." },
            path: { type: "string", description: "Only include this file." },
            repo: { type: "string", description: "owner/repo or URL. Defaults to the current repo." },
        },
        required: ["number"],
    },
    async execute(args, ctx) {
        const c = client(ctx);
        const ref = resolveRef(args.repo, ctx.cwd);
        if (!ref)
            return "Error: could not determine the repository.";
        const diff = await c.getPullRequestDiff(ref, Number(args.number));
        if (args.path) {
            const wanted = String(args.path);
            const blocks = diff.split(/\n(?=diff --git )/);
            const match = blocks.filter((b) => b.includes(wanted));
            if (!match.length)
                return `No changes to "${wanted}" in PR #${args.number}.`;
            return match.join("\n");
        }
        const max = 120000;
        return diff.length > max ? diff.slice(0, max) + "\n… [truncated]" : diff || "(empty diff)";
    },
};
export const githubPrReviewTool = {
    name: "github_pr_review",
    description: "Submit a review on a pull request: APPROVE, REQUEST_CHANGES, or COMMENT. Only call this when the " +
        "user explicitly asks you to post a review.",
    parameters: {
        type: "object",
        properties: {
            number: { type: "number", description: "PR number." },
            body: { type: "string", description: "The review text to post." },
            action: {
                type: "string",
                enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
                description: "Review action. Default COMMENT.",
            },
            repo: { type: "string", description: "owner/repo or URL. Defaults to the current repo." },
        },
        required: ["number", "body"],
    },
    async execute(args, ctx) {
        const c = client(ctx);
        const ref = resolveRef(args.repo, ctx.cwd);
        if (!ref)
            return "Error: could not determine the repository.";
        const action = (["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(String(args.action))
            ? String(args.action)
            : "COMMENT");
        const res = await c.submitReview(ref, Number(args.number), String(args.body), action);
        return `Posted ${action} review on #${args.number} (${res.state || "submitted"}).`;
    },
};
export const githubIssueTool = {
    name: "github_issue",
    description: "List open issues in a GitHub repository, or create a new issue when asked.",
    parameters: {
        type: "object",
        properties: {
            repo: { type: "string", description: "owner/repo or URL. Defaults to the current repo." },
            action: { type: "string", enum: ["list", "create"], description: "Default list." },
            title: { type: "string", description: "Issue title (for create)." },
            body: { type: "string", description: "Issue body (for create)." },
        },
    },
    async execute(args, ctx) {
        const c = client(ctx);
        const ref = resolveRef(args.repo, ctx.cwd);
        if (!ref)
            return "Error: could not determine the repository.";
        if (args.action === "create") {
            if (!args.title)
                return "Error: title is required to create an issue.";
            const res = await c.createIssue(ref, String(args.title), String(args.body || ""));
            return `Created issue #${res.number}: ${res.html_url}`;
        }
        const issues = await c.listIssues(ref, "open", 20);
        const real = issues.filter((i) => !i.pull_request);
        if (!real.length)
            return `No open issues in ${ref.owner}/${ref.repo}.`;
        return real.map((i) => `#${i.number} ${i.title} — ${i.user?.login}`).join("\n");
    },
};
