import test from "node:test";
import assert from "node:assert/strict";
import { GooseTelemetryObserver, gooseTelemetrySource, observeGooseTelemetry } from "../../src/adapters/outbound/hosts/goose/goose-telemetry.ts";

const message = JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
// Shape observed in a Goose 1.57.0 stream-json archive (campaign e079faf1).
const complete = { type: "complete", total_tokens: 59630, input_tokens: 57664, output_tokens: 1966, cache_read_input_tokens: 49006, cache_write_input_tokens: 8631, cost_usd: 0.0461921 };
const stream = (...lines: unknown[]) => `${lines.map(line => typeof line === "string" ? line : JSON.stringify(line)).join("\n")}\n`;

test("Goose telemetry trusts only one final complete event and never zero-fills unavailable values (ap-x8p7.2)", () => {
  assert.deepEqual(observeGooseTelemetry(stream(message, complete)), { source: gooseTelemetrySource,
    tokens: { total: 59630, input: 57664, output: 1966, cacheRead: 49006, cacheWrite: 8631 }, costUsd: 0.0461921 });
  const cases: [string, string, unknown][] = [
    ["interrupted session without completion", stream(message), undefined],
    ["completion followed by more output is not a session total", stream(complete, message), undefined],
    ["repeated completion is ambiguous", stream(complete, complete), undefined],
    ["unparseable trailing line", `${stream(message, complete)}{broken`, undefined],
    ["missing cache counters stay null", stream({ ...complete, cache_read_input_tokens: undefined, cache_write_input_tokens: null }),
      { source: gooseTelemetrySource, tokens: { total: 59630, input: 57664, output: 1966, cacheRead: null, cacheWrite: null }, costUsd: 0.0461921 }],
    ["negative token total is unavailable, cost kept", stream({ ...complete, total_tokens: -1 }), { source: gooseTelemetrySource, tokens: null, costUsd: 0.0461921 }],
    ["absent cost stays null", stream({ ...complete, cost_usd: null }), { source: gooseTelemetrySource, tokens: { total: 59630, input: 57664, output: 1966, cacheRead: 49006, cacheWrite: 8631 }, costUsd: null }],
    ["no usable value at all", stream({ type: "complete", total_tokens: "many", cost_usd: "free" }), undefined],
  ];
  for (const [name, input, expected] of cases) assert.deepEqual(observeGooseTelemetry(input), expected, name);
});

test("Goose telemetry observer reads only the Goose stream artifact of Goose attempts", () => {
  const observer = new GooseTelemetryObserver(), content = new TextEncoder().encode(stream(message, complete));
  assert.equal(observer.observe({ agent: "goose", artifacts: [{ path: "goose/stream.jsonl", content }] })?.tokens?.total, 59630);
  assert.equal(observer.observe({ agent: "other", artifacts: [{ path: "goose/stream.jsonl", content }] }), undefined);
  assert.equal(observer.observe({ agent: "goose", artifacts: [{ path: "goose/conversation.json", content }] }), undefined);
  assert.equal(observer.observe({ agent: "goose", artifacts: [{ path: "goose/stream.jsonl", content: new Uint8Array([0xff, 0xfe]) }] }), undefined);
});
