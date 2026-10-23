import type { Tool } from "./types.js";

export const webfetchTool: Tool = {
  name: "webfetch",
  description:
    "Fetch a URL and return its contents as text. Useful for reading documentation or web pages.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch (must start with http)." },
    },
    required: ["url"],
  },
  async execute(args) {
    const url = String(args.url || "");
    if (!/^https?:\/\//.test(url)) return "Error: URL must start with http:// or https://";
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Spyro Studio/0.1" },
        redirect: "follow",
      });
      const contentType = res.headers.get("content-type") || "";
      let text = await res.text();
      if (contentType.includes("text/html")) {
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      if (text.length > 100_000) text = text.slice(0, 100_000) + "\n...[truncated]";
      return `HTTP ${res.status}\n${text}`;
    } catch (err: any) {
      return `Error fetching ${url}: ${err.message}`;
    }
  },
};
