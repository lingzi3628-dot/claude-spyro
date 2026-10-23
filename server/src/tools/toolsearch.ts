import type { Tool } from "./types.js";

/**
 * Tools that are always offered to the model.
 *
 * Sending all ~49 schemas on every request costs ~12 kB of JSON and, far worse,
 * dominates the time-to-first-byte on small local models — measured at 181 s for
 * qwen2.5-coder:1.5b. These are the ones a run cannot proceed without.
 */
export const CORE_TOOLS = [
  // These must match the registered tool names exactly. A name that is not
  // registered is simply filtered out of visibleTools(), so the model is told
  // a tool exists that it can never see — while the real tool stays hidden.
  "read_file",
  "write_file",
  "edit_file",
  "bash",
  "list_dir",
  "glob",
  "grep",
  "todo_write",
  "task",
  "ask_user",
  // Asset generation is core to building anything visual, so it stays loaded.
  "generate_image",
];

export interface CatalogueEntry {
  name: string;
  description: string;
}

/**
 * Build the lazy-loading tool.
 *
 * The model sees only CORE_TOOLS plus this one. Calling it reveals matching
 * tools for the rest of the session, after which they behave normally.
 */
export function makeToolSearch(all: () => Tool[], activate: (names: string[]) => string[]): Tool {
  return {
    name: "tool_search",
    description:
      "Find and load tools that are not currently available. Only a small core set is loaded by " +
      "default to keep requests fast. Search by what you want to do (e.g. \"github\", \"pdf\", " +
      "\"lsp\", \"image\", \"team\", \"mcp\"), then call the matching tools normally. Loaded tools " +
      "stay available for the rest of the session.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you want the tool to do, or a keyword to match against.",
        },
      },
      required: ["query"],
    },
    requiresApproval: false,
    async execute(args: { query: string }) {
      const q = (args?.query || "").trim();
      if (!q) return "Provide a query.";

      const ql = q.toLowerCase();
      const everything = all();

      const scored = everything
        .filter((t) => !["tool_search", ...CORE_TOOLS].includes(t.name))
        .map((t) => {
          const d = (t.description || "").toLowerCase();
          const n = t.name.toLowerCase();
          let s = -1;
          if (n === ql) s = 100;
          else if (n.includes(ql)) s = 80;
          else if (d.includes(ql)) s = 60;
          else {
            // subsequence match, so "pdf" finds readPdf, "gh" finds github_pr_list
            let i = 0;
            for (const ch of n) if (ch === ql[i]) i++;
            if (i === ql.length && ql.length >= 2) s = 40;
            else {
              const words = ql.split(/\s+/).filter(Boolean);
              const hits = words.filter((w) => n.includes(w) || d.includes(w)).length;
              if (hits) s = 20 + hits * 5;
            }
          }
          return { t, s };
        })
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8);

      if (scored.length === 0) {
        const available = everything
          .filter((t) => !["tool_search", ...CORE_TOOLS].includes(t.name))
          .map((t) => t.name);
        return (
          `No tool matched "${q}".\n\nAvailable tools you can search for:\n` +
          available.join(", ")
        );
      }

      const names = scored.map((x) => x.t.name);
      const newly = activate(names);
      const lines = scored.map((x) => `  ${x.t.name} — ${x.t.description.split("\n")[0]}`);

      return (
        `Loaded ${names.length} tool(s): ${names.join(", ")}\n\n` +
        `${lines.join("\n")}\n\n` +
        (newly.length
          ? `Newly activated: ${newly.join(", ")}`
          : "These were already active.") +
        "\n\nCall them normally now."
      );
    },
  };
}