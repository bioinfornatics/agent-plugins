import test from 'node:test';
import assert from 'node:assert/strict';
// Verify emitted code after the standard creator build.
import { buildSessionReviewModel } from '../dist/scripts/session_review_model.js';
import { analyzePairedValue } from '../dist/scripts/evaluation_report.js';
const c = (text: string, passed: boolean | null, rationale = 'Retained judgment') => ({text, passed, evidence: 'Exact quote', rationale});
const row = (configuration: string, expectations: any[] = [c('criterion', true)], extra: any = {}) => ({eval_id: 0, run_number: 1, configuration, expectations, ...extra});
const build = (runs: any[], extra: any = {}) => {
 const data = {runs, pending: [], ...extra};
 return buildSessionReviewModel(data, analyzePairedValue(data.runs, data.pending));
};
test('matched criterion outcomes and statistics agree with analyzer, without mutation', () => {
 const runs = [row('with_skill', [c('gain', true), c('regression', false), c('pass', true), c('gap', false), c('unknown', null)]), row('without_skill', [c('gain', false), c('regression', true), c('pass', true), c('gap', false), c('unknown', false)])];
 const data = {runs, pending: [], skill_name: 'writer'}, comparison = analyzePairedValue(runs, []);
 const before = JSON.stringify({data, comparison});
 const model = buildSessionReviewModel(data, comparison);
 assert.deepEqual(model.items.map((i: any) => i.outcome), ['gain', 'regression', 'both_pass', 'both_fail', 'undecidable']);
 assert.deepEqual(model.comparison, comparison);
 assert.equal(model.schema_version, 'guided-evaluation-review-v1');
 assert.equal(model.status, 'incomplete');
 assert.equal(JSON.stringify({data, comparison}), before);
 assert.deepEqual(model.items[1].anchors, ['evidence-0-criterion-1', 'evidence-1-criterion-1']);
 assert.match(model.items[4].reason.summary, /^Cause not diagnosed.*Grader-reported reason:/);
});
test('complete and inconclusive statuses preserve booleans and nulls; unusable grades never pass', () => {
 for (const grading_status of [undefined, 'complete', 'inconclusive']) {
  const m = build([row('with_skill', [c('criterion', true)], {grading_status}), row('without_skill', [c('criterion', false)])]);
  assert.equal(m.items[0].outcome, 'gain');
 }
 for (const extra of [{grading_status: 'absent'}, {grading_status: 'unknown'}, {grading_status: 'failure'}, {execution_status: 'failed'}, {execution_status: 'unavailable'}, {execution_status: 'unknown'}]) {
  const m = build([row('with_skill', [c('criterion', true)], extra), row('without_skill')]);
  assert.equal(m.items[0].outcome, 'unavailable');
  assert.equal(m.items[0].current.verdict, 'Unavailable');
  assert.equal(m.comparison.criteria.both_pass, 0);
 }
});
test('missing both grades yields one unavailable item and pending slots are not graded', () => {
 assert.equal(build([row('with_skill', []), row('without_skill', [])]).items.length, 1);
 const m = build([], {pending: [{eval_id: 9, run_number: 1, configuration: 'with_skill'}, {eval_id: 9, run_number: 1, configuration: 'without_skill'}]});
 assert.equal(m.items.length, 1);
 assert.equal(m.items[0].outcome, 'unavailable');
 assert.equal(m.items[0].reason.category, 'missing_execution');
 assert.equal(build([row('with_skill')]).items[0].outcome, 'unavailable');
});
test('mismatches, ordering differences, and duplicate slots never produce matched deltas', () => {
 const cases = [
  [row('with_skill', [c('a', true)]), row('without_skill', [c('b', false)])],
  [row('with_skill', [c('a', true), c('b', true)]), row('without_skill', [c('b', false), c('a', false)])],
  [row('with_skill'), row('with_skill'), row('without_skill')]
 ];
 for (const runs of cases) {
  const m = build(runs);
  assert.ok(m.items.every((i: any) => i.outcome === 'noncomparable'));
  assert.equal(m.comparison.metrics.quality.pairs, 0);
  assert.equal(new Set(m.items.map((i: any) => i.id)).size, m.items.length);
 }
 // Analyzer prioritizes missing/unusable evidence before criterion-list mismatch.
 const m = build([row('with_skill', [c('a', true)], {grading_status: 'absent'}), row('without_skill', [c('b', false)])]);
 assert.ok(m.items.every((i: any) => i.outcome === 'unavailable'));
});
test('reference selection, stable safe IDs, and exact case/run identity', () => {
 const runs = [row('with_skill', [c('<unsafe criterion>', true)], {eval_id: '<case>'}), row('old_skill', [c('<unsafe criterion>', false)], {eval_id: '<case>'}), row('without_skill', [c('ignored', true)], {eval_id: '<case>'})];
 const a = build(runs), b = build([...runs].reverse());
 assert.equal(a.comparison.baseline, 'old_skill');
 assert.equal(a.items.length, 1);
 assert.equal(a.items[0].reference.configuration, 'old_skill');
 assert.equal(a.items[0].id, b.items[0].id);
 assert.match(a.items[0].id, /^review-[a-f0-9]{24}$/);
 assert.equal(build([row('with_skill'), row('without_skill', undefined, {eval_id: '0'})]).items.length, 2);
});
test('whitelists context, comparisons, analysis, and retained sides; no raw responses', () => {
 const runs = [row('with_skill', [c('criterion', true)], {prompt: 'Supplied prompt', response: 'RAW_SECRET', output: 'OUTPUT_SECRET', secret: 'SIDE_SECRET', result: {tokens: 20, time_seconds: 2, secret: 'METRIC_SECRET'}}), row('without_skill', [c('criterion', false)])];
 const data = {runs, metadata: {model: 'model', selected_targets: ['writer', {secret: 'LIST_SECRET'}], api_key: 'META_SECRET'}, response_previews: [{eval_id: 0, run_number: 2, configuration: 'with_skill', response: 'WRONG_SLOT_SECRET'}, {eval_id: 0, run_number: 1, configuration: 'with_skill', response: 'Retained preview', response_truncated: true, secret: 'PREVIEW_SECRET'}]};
 const comparison = {...analyzePairedValue(runs, []), secret: 'COMPARISON_SECRET'};
 const m = buildSessionReviewModel(data, comparison), serialized = JSON.stringify(m);
 assert.doesNotMatch(serialized, /SECRET/);
 assert.equal(m.items[0].current.response, 'Retained preview');
 assert.equal(m.items[0].current.response_truncated, true);
 assert.equal(m.items[0].current.prompt, 'Supplied prompt');
 assert.equal(m.items[0].current.tokens, 20);
 assert.equal(m.items[0].reference.response, undefined);
 assert.deepEqual(m.context.selected_targets, ['writer']);
 const direct = build([row('with_skill', undefined, {response_preview: 'Explicit preview', response: 'RAW_SECRET'}), row('without_skill')]);
 assert.equal(direct.items[0].current.response, 'Explicit preview');
 assert.doesNotMatch(JSON.stringify(direct), /RAW_SECRET/);
});
test('ambiguous response-preview slots are not read', () => {
 const preview = {eval_id: 0, run_number: 1, configuration: 'with_skill', response: 'Ambiguous'};
 const m = build([row('with_skill'), row('without_skill')], {response_previews: [preview, preview]});
 assert.equal(m.items[0].current.response, undefined);
});
test('findings require an exact criterion; campaign limitations are not case disputes', () => {
 const m = build([row('with_skill'), row('without_skill')], {review_findings: [
  {title: 'Campaign limitation', eval_id: 0, rationale: 'No provider proof'},
  {criterion_text: 'criterion', case_id: 0, repeat: 1, arm: 'with_targets', evidence_quote: 'quote', reason: 'disputed'},
  {criterion: 'criterion', eval_id: 0, run_number: 2},
  {criterion: 'Criterion'},
  {criterion: 'criterion', configuration: 'old_skill'},
  {criterion: 'criterion', secret: 'FINDING_SECRET'}
 ]});
 assert.equal(m.review_findings.length, 6);
 assert.equal(m.items[0].review_findings.length, 2);
 assert.equal(m.items[0].review_findings[0].configuration, 'with_skill');
 assert.doesNotMatch(JSON.stringify(m), /FINDING_SECRET/);
});
test('null grades use brief grader-reported wording, never invent a responsible instruction', () => {
 const m = build([row('with_skill', [c('criterion', null, 'Insufficient evidence ' + 'x'.repeat(500))]), row('without_skill')]);
 const item = m.items[0];
 assert.equal(item.reason.category, 'evidence_not_established');
 assert.equal(item.reason.source, 'grader_reported');
 assert.match(item.reason.summary, /^Cause not diagnosed/);
 assert.ok(item.reason.summary.length < 205);
 assert.equal(item.analysis, undefined);
 assert.equal(item.current.rationale.length, 522);
 assert.equal(build([row('with_skill', [c('criterion', null, '')]), row('without_skill')]).items[0].reason.summary, 'Cause not diagnosed.');
});
test('supplied analysis attaches only exact identity, stays unconfirmed, and whitelists nested fields', () => {
 const analysis = {eval_id: 0, run_number: 1, criterion: 'criterion', configuration: 'with_skill', category: 'hypothesis', explanation: 'Supplied explanation', missing_evidence: ['trace', {secret: 'EVIDENCE_SECRET'}], instruction: {locator: 'SKILL.md:4', source_sha256: 'abc', excerpt: 'Supplied instruction', secret: 'INSTRUCTION_SECRET'}, hypothesis: 'Supplied hypothesis', proposed_change: 'Supplied proposal', confidence: 'low', confirmation_state: 'confirmed', secret: 'ANALYSIS_SECRET'};
 const m = build([row('with_skill'), row('without_skill')], {review_analysis: [analysis]});
 assert.equal(m.items[0].analysis.confirmation_state, 'unconfirmed');
 assert.equal(m.items[0].analysis.instruction.locator, 'SKILL.md:4');
 assert.deepEqual(m.items[0].analysis.missing_evidence, ['trace']);
 assert.doesNotMatch(JSON.stringify(m), /SECRET/);
 for (const extra of [{eval_id: '0'}, {run_number: 2}, {criterion: 'Criterion'}, {configuration: 'old_skill'}, {eval_id: undefined}]) {
  assert.equal(build([row('with_skill'), row('without_skill')], {review_analysis: [{...analysis, ...extra}]}).items[0].analysis, undefined);
 }
 assert.equal(build([row('with_skill'), row('without_skill')], {review_analysis: [analysis, analysis]}).items[0].analysis, undefined);
});

test('unmatched supplied disputes are review-only items, not new scores or guessed mappings',()=>{const m=build([row('with_skill'),row('without_skill')],{review_findings:[{title:'case17',criterion:'Short alias',rationale:'Disputed'}]});assert.equal(m.items.length,2);assert.equal(m.items[1].outcome,'review_only');assert.match(m.items[1].reason.summary,/not linked to an exact/);assert.equal(m.comparison.criteria.both_pass,1);assert.equal(m.items[1].current,null);});
test('criterion-only review cannot attach to multiple cases by guessing identity',()=>{const runs=[row('with_skill'),row('without_skill'),row('with_skill',undefined,{eval_id:1}),row('without_skill',undefined,{eval_id:1})];const m=build(runs,{review_findings:[{criterion:'criterion',rationale:'Review'}]});assert.equal(m.items.filter((i:any)=>i.outcome!=='review_only').flatMap((i:any)=>i.review_findings).length,0);assert.equal(m.items.filter((i:any)=>i.outcome==='review_only').length,1);});
