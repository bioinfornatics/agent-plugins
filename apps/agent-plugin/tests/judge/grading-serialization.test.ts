import assert from "node:assert/strict";
import { test } from "node:test";
import { gradingJsonLimits, parseGradingJson, serializeGradingJson } from "../../src/adapters/outbound/storage/grading-serialization.ts";

test("each persisted grading JSON field has an explicit shared reader/writer ceiling", () => {
  const mib = 1024 * 1024;
  assert.deepEqual(gradingJsonLimits, { plan: 128 * mib, snapshot: 128 * mib, receipt: 8 * mib,
    request: 384 * mib, criteria: 8 * mib, manifest: 8 * mib, outcome: 16 * mib, provenance: 16 * mib, evidence: 16 * mib });
  for (const field of Object.keys(gradingJsonLimits) as (keyof typeof gradingJsonLimits)[]) {
    const value = { text: 'é"\n\\', nested: ["中"] };
    const encoded = serializeGradingJson(value, field);
    assert.equal(encoded, JSON.stringify(value), "digest canonicalization must not change");
    assert.deepEqual(parseGradingJson(encoded, field), value);
  }
});

test("criteria and citation evidence limits measure encoded UTF-8, including escaping expansion", () => {
  const criterion = "é".repeat((8 * 1024 * 1024 - 2) / 2);
  const encoded = serializeGradingJson(criterion, "criteria");
  assert.equal(Buffer.byteLength(encoded), 8 * 1024 * 1024);
  assert.equal(parseGradingJson(encoded, "criteria"), criterion);
  assert.throws(() => serializeGradingJson(`${criterion}x`, "criteria"), /criteria exceeds JSON byte bound/);
  assert.throws(() => parseGradingJson(JSON.stringify(`${criterion}x`), "criteria"), /criteria exceeds JSON byte bound/);
  const citations = [{ path: "answer.txt", sha256: "a".repeat(64), quote: '"'.repeat(8 * 1024 * 1024) }];
  assert.ok(citations[0] && citations[0].quote.length < gradingJsonLimits.evidence);
  assert.throws(() => serializeGradingJson(citations, "evidence"), /evidence exceeds JSON byte bound/);
  assert.throws(() => parseGradingJson(JSON.stringify(citations), "evidence"), /evidence exceeds JSON byte bound/);
});
