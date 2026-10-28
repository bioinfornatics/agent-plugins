/** Pure, whitelisted review projection. Descriptive verdicts are not causal diagnoses. */
import { createHash } from 'node:crypto';
const list = (v) => Array.isArray(v) ? v : [];
const record = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const text = (v) => typeof v === 'string' ? v : undefined;
const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const pick = (v, keys) => Object.fromEntries(keys.filter(k => scalar(record(v)[k])).map(k => [k, v[k]]));
const metric = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const short = (v) => v.length > 150 ? v.slice(0, 149) + '…' : v;
// Undefined statuses are permitted for legacy graded session rows, exactly as in analyzePairedValue.
const issue = (r) => !r || r.pending ? 'missing_execution' :
    r.grading_status !== undefined && !['complete', 'inconclusive'].includes(r.grading_status) ? 'missing_grades' :
        r.execution_status !== undefined && r.execution_status !== 'succeeded' ? 'missing_execution' : null;
const identity = (v, item) => v.eval_id === item.eval_id && v.run_number === item.run_number && v.criterion === item.criterion &&
    (v.configuration === undefined || [item.current, item.reference].some(s => s?.configuration === v.configuration));
export function buildSessionReviewModel(data, comparison) {
    data = record(data);
    comparison = record(comparison);
    const baseline = comparison.baseline === 'old_skill' ? 'old_skill' : 'without_skill';
    const runs = list(data.runs), pending = list(data.pending).map(r => ({ ...record(r), pending: true }));
    const findings = list(data.review_findings).map(value => {
        const f = record(value), out = pick(f, ['title', 'criterion', 'eval_id', 'run_number', 'configuration', 'evidence', 'rationale', 'status', 'verdict']);
        for (const [key, alias] of [['criterion', 'criterion_text'], ['eval_id', 'case_id'], ['run_number', 'repeat'], ['evidence', 'evidence_quote'], ['rationale', 'reason']])
            if (out[key] === undefined && scalar(f[alias]))
                out[key] = f[alias];
        if (out.configuration === undefined && typeof f.arm === 'string')
            out.configuration = f.arm === 'baseline' ? baseline : f.arm === 'with_targets' ? 'with_skill' : f.arm;
        return out;
    }).filter(f => Object.keys(f).length);
    const analyses = Array.isArray(data.review_analysis) ? data.review_analysis : list(record(data.review_analysis).items);
    const groups = new Map();
    for (const r of [...runs, ...pending]) {
        const key = JSON.stringify([r.eval_id, r.run_number]);
        groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const side = (r, c, index) => {
        if (!r)
            return null;
        const unavailable = issue(r) || !c;
        const out = { configuration: text(r.configuration), verdict: r.pending ? 'Pending' : unavailable ? 'Unavailable' : c.passed === true ? 'Pass' : c.passed === false ? 'Fail' : 'Inconclusive',
            evidence: text(c?.evidence) ?? null, rationale: text(c?.rationale) ?? null, grading_status: text(r.grading_status) ?? null,
            execution_status: text(r.execution_status) ?? null, status_reason: r.pending ? 'Pending' : r.grading_status === 'absent' ? 'Grading unavailable' : r.grading_status !== undefined && !['complete', 'inconclusive'].includes(r.grading_status) ? 'Unknown grading status: ' + String(r.grading_status) : r.execution_status !== undefined && r.execution_status !== 'succeeded' ? 'Execution not succeeded' : null, time_seconds: metric(record(r.result).time_seconds), tokens: metric(record(r.result).tokens) };
        if (typeof r.prompt === 'string')
            out.prompt = r.prompt;
        const previews = list(data.response_previews).filter(p => p?.eval_id === r.eval_id && p?.run_number === r.run_number && p?.configuration === r.configuration);
        const preview = r.response_preview !== undefined ? r.response_preview : previews.length === 1 ? previews[0] : undefined;
        if (typeof preview === 'string')
            out.response = preview;
        else if (preview && typeof preview === 'object') {
            const response = text(preview.response_preview) ?? text(preview.response) ?? text(preview.text);
            if (response !== undefined)
                out.response = response;
            if (typeof preview.response_truncated === 'boolean')
                out.response_truncated = preview.response_truncated;
            else if (typeof preview.truncated === 'boolean')
                out.response_truncated = preview.truncated;
        }
        if (typeof r.response_truncated === 'boolean' && out.response !== undefined)
            out.response_truncated = r.response_truncated;
        const rowIndex = runs.indexOf(r);
        if (rowIndex >= 0)
            out.evidence_anchor = 'evidence-' + rowIndex + (c ? '-criterion-' + index : '');
        return out;
    };
    const items = [];
    const add = (group, a, b, ca, cb, index, outcome, tag) => {
        const seed = group[0];
        const criterion = text(ca?.text) ?? text(cb?.text) ?? 'Grading unavailable';
        const item = { id: 'review-' + createHash('sha256').update(JSON.stringify([seed.eval_id, seed.run_number, criterion, tag])).digest('hex').slice(0, 24),
            eval_id: scalar(seed.eval_id) ? seed.eval_id : null, run_number: scalar(seed.run_number) ? seed.run_number : null, criterion,
            scenario: text(a?.prompt) ?? text(b?.prompt) ?? text(a?.eval_name) ?? text(b?.eval_name) ?? null, outcome, current: side(a, ca, index), reference: side(b, cb, index) };
        item.anchors = [item.current?.evidence_anchor, item.reference?.evidence_anchor].filter(Boolean);
        const reported = [ca, cb].filter(c => c && typeof c.passed !== 'boolean').map(c => text(c.rationale)).filter(Boolean);
        if (outcome === 'undecidable') {
            const generic = reported.some(r => /(?:no|missing|insufficient|lack of|not enough|not (?:provided|available|established)).*(?:evidence|information)|(?:evidence|information).*(?:missing|unavailable|insufficient|not (?:provided|established))/i.test(r));
            item.reason = { category: generic ? 'evidence_not_established' : 'undecidable', summary: 'Cause not diagnosed' + (reported.length ? '. Grader-reported reason: ' + short(reported.join('; ')) : '.'),
                next_action: 'Review retained evidence and request clarification of the indeterminate grade.', source: reported.length ? 'grader_reported' : 'observed_verdict' };
        }
        else if (outcome === 'unavailable') {
            const category = [a, b].some(r => !r || r.pending || r.execution_status !== undefined && r.execution_status !== 'succeeded') ? 'missing_execution' : issue(a) ?? issue(b) ?? 'missing_grades';
            item.reason = { category, summary: 'Comparison unavailable: execution or grading evidence is missing or unusable. Cause not diagnosed.', next_action: category === 'missing_execution' ? 'Check the missing or unsuccessful execution slot.' : 'Obtain usable grading for the retained execution.', source: 'observed_status' };
        }
        else if (outcome === 'noncomparable')
            item.reason = { category: 'noncomparable', summary: 'Duplicate slots or different criterion lists prevent a matched quality comparison.', next_action: 'Resolve duplicate slots or reconcile exact criterion identities before comparing.', source: 'observed_structure' };
        else
            item.reason = { category: outcome, summary: { gain: 'Current passes; reference fails.', regression: 'Current fails; reference passes.', both_pass: 'Both sides pass this criterion.', both_fail: 'Both sides fail this criterion; this is a shared observed gap.' }[outcome], next_action: 'Inspect the retained criterion evidence; these verdicts do not identify a cause.', source: 'observed_verdict' };
        item.review_findings = [];
        const matches = analyses.filter((v) => identity(record(v), item));
        if (matches.length === 1) {
            const source = record(matches[0].analysis ?? matches[0]);
            item.analysis = { ...pick(source, ['category', 'explanation', 'next_action', 'hypothesis', 'proposed_change', 'confidence']), confirmation_state: 'unconfirmed' };
            if (typeof source.missing_evidence === 'string')
                item.analysis.missing_evidence = source.missing_evidence;
            else if (Array.isArray(source.missing_evidence))
                item.analysis.missing_evidence = source.missing_evidence.filter((s) => typeof s === 'string');
            if (source.instruction && typeof source.instruction === 'object')
                item.analysis.instruction = pick(source.instruction, ['locator', 'source_sha256', 'excerpt']);
        }
        items.push(item);
    };
    for (const group of groups.values()) {
        const current = group.filter(r => r.configuration === 'with_skill'), reference = group.filter(r => r.configuration === baseline);
        const a = current[0], b = reference[0], ca = list(a?.expectations), cb = list(b?.expectations);
        const duplicate = current.length > 1 || reference.length > 1;
        const unavailable = !a || !b || issue(a) || issue(b) || !ca.length || !cb.length;
        const mismatch = JSON.stringify(ca.map(c => c.text)) !== JSON.stringify(cb.map(c => c.text));
        if (duplicate || (!unavailable && mismatch)) {
            for (const [arm, rows] of [['current', current], ['reference', reference]])
                rows.forEach((r, occurrence) => {
                    const cs = list(r.expectations);
                    (cs.length ? cs : [null]).forEach((c, i) => add(group, arm === 'current' ? r : null, arm === 'reference' ? r : null, arm === 'current' ? c : null, arm === 'reference' ? c : null, i, 'noncomparable', [arm, occurrence, i]));
                });
        }
        else if (unavailable) {
            if (!ca.length && !cb.length)
                add(group, a, b, null, null, 0, 'unavailable', ['missing']);
            else if (!mismatch)
                ca.forEach((c, i) => add(group, a, b, c, cb[i], i, 'unavailable', ['matched', i]));
            else {
                for (const [arm, cs] of [['current', ca], ['reference', cb]])
                    cs.forEach((c, i) => add(group, arm === 'current' ? a : null, arm === 'reference' ? b : null, arm === 'current' ? c : null, arm === 'reference' ? c : null, i, 'unavailable', [arm, i]));
            }
        }
        else
            ca.forEach((c, i) => {
                const x = c.passed, y = cb[i].passed;
                const outcome = typeof x !== 'boolean' || typeof y !== 'boolean' ? 'undecidable' : x && !y ? 'gain' : !x && y ? 'regression' : x ? 'both_pass' : 'both_fail';
                add(group, a, b, c, cb[i], i, outcome, ['matched', i]);
            });
    }
    // Only a unique exact target can be attached; broad aliases stay unlinked.
    for (const f of findings) {
        if (typeof f.criterion !== 'string')
            continue;
        const matches = items.filter(item => f.criterion === item.criterion && (f.eval_id === undefined || f.eval_id === item.eval_id) && (f.run_number === undefined || f.run_number === item.run_number) && (f.configuration === undefined || [item.current, item.reference].some(s => s?.configuration === f.configuration)));
        if (matches.length === 1)
            matches[0].review_findings.push(f);
    }
    // Unmatched supplied disputes remain actionable without guessing a criterion identity.
    for (const f of findings.filter(f => typeof f.criterion === 'string' && !items.some(item => item.review_findings.includes(f)))) {
        items.push({ id: 'review-note-' + createHash('sha256').update(JSON.stringify(f)).digest('hex').slice(0, 24), eval_id: f.eval_id ?? null, run_number: f.run_number ?? null, scenario: f.title ?? 'Supplied review', criterion: f.criterion, outcome: 'review_only', current: null, reference: null, review_findings: [f], anchors: [], reason: { category: 'unmatched_review', summary: 'Supplied dispute is not linked to an exact graded criterion. Original scores are unchanged.', next_action: 'Match this supplied review to the exact case, repetition and criterion before adjudication.', source: 'reviewer_supplied' } });
    }
    const context = pick(data.metadata, ['runs_per_query', 'model', 'provider', 'hypothesis', 'execution_summary', 'grading_summary', 'render_provenance']);
    for (const key of ['selected_targets', 'requested_skills', 'requested_plugins', 'requested_plugin_paths'])
        if (Array.isArray(record(data.metadata)[key]))
            context[key] = data.metadata[key].filter((v) => typeof v === 'string');
    const stats = (v) => pick(v, ['pairs', 'mean_delta', 'stddev']);
    const safeComparison = { baseline, ...pick(comparison, ['complete_pairs', 'incomplete_pairs']), criteria: pick(comparison.criteria, ['gains', 'regressions', 'both_pass', 'both_fail', 'undecidable']),
        coverage: pick(comparison.coverage, ['total_groups', 'conclusive', 'with_indeterminate_criteria', 'missing_or_ungraded', 'noncomparable']),
        metrics: { quality: stats(comparison.metrics?.quality), seconds: stats(comparison.metrics?.seconds), tokens: stats(comparison.metrics?.tokens) } };
    const namespaces = [...new Set(list(context.selected_targets).filter((name) => typeof name === 'string' && name.includes(':')).map((name) => name.split(':')[0]))];
    return { schema_version: 'guided-evaluation-review-v1', title: (text(data.skill_name) ?? (namespaces.length === 1 ? namespaces[0] : 'Selected capability')) + ' — Evaluation review',
        status: typeof data.status === 'string' ? data.status : comparison.incomplete_pairs || !comparison.complete_pairs ? 'incomplete' : 'complete', context, comparison: safeComparison, items, review_findings: findings };
}
