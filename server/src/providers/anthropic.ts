import type { ChatMessage, ChatChunk, ToolDef, Provider } from "../types.js";

/** Flatten message content (string or multimodal parts) to plain text. */
function contentText(content: ChatMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (p.type === "text" ? p.text : `[image ${p.media_type}]`))
    .join("\n");
}

/**
 * Anthropic Messages API provider (Claude).
 * Converts OpenAI-style internal messages/tools to Anthropic format and
 * normalizes the streaming events back to ChatChunk.
 */
export class AnthropicProvider implements Provider {
  name = "anthropic";
  model: string;
  baseUrl: string;
  apiKey: string;

  constructor(opts: { model: string; baseUrl: string; apiKey: string }) {
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  /** Map our content (string or multimodal parts) into Anthropic blocks. */
  private toBlocks(content: ChatMessage["content"]): any[] {
    if (content == null) return [];
    if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
    if (!Array.isArray(content)) return [];
    return content.map((p) =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : {
            type: "image",
            source: { type: "base64", media_type: p.media_type, data: p.data },
          },
    );
  }

  private convert(messages: ChatMessage[]) {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => contentText(m.content))
      .filter(Boolean)
      .join("\n\n");

    const out: any[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "user") {
        const blocks = this.toBlocks(m.content);
        out.push({ role: "user", content: blocks.length ? blocks : "" });
      } else if (m.role === "assistant") {
        const content: any[] = this.toBlocks(m.content);
        for (const tc of m.tool_calls || []) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments ?? {},
          });
        }
        out.push({ role: "assistant", content: content.length ? content : "" });
      } else if (m.role === "tool") {
        out.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: contentText(m.content),
            },
          ],
        });
      }
    }
    return { system, messages: out };
  }

  async *chat(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal?: AbortSignal,
  ): AsyncGenerator<ChatChunk> {
    const { system, messages: msgs } = this.convert(messages);
    const body: Record<string, any> = {
      model: this.model,
      max_tokens: 8192,
      messages: msgs,
      stream: true,
    };
    if (system) body.system = system;
    if (tools.length) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`anthropic HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const jsonToolCalls: any[] = [];

    for await (const line of this.readSSE(res.body)) {
      let json: any;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }

      if (json.type === "content_block_start") {
        const block = json.content_block;
        if (block?.type === "tool_use") {
          jsonToolCalls[json.index] = { id: block.id, name: block.name, args: "" };
        }
      } else if (json.type === "content_block_delta") {
        const d = json.delta;
        if (d?.type === "text_delta" && d.text) {
          yield { type: "text", text: d.text };
        } else if (d?.type === "input_json_delta") {
          const acc = jsonToolCalls[json.index];
          if (acc) acc.args += d.partial_json || "";
        }
      } else if (json.type === "message_delta" && json.usage) {
        yield { type: "usage", usage: json.usage };
      }
    }

    const toolCalls = jsonToolCalls
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        name: t.name,
        arguments: t.args ? JSON.parse(t.args) : {},
      }));
    if (toolCalls.length) yield { type: "tool_calls", toolCalls };
    else yield { type: "tool_calls", toolCalls: [] };
  }

  private async *readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (const raw of parts) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        yield line.slice(5).trim();
      }
    }
  }
}
