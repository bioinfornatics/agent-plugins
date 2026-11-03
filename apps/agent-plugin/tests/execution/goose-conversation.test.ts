import { expect, test } from "bun:test";
import { decodeGooseConversation } from "../../src/adapters/outbound/hosts/goose/goose-conversation.ts";

const prompt = 'First line\n"quoted" \\ path';
const messages = [
  { role: "user", content: [{ type: "text", text: 'First line' }, { type: "text", text: '"quoted" \\ path' }] },
  { role: "assistant", content: [{ type: "text", text: "Result" }] },
];

test("supported envelopes decode typed text blocks without normalizing task bytes", () => {
  for (const data of [{ messages }, { conversation: messages }, { conversation: { messages } }]) {
    expect(decodeGooseConversation(data, prompt)).toEqual({ messages });
  }
});

test("non-text metadata and near-match prompts cannot establish task attribution", () => {
  for (const content of [
    ` ${prompt}`, `${prompt} suffix`,
    [{ type: "toolRequest", text: prompt }],
    [{ type: "text", text: "Other task", metadata: prompt }],
    [{ text: prompt }],
  ]) {
    expect(() => decodeGooseConversation({ messages: [{ role: "user", content }, messages[1]] }, prompt)).toThrow("Session prompt mismatch");
  }
});

test("invalid conversations and non-text assistant blocks cannot establish collection", () => {
  for (const data of [null, {}, { messages: [] }, { messages: [{ role: "user", content: 1 }] }]) {
    expect(() => decodeGooseConversation(data, prompt)).toThrow("Unsupported/empty exported conversation");
  }
  for (const content of ["  ", [{ type: "toolRequest", text: "not assistant text" }]]) {
    expect(() => decodeGooseConversation({ messages: [messages[0], { role: "assistant", content }] }, prompt)).toThrow("Missing assistant output");
  }
});

test("Goose text-block separators are preserved in exact task attribution", () => {
  expect(() => decodeGooseConversation({ messages }, 'First line"quoted" \\ path')).toThrow("Session prompt mismatch");
});
