import type { Tool } from "./types.js";

/** List the resources exposed by connected MCP servers. */
export const mcpResourcesTool: Tool = {
  name: "mcp_resources",
  description:
    "List resources exposed by connected MCP servers (files, docs, database entries, …). Use this to " +
    "discover what a server offers before reading from it.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "Only list resources from this MCP server." },
    },
  },
  async execute(args, ctx) {
    if (!ctx.mcp?.allResources) return "Error: MCP resources are not available.";
    const all = ctx.mcp.allResources();
    const filtered = args.server ? all.filter((r) => r.server === args.server) : all;
    if (!filtered.length) {
      return all.length
        ? `No resources from server "${args.server}". Available servers: ${[...new Set(all.map((r) => r.server))].join(", ")}`
        : "No MCP resources available. No connected server exposes resources.";
    }
    return filtered
      .map((r) => `- [${r.server}] ${r.name}${r.description ? ` — ${r.description}` : ""}\n  uri: ${r.uri}${r.mimeType ? ` (${r.mimeType})` : ""}`)
      .join("\n");
  },
};

/** Read one MCP resource. */
export const mcpReadResourceTool: Tool = {
  name: "mcp_read_resource",
  description:
    "Read the contents of an MCP resource by its uri (use mcp_resources to discover them).",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "The MCP server that owns the resource." },
      uri: { type: "string", description: "The resource uri." },
    },
    required: ["uri"],
  },
  async execute(args, ctx) {
    if (!ctx.mcp?.readResource) return "Error: MCP resources are not available.";
    const uri = String(args.uri || "").trim();
    if (!uri) return "Error: uri is required.";
    const server = args.server ? String(args.server) : uri.split("://")[0];
    const text = await ctx.mcp.readResource(server, uri);
    if (text.length > 20000) return text.slice(0, 20000) + "\n… [truncated]";
    return text;
  },
};

/** List prompts exposed by connected MCP servers. */
export const mcpPromptsTool: Tool = {
  name: "mcp_prompts",
  description:
    "List reusable prompts exposed by connected MCP servers. A prompt is a parameterised template " +
    "the server provides; render one with mcp_prompt.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "Only list prompts from this MCP server." },
    },
  },
  async execute(args, ctx) {
    if (!ctx.mcp?.allPrompts) return "Error: MCP prompts are not available.";
    const all = ctx.mcp.allPrompts();
    const filtered = args.server ? all.filter((p) => p.server === args.server) : all;
    if (!filtered.length) return "No MCP prompts available.";
    return filtered
      .map((p) => {
        const argsList = p.arguments?.length
          ? ` (args: ${p.arguments.map((a) => a.name + (a.required ? "*" : "")).join(", ")})`
          : "";
        return `- [${p.server}] ${p.name}${argsList}${p.description ? ` — ${p.description}` : ""}`;
      })
      .join("\n");
  },
};

/** Render one MCP prompt. */
export const mcpPromptTool: Tool = {
  name: "mcp_prompt",
  description:
    "Render a prompt from an MCP server with the given arguments, then follow it. Use mcp_prompts " +
    "to discover the available prompts and their arguments.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "The MCP server that owns the prompt." },
      name: { type: "string", description: "The prompt name." },
      args: {
        type: "object",
        description: "Values for the prompt's arguments, keyed by argument name.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["name"],
  },
  async execute(args, ctx) {
    if (!ctx.mcp?.getPrompt) return "Error: MCP prompts are not available.";
    const name = String(args.name || "").trim();
    if (!name) return "Error: name is required.";
    const all = ctx.mcp.allPrompts?.() || [];
    const match = all.find((p) => p.name === name && (!args.server || p.server === args.server));
    if (!match) {
      const names = all.map((p) => `${p.server}/${p.name}`);
      return `Error: unknown MCP prompt "${name}". Available: ${names.length ? names.join(", ") : "(none)"}.`;
    }
    const argValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(args.args || {})) argValues[k] = String(v);
    return await ctx.mcp.getPrompt(match.server, name, argValues);
  },
};