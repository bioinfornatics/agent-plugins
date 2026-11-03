import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeGooseConversation } from "../../src/adapters/outbound/hosts/goose/goose-conversation.ts";

const prompt = 'First line\n"quoted" \\ path';
const messages = [
  { role: "user", content: [{ type: "text", text: 'First line' }, { type: "text", text: '"quoted" \\ path' }] },
  { role: "assistant", content: [{ type: "text", text: "Result" }] },
];

test("supported envelopes decode typed text blocks without normalizing task bytes", () => {
  for (const data of [{ messages }, { conversation: messages }, { conversation: { messages } }]) {
    assert.deepStrictEqual(decodeGooseConversation(data, prompt), { messages });
  }
});

test("non-text metadata and near-match prompts cannot establish task attribution", () => {
  for (const content of [
    ` ${prompt}`, `${prompt} suffix`,
    [{ type: "toolRequest", text: prompt }],
    [{ type: "text", text: "Other task", metadata: prompt }],
    [{ text: prompt }],
  ]) {
    assert.throws(() => decodeGooseConversation({ messages: [{ role: "user", content }, messages[1]] }, prompt), /Session prompt mismatch/);
  }
});

test("invalid conversations and non-text assistant blocks cannot establish collection", () => {
  for (const data of [null, {}, { messages: [] }, { messages: [{ role: "user", content: 1 }] }]) {
    assert.throws(() => decodeGooseConversation(data, prompt), /Unsupported\/empty exported conversation/);
  }
  for (const content of ["  ", [{ type: "toolRequest", text: "not assistant text" }]]) {
    assert.throws(() => decodeGooseConversation({ messages: [messages[0], { role: "assistant", content }] }, prompt), /Missing assistant output/);
  }
});

test("Goose text-block separators are preserved in exact task attribution", () => {
  assert.throws(() => decodeGooseConversation({ messages }, 'First line"quoted" \\ path'), /Session prompt mismatch/);
});
