import type { Tool } from "./types.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDdgUrl(href: string): string {
  // DDG wraps links as /l/?uddg=<encoded>
  try {
    const u = href.startsWith("http") ? new URL(href) : new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg;
    return u.toString();
  } catch {
    return href;
  }
}

async function braveSearch(query: string, count: number, key: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?count=${count}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const json: any = await res.json();
  return (json.web?.results || []).map((r: any) => ({
    title: stripTags(r.title || ""),
    url: r.url || "",
    snippet: stripTags(r.description || ""),
  }));
}

async function serperSearch(query: string, count: number, key: string): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q: query, num: count }),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const json: any = await res.json();
  return (json.organic || []).map((r: any) => ({
    title: stripTags(r.title || ""),
    url: r.link || "",
    snippet: stripTags(r.snippet || ""),
  }));
}

async function ddgSearch(query: string, count: number): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const snippets: string[] = [];
  const sre = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = sre.exec(html))) snippets.push(stripTags(sm[1]));
  let i = 0;
  while ((m = re.exec(html)) && results.length < count) {
    results.push({
      title: stripTags(m[2]),
      url: decodeDdgUrl(m[1]),
      snippet: snippets[i] || "",
    });
    i++;
  }
  return results;
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web and return ranked results (title, URL, snippet). Use this to find up-to-date " +
    "information, documentation, or answers. Uses a configured search API key (Brave/Serper) when " +
    "available, otherwise falls back to DuckDuckGo.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      count: {
        type: "number",
        description: "Number of results to return (default 5, max 10).",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    const query = String(args.query || "").trim();
    if (!query) return "Error: query is required.";
    const count = Math.min(Math.max(Number(args.count) || 5, 1), 10);

    let results: SearchResult[] = [];
    let via = "";
    try {
      if (process.env.BRAVE_API_KEY) {
        via = "Brave";
        results = await braveSearch(query, count, process.env.BRAVE_API_KEY);
      } else if (process.env.SERPER_API_KEY) {
        via = "Serper";
        results = await serperSearch(query, count, process.env.SERPER_API_KEY);
      } else {
        via = "DuckDuckGo";
        results = await ddgSearch(query, count);
      }
    } catch (err: any) {
      // Fall back to DuckDuckGo if a configured API fails.
      if (via !== "DuckDuckGo") {
        try {
          via = "DuckDuckGo (fallback)";
          results = await ddgSearch(query, count);
        } catch (err2: any) {
          return `Error searching: ${err2?.message || String(err2)}`;
        }
      } else {
        return `Error searching: ${err?.message || String(err)}`;
      }
    }

    if (!results.length) return `No results for "${query}" (via ${via}).`;
    const body = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");
    return `Search results for "${query}" (via ${via}):\n\n${body}`;
  },
};
