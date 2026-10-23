import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
async function runCmd(cmd, args, opts) {
    return new Promise((resolve) => {
        execFile(cmd, args, { ...opts, timeout: opts?.timeout ?? 30000 }, (err, stdout, stderr) => {
            resolve({ stdout: stdout || "", stderr: stderr || (err ? err.message : ""), code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
        });
    });
}
export const codeReviewTool = {
    name: "code_review",
    description: "Automated code review: analyze diffs, check for common issues, suggest improvements, " +
        "and generate review comments. Works on staged changes, unstaged changes, or specific files.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["review_diff", "review_file", "review_pr", "suggest"],
                description: "What to review",
            },
            path: { type: "string", description: "File path (for review_file)" },
            staged: { type: "boolean", description: "Review staged changes (default: unstaged)" },
            pr: { type: "number", description: "PR number (for review_pr)" },
        },
        required: ["action"],
    },
    async execute(args, ctx) {
        const cwd = ctx.cwd;
        const action = String(args.action || "review_diff");
        switch (action) {
            case "review_diff": {
                const staged = args.staged === true;
                const diffArgs = ["diff", "--no-color"];
                if (staged)
                    diffArgs.push("--cached");
                const r = await runCmd("git", diffArgs, { cwd, maxBuffer: 10 * 1024 * 1024 });
                const diff = r.stdout || r.stderr;
                if (!diff.trim())
                    return "No changes to review.";
                // Analyze the diff
                const files = diff.split("diff --git").length - 1;
                const additions = (diff.match(/^\+/gm) || []).length;
                const deletions = (diff.match(/^-/gm) || []).length;
                const issues = [];
                // Check for common issues
                if (diff.includes("console.log"))
                    issues.push("⚠ Found console.log statements");
                if (diff.includes("TODO") || diff.includes("FIXME"))
                    issues.push("⚠ Found TODO/FIXME comments");
                if (diff.includes("password") || diff.includes("secret") || diff.includes("api_key"))
                    issues.push("🔴 Possible secret exposure");
                if (diff.includes("any") && diff.includes(": any"))
                    issues.push("⚠ TypeScript 'any' type usage");
                if (additions > 500)
                    issues.push("⚠ Large diff (>500 lines added)");
                const review = [
                    `## Code Review`,
                    ``,
                    `**Files changed:** ${files}`,
                    `**Additions:** +${additions}  **Deletions:** -${deletions}`,
                    ``,
                    issues.length ? `### Issues found:\n${issues.map((i) => `- ${i}`).join("\n")}` : "### No obvious issues found ✅",
                    ``,
                    `### Diff preview (first 3000 chars):`,
                    "```diff",
                    diff.slice(0, 3000),
                    "```",
                ];
                return review.join("\n");
            }
            case "review_file": {
                if (!args.path)
                    return "Error: path required";
                const filePath = resolve(cwd, args.path);
                if (!existsSync(filePath))
                    return `Error: file not found: ${filePath}`;
                const content = readFileSync(filePath, "utf8");
                const lines = content.split("\n");
                const issues = [];
                // Basic checks
                if (content.includes("console.log"))
                    issues.push("⚠ console.log statements found");
                if (content.includes("TODO") || content.includes("FIXME"))
                    issues.push("⚠ TODO/FIXME comments");
                if (content.includes("password") || content.includes("secret"))
                    issues.push("🔴 Possible secret exposure");
                if (content.includes(": any"))
                    issues.push("⚠ TypeScript 'any' type usage");
                if (lines.length > 500)
                    issues.push("⚠ File is very long (>500 lines)");
                // Check for missing error handling
                if (content.includes("await ") && !content.includes("try") && !content.includes("catch")) {
                    issues.push("⚠ Async operations without try/catch");
                }
                return [
                    `## File Review: ${args.path}`,
                    ``,
                    `**Lines:** ${lines.length}`,
                    issues.length ? `### Issues:\n${issues.map((i) => `- ${i}`).join("\n")}` : "### No obvious issues ✅",
                ].join("\n");
            }
            case "review_pr": {
                if (!args.pr)
                    return "Error: pr number required";
                const r = await runCmd("gh", ["pr", "view", String(args.pr), "--json", "title,body,files,additions,deletions"], { cwd });
                if (r.code !== 0)
                    return `Error: ${r.stderr.trim()}`;
                try {
                    const pr = JSON.parse(r.stdout);
                    return `## PR #${args.pr}: ${pr.title}\n\n${pr.body || "(no description)"}\n\nFiles: ${pr.files?.length || 0} | +${pr.additions} -${pr.deletions}`;
                }
                catch {
                    return r.stdout.trim();
                }
            }
            case "suggest": {
                const r = await runCmd("git", ["diff", "--no-color"], { cwd, maxBuffer: 10 * 1024 * 1024 });
                const diff = r.stdout || "";
                if (!diff.trim())
                    return "No changes to suggest improvements for.";
                const suggestions = [];
                if (diff.includes("var "))
                    suggestions.push("Consider using `const` or `let` instead of `var`");
                if (diff.includes("== ") && !diff.includes("==="))
                    suggestions.push("Consider using `===` instead of `==`");
                if (diff.includes("function("))
                    suggestions.push("Consider using arrow functions for consistency");
                if (!suggestions.length)
                    suggestions.push("Code looks clean — no obvious improvements suggested.");
                return `## Suggestions\n\n${suggestions.map((s) => `- ${s}`).join("\n")}`;
            }
            default:
                return `Unknown action: ${action}`;
        }
    },
};
