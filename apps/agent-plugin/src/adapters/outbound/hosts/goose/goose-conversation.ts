import { record } from "./goose-configuration.ts";

function messageText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  // Text blocks are decoded before comparison: JSON escaping and non-text metadata
  // must neither hide the requested task nor manufacture a matching user message.
  // Match Message::as_concat_text in Goose source bdb3e648 (message.rs): each
  // text block is separated by a newline, not silently fused into another task.
  return content.filter((part: unknown) => record(part) && part.type === "text" && typeof part.text === "string")
    .map((part: { text: string }) => part.text).join("\n");
}

/** Validate supported named-export envelopes; completion is transport evidence, not a quality verdict. */
export function decodeGooseConversation(data: unknown, prompt: string): { messages: unknown[] } {
  const conversation = record(data) ? data.conversation : undefined;
  const messages: unknown = record(data) && Array.isArray(data.messages) ? data.messages : Array.isArray(conversation) ? conversation : record(conversation) ? conversation.messages : undefined;
  if (!Array.isArray(messages) || !messages.length || !messages.every((message) => record(message) && typeof message.role === "string" && (typeof message.content === "string" || Array.isArray(message.content)))) throw new Error("Unsupported/empty exported conversation");
  if (!messages.some((message: unknown) => record(message) && message.role === "assistant" && (messageText(message.content)?.trim().length ?? 0) > 0)) throw new Error("Missing assistant output");
  // Do not trim or use substring matching: a different task is not this trial's evidence.
  if (!messages.some((message: unknown) => record(message) && message.role === "user" && messageText(message.content) === prompt)) throw new Error("Session prompt mismatch");
  return { messages };
}
