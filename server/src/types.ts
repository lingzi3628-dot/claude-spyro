export type Role = "system" | "user" | "assistant" | "tool";

/** A single piece of message content: plain text or an inline image. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string };

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /** Client-generated id, so a message can be edited/retried later. */
  client_id?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export type ChatChunk =
  | { type: "text"; text: string }
  /** Chain-of-thought from reasoning models (Nemotron, DeepSeek R1, etc.). */
  | { type: "reasoning"; text: string }
  | { type: "tool_calls"; toolCalls: ToolCall[] }
  | { type: "usage"; usage: Record<string, any> };

export interface Provider {
  name: string;
  model: string;
  chat(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal?: AbortSignal,
  ): AsyncGenerator<ChatChunk>;
}
