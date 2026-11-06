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


test("repeating an exact user task still requires new assistant evidence after its latest occurrence", () => {
  assert.throws(() => decodeGooseConversation({ messages: [...messages, messages[0]] }, prompt), /Missing assistant output/);
  const repeated = [...messages, messages[0], { role: "assistant", content: [{ type: "toolRequest", id: "call" }] }];
  assert.throws(() => decodeGooseConversation({ messages: repeated }, prompt), /Missing assistant output/);
});

// Goose 1.57.0 exports tool results and marked per-turn context as role=user.
// This envelope mirrors the retained MVP write result, not an authored follow-up.
test("native user-role tool results and marked turn context do not replace the latest authored task", () => {
  const toolResult = { role: "user", content: [{ type: "toolResponse", id: "call-write", toolResult: { status: "success", value: { content: [{ type: "text", text: "Created result.json" }], isError: false } } }] };
  const turnContext = { role: "user", content: [{ type: "text", text: "<turn-context>runtime context</turn-context>" }], metadata: { userVisible: false, agentVisible: true, turnContext: true } };
  const nativeMessages = [messages[0], turnContext, { role: "assistant", content: [{ type: "toolRequest", id: "call-write" }] }, toolResult, turnContext, messages[1]];
  assert.deepEqual(decodeGooseConversation({ conversation: nativeMessages }, prompt), { messages: nativeMessages });
  assert.throws(() => decodeGooseConversation({ conversation: [...nativeMessages, { role: "user", content: "different task" }, toolResult, turnContext, messages[1]] }, prompt), /Session prompt mismatch/);
  assert.throws(() => decodeGooseConversation({ conversation: [...nativeMessages, messages[0], toolResult, turnContext] }, prompt), /Missing assistant output/);
});
