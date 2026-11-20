import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateActivationCases, classifyTrialOutcome, validateActivationCases, type ActivationOutcome } from "../../src/domain/activation-trial.ts";
import type { ActivationClass, ActivationObservation } from "../../src/domain/activation.ts";

const observation: ActivationObservation = { version: 1, scan: "complete", loaded: [], failedLoads: [], resourceLoads: [], fileReads: [], fileProbes: [], unresolved: 0 };
const ok = { status: "completed", exitCode: 0, collection: "complete" };

test("outcome mapping: technical precedes the oracle; only triggered/not-triggered are decisive", () => {
  const assessed = (cls: ActivationClass) => ({ class: cls, observation });
  const table: [Parameters<typeof classifyTrialOutcome>[0], ActivationOutcome][] = [
    [{ finalized: true, receipt: ok, assessment: assessed("triggered") }, "triggered"],
    [{ finalized: true, receipt: ok, assessment: assessed("not-triggered") }, "not-triggered"],
    [{ finalized: true, receipt: ok, assessment: assessed("direct-read") }, "inconclusive"],
    [{ finalized: true, receipt: ok, assessment: assessed("attempted-failed") }, "inconclusive"],
    [{ finalized: true, receipt: ok, assessment: assessed("inconclusive") }, "inconclusive"],
    [{ finalized: true, receipt: ok }, "inconclusive"],
    [{ finalized: false, assessment: assessed("triggered") }, "technical"],
    [{ finalized: true, receipt: { ...ok, status: "timeout", exitCode: null }, assessment: assessed("triggered") }, "technical"],
    [{ finalized: true, receipt: { ...ok, status: "nonzero", exitCode: 1 }, assessment: assessed("not-triggered") }, "technical"],
    [{ finalized: true, receipt: { ...ok, exitCode: 2 }, assessment: assessed("triggered") }, "technical"],
    [{ finalized: true, receipt: { ...ok, collection: "partial" }, assessment: assessed("not-triggered") }, "technical"],
  ];
  for (const [input, expected] of table) assert.equal(classifyTrialOutcome(input), expected, JSON.stringify(input));
});

test("aggregation: 0.5 threshold, unresolved cases fail outside tp/fp/tn/fn, empty denominators are null", () => {
  const cases = [
    { id: "a", shouldTrigger: true, skill: "s" }, { id: "b", shouldTrigger: true, skill: "s" },
    { id: "c", shouldTrigger: false, skill: "s" }, { id: "d", shouldTrigger: false, skill: "s" },
    { id: "e", shouldTrigger: true, skill: "s" }, { id: "f", shouldTrigger: false, skill: "s" },
  ];
  const outcomes = new Map<string, ActivationOutcome[]>([
    ["a", ["triggered", "not-triggered"]], // rate 0.5 >= 0.5: pass
    ["b", ["not-triggered", "not-triggered", "triggered"]], // 1/3: fn
    ["c", ["triggered", "not-triggered"]], // 0.5 is not < 0.5: fp
    ["d", ["not-triggered"]], // tn
    ["e", ["triggered", "inconclusive"]], // unresolved despite a decisive majority
    ["f", ["technical"]], // no decisive run: null rate
  ]);
  const { cases: results, summary } = aggregateActivationCases(cases, outcomes);
  assert.deepEqual(results.map(r => [r.id, r.triggerRate, r.pass, r.unresolved]), [
    ["a", 0.5, true, false], ["b", 1 / 3, false, false], ["c", 0.5, false, false],
    ["d", 0, true, false], ["e", 1, false, true], ["f", null, false, true],
  ]);
  assert.deepEqual(summary, { tp: 1, fp: 1, tn: 1, fn: 1, unresolved: 2, precision: 0.5, recall: 0.5 });
  assert.deepEqual(aggregateActivationCases([{ id: "x", shouldTrigger: false, skill: "s" }], new Map()).summary,
    { tp: 0, fp: 0, tn: 0, fn: 0, unresolved: 1, precision: null, recall: null });
});

test("case validation accepts both shapes and refuses ambiguous suites", () => {
  assert.deepEqual(validateActivationCases([{ query: "first", should_trigger: true }, { query: "second", should_trigger: false }], ["alpha"]), [
    { id: "1", query: "first", shouldTrigger: true, skill: "alpha" }, { id: "2", query: "second", shouldTrigger: false, skill: "alpha" }]);
  assert.deepEqual(validateActivationCases({ cases: [{ id: "q", query: "go", should_trigger: true, skill: "beta" }] }, ["alpha", "beta"]),
    [{ id: "q", query: "go", shouldTrigger: true, skill: "beta" }]);
  const refusals: [unknown, string[], RegExp][] = [
    [{ cases: [] }, ["alpha"], /at least one case/],
    [[], ["alpha"], /at least one case/],
    [{ cases: [{ id: "a", query: "x", should_trigger: true }, { id: "a", query: "y", should_trigger: true }] }, ["alpha"], /duplicate id a/],
    [{ cases: [{ id: "a", query: " Make  a PLAN ", should_trigger: true }, { id: "b", query: "make a plan", should_trigger: false }] }, ["alpha"], /duplicate normalized query in cases a and b/],
    [{ cases: [{ id: "a", query: "x", should_trigger: true }] }, ["alpha", "beta"], /skill is required/],
    [{ cases: [{ id: "a", query: "x", should_trigger: true, skill: "gamma" }] }, ["alpha", "beta"], /must name a profile Skill/],
    [{ cases: [{ id: "a", query: "   ", should_trigger: true }] }, ["alpha"], /query must be a nonempty string/],
    [{ cases: [{ id: "a", query: "x", should_trigger: "yes" }] }, ["alpha"], /should_trigger must be a boolean/],
    [{ cases: [{ id: "../a", query: "x", should_trigger: true }] }, ["alpha"], /id must match/],
    [{ cases: [{ id: "a", query: "x", should_trigger: true, expected: 1 }] }, ["alpha"], /unsupported fields: expected/],
    [{ cases: [], eval_set: [] }, ["alpha"], /unsupported fields: eval_set/],
    [[{ id: "a", query: "x", should_trigger: true }], ["alpha"], /unsupported fields: id/],
  ];
  for (const [document, skills, expected] of refusals) assert.throws(() => validateActivationCases(document, skills), expected, JSON.stringify(document));
});
