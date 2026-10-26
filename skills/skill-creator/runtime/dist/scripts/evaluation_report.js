/** Decision-oriented static session reports. Data stays untrusted; no acceptance receipt is inferred. */
const escape = (v) => String(v ?? "Unavailable").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const list = (v) => Array.isArray(v) ? v : [];
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
const badge = (label) => '<span class="badge ' + (label === "Pass" ? 'pass' : label === "Fail" ? 'fail' : 'unknown') + '">' + escape(label) + '</span>';
const metric = (v, percent = false) => typeof v === "number" && Number.isFinite(v) ? (percent ? (v * 100).toFixed(1) + '%' : String(v)) : 'Unavailable';
const verdict = (v) => v.passed === true ? 'Pass' : v.passed === false ? 'Fail' : v.passed === null ? 'Inconclusive' : 'Unavailable';
const cell = (v) => '<td>' + escape(v) + '</td>';
const table = (heads, rows, caption) => '<div class="table-wrap"><table><caption>' + escape(caption) + '</caption><thead><tr>' + heads.map(h => '<th scope="col">' + escape(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
function runState(row) {
    if (!row)
        return 'Unavailable';
    if (row.pending)
        return 'Pending';
    const criteria = list(row.expectations);
    return !criteria.length ? 'Unavailable' : criteria.some(c => c.passed === false) ? 'Fail' : criteria.some(c => c.passed === null) ? 'Inconclusive' : criteria.every(c => c.passed === true) ? 'Pass' : 'Unavailable';
}
/** Descriptive matched-pair analysis; not a statistical non-inferiority test. */
export function analyzePairedValue(rows, pending) {
    const baseline = rows.some(r => r.configuration === 'old_skill') || pending.some(r => r.configuration === 'old_skill') ? 'old_skill' : 'without_skill';
    const groups = new Map();
    for (const r of [...rows, ...pending.map(p => ({ ...p, pending: true }))]) {
        const key = JSON.stringify([r.eval_id, r.run_number]);
        groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const criteria = { gains: 0, regressions: 0, both_pass: 0, both_fail: 0, undecidable: 0 };
    let complete_pairs = 0, incomplete_pairs = 0;
    const observations = { quality: [], seconds: [], tokens: [] };
    for (const group of groups.values()) {
        const current = group.filter(r => r.configuration === 'with_skill'), reference = group.filter(r => r.configuration === baseline), a = current[0], b = reference[0], ca = list(a?.expectations), cb = list(b?.expectations);
        if (current.length !== 1 || reference.length !== 1 || a.pending || b.pending || !ca.length || JSON.stringify(ca.map(c => c.text)) !== JSON.stringify(cb.map(c => c.text))) {
            incomplete_pairs++;
            continue;
        }
        let unresolved = 0;
        for (let i = 0; i < ca.length; i++) {
            const x = ca[i].passed, y = cb[i].passed;
            if (typeof x !== 'boolean' || typeof y !== 'boolean') {
                criteria.undecidable++;
                unresolved++;
            }
            else if (x && !y)
                criteria.gains++;
            else if (!x && y)
                criteria.regressions++;
            else if (x)
                criteria.both_pass++;
            else
                criteria.both_fail++;
        }
        if (unresolved) {
            incomplete_pairs++;
        }
        else {
            complete_pairs++;
            observations.quality.push((ca.filter(c => c.passed).length - cb.filter(c => c.passed).length) / ca.length);
        }
        for (const [key, field] of [['seconds', 'time_seconds'], ['tokens', 'tokens']]) {
            const x = record(a.result)[field], y = record(b.result)[field];
            if (typeof x === 'number' && Number.isFinite(x) && x >= 0 && typeof y === 'number' && Number.isFinite(y) && y >= 0)
                observations[key].push(x - y);
        }
    }
    const statistics = (values) => { const n = values.length; if (!n)
        return { pairs: 0, mean_delta: null, stddev: null }; const mean = values.reduce((a, b) => a + b, 0) / n; return { pairs: n, mean_delta: mean, stddev: n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0 }; };
    return { baseline, complete_pairs, incomplete_pairs, criteria, metrics: { quality: statistics(observations.quality), seconds: statistics(observations.seconds), tokens: statistics(observations.tokens) } };
}
function valueHtml(rows, pending) {
    const v = analyzePairedValue(rows, pending), c = v.criteria;
    const conclusion = c.regressions ? 'Regressions observed — inspect before adoption' : v.incomplete_pairs ? 'Value comparison incomplete — observed gains do not resolve remaining pairs' : c.gains ? 'Value observed on the compared criteria' : v.complete_pairs ? 'No added quality observed on these trials' : 'Value comparison incomplete';
    const summary = [['Gains', c.gains], ['Regressions', c.regressions], ['Both pass', c.both_pass], ['Both fail', c.both_fail], ['Undecidable criteria', c.undecidable]];
    const metrics = [['Quality', v.metrics.quality, 'percentage points', 100]];
    const efficiency = [['Duration', v.metrics.seconds, 'seconds'], ['Tokens', v.metrics.tokens, 'tokens']];
    const efficiencyRows = efficiency.map(([label, s, unit]) => '<tr>' + cell(label) + cell(s.pairs) + cell(s.mean_delta === null ? 'Unavailable' : (s.mean_delta >= 0 ? '+' : '') + s.mean_delta.toFixed(2) + ' ' + unit) + cell(s.stddev === null ? 'Unavailable' : s.stddev.toFixed(2)) + '</tr>');
    const efficiencyHtml = '<details><summary>Efficiency telemetry (optional for quality)</summary>' + table(['Metric', 'Available pairs', 'Mean current − reference', 'Sample standard deviation'], efficiencyRows, 'Efficiency — lower duration or token use is cheaper, not proof of better quality') + '<p>Collect observed measurements during future runs. Unavailable telemetry does not invalidate graded quality; strict benchmark export may still await telemetry.</p></details>';
    const metricRows = metrics.map(([label, s, unit, scale]) => '<tr>' + cell(label) + cell(s.pairs) + cell(s.mean_delta === null ? 'Unavailable' : (s.mean_delta >= 0 ? '+' : '') + (s.mean_delta * scale).toFixed(2) + ' ' + unit) + cell(s.stddev === null ? 'Unavailable' : (s.stddev * scale).toFixed(2)) + '</tr>');
    return '<section aria-label="Skill value"><h2>Skill value versus ' + (v.baseline === 'old_skill' ? 'previous version' : 'no Skill') + '</h2><p><strong>' + conclusion + '</strong></p><p>' + v.complete_pairs + ' fully graded pairs; ' + v.incomplete_pairs + ' incomplete or non-comparable pairs.</p><p>' + (!v.incomplete_pairs && v.complete_pairs ? 'Quality comparison ready' : 'Quality comparison incomplete') + '</p><div class="cards">' + summary.map(([label, n]) => '<div class="card"><strong>' + n + '</strong><span>' + label + '</span></div>').join('') + '</div><p>Gain: current passes, reference fails. Regression: reference passes, current fails. Both fail is a shared gap, not value. Undecidable criteria are counted only where criterion identities match.</p>' + table(['Metric', 'Available pairs', 'Mean current − reference', 'Sample standard deviation'], metricRows, 'Paired quality — higher is better') + efficiencyHtml + '<p>No observed regression is not proof of general non-inferiority. Partial pairs cannot establish complete-suite quality; metric availability may differ. These are descriptive trials, not confidence bounds or authenticated causal uplift.</p></section>';
}
function pairedMatrix(rows, pending) {
    const groups = new Map(), ids = new Map();
    rows.forEach((row, i) => ids.set(row, 'evidence-' + i));
    for (const row of [...rows, ...pending.map(p => ({ ...p, pending: true }))]) {
        const key = JSON.stringify([row.eval_id, row.run_number]);
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const baseline = rows.some(r => r.configuration === 'old_skill') || pending.some(r => r.configuration === 'old_skill') ? 'old_skill' : 'without_skill';
    const baselineLabel = baseline === 'old_skill' ? 'Previous Skill' : 'Without Skill';
    const findings = [], matrix = [];
    const variant = (row) => !row ? badge('Unavailable') : row.pending ? badge('Pending') : badge(runState(row)) + '<br><small>' + list(row.expectations).filter(c => c.passed === true).length + ' / ' + list(row.expectations).length + ' criteria passed<br>' + escape(metric(record(row.result).time_seconds)) + ' seconds · ' + escape(metric(record(row.result).tokens)) + ' tokens</small><br><a href="#' + ids.get(row) + '">Criteria and evidence</a>';
    for (const group of groups.values()) {
        const currents = group.filter(r => r.configuration === 'with_skill'), refs = group.filter(r => r.configuration === baseline), a = currents[0], b = refs[0], first = a ?? b ?? group[0];
        const left = runState(a), right = runState(b), ca = list(a?.expectations), cb = list(b?.expectations);
        let comparison = 'Comparison incomplete';
        if (currents.length > 1 || refs.length > 1)
            comparison = 'Duplicate variant — comparison unavailable';
        else if (ca.length && cb.length && JSON.stringify(ca.map(c => c.text)) !== JSON.stringify(cb.map(c => c.text)))
            comparison = 'Criteria differ — not comparable';
        else if (!['Pending', 'Unavailable', 'Inconclusive'].includes(left) && !['Pending', 'Unavailable', 'Inconclusive'].includes(right) && ![...ca, ...cb].some(c => typeof c.passed !== 'boolean')) {
            if (left === 'Fail' && right === 'Pass')
                comparison = 'Current fails / reference passes';
            else if (left === 'Pass' && right === 'Fail')
                comparison = 'Current passes / reference fails';
            else
                comparison = left === 'Pass' ? 'Both pass' : 'Both fail';
            const different = ca.filter((c, i) => c.passed !== cb[i]?.passed).length;
            if (different)
                comparison += ' · ' + different + ' differing criterion(s)';
        }
        matrix.push('<tr>' + cell(first.eval_name ?? 'Scenario ' + first.eval_id) + cell(first.run_number) + '<td>' + variant(a) + '</td><td>' + variant(b) + '</td>' + cell(comparison) + '</tr>');
        for (const row of group.filter(r => !r.pending))
            for (const c of list(row.expectations).filter(c => c.passed === false || c.passed === null)) {
                const action = c.passed === false ? 'Inspect the observed failure; propose a targeted correction.' : 'Supply the missing evidence or seek qualified review; do not assume a verdict.';
                findings.push('<li><a href="#' + ids.get(row) + '">' + escape(row.eval_name ?? 'Scenario ' + row.eval_id) + ' · Run ' + escape(row.run_number) + ' · ' + escape(row.configuration) + '</a>: ' + badge(verdict(c)) + ' <strong>' + escape(c.text) + '</strong><br>' + escape(action) + '</li>');
            }
    }
    return { heads: ['Scenario', 'Run', 'Current Skill', baselineLabel, 'Observed comparison'], rows: matrix, findings };
}
export function sessionEvaluationHtml(mode, status, data) {
    const d = record(data), behavioral = mode === "Behavioral", rows = list(behavioral ? d.runs : d.results), pending = list(d.pending), name = d.skill_name ?? record(d.metadata).skill_name ?? mode;
    const counts = { passed: 0, failed: 0, inconclusive: 0, unavailable: 0 };
    const paired = behavioral ? pairedMatrix(rows, pending) : null;
    let scenarioRows = [], evidence = [];
    if (behavioral) {
        for (const [index, row] of rows.entries()) {
            const criteria = list(row.expectations);
            for (const c of criteria) {
                const key = verdict(c);
                if (key === 'Pass')
                    counts.passed++;
                else if (key === 'Fail')
                    counts.failed++;
                else if (key === 'Inconclusive')
                    counts.inconclusive++;
                else
                    counts.unavailable++;
            }
            if (!criteria.length)
                counts.unavailable++;
            const state = !criteria.length ? 'Unavailable' : criteria.some(c => c.passed === false) ? 'Fail' : criteria.some(c => c.passed === null) ? 'Inconclusive' : criteria.every(c => c.passed === true) ? 'Pass' : 'Unavailable';
            const r = record(row.result), id = 'evidence-' + index;
            scenarioRows.push('<tr>' + cell(row.eval_name ?? 'Scenario ' + row.eval_id) + cell(row.configuration) + cell(row.run_number) + '<td>' + badge(state) + '</td>' + cell(criteria.filter(c => c.passed === true).length + ' / ' + criteria.length) + cell(metric(r.time_seconds)) + cell(metric(r.tokens)) + '<td><a href="#' + id + '">Inspect</a></td></tr>');
            evidence.push('<details id="' + id + '"><summary>' + escape(row.eval_name ?? 'Scenario ' + row.eval_id) + ' · ' + escape(row.configuration) + ' · Run ' + escape(row.run_number) + ' — ' + state + '</summary>' + (row.prompt ? '<p><strong>Task:</strong> ' + escape(row.prompt) + '</p>' : '') + (criteria.length ? criteria.map(c => '<article class="criterion">' + badge(verdict(c)) + ' <strong>' + escape(c.text) + '</strong><p><strong>Evidence:</strong> ' + escape(c.evidence) + '</p>' + (c.rationale ? '<p><strong>Rationale:</strong> ' + escape(c.rationale) + '</p>' : '') + '</article>').join('') : '<p>No grading evidence available yet.</p>') + '</details>');
        }
        for (const p of pending)
            scenarioRows.push('<tr>' + cell('Scenario ' + p.eval_id) + cell(p.configuration) + cell(p.run_number) + '<td>' + badge('Pending') + '</td><td colspan="4">Execute the pending task; no output is available yet.</td></tr>');
    }
    else {
        for (const [index, row] of rows.entries()) {
            const state = row.pass === true ? 'Pass' : row.pass === false ? 'Fail' : list(row.outcomes).length ? 'Inconclusive' : 'Unavailable';
            if (state === 'Pass')
                counts.passed++;
            else if (state === 'Fail')
                counts.failed++;
            else if (state === 'Inconclusive')
                counts.inconclusive++;
            else
                counts.unavailable++;
            scenarioRows.push('<tr>' + cell(row.query) + cell(row.should_trigger === true ? 'Load Skill' : 'Do not load') + cell(metric(row.trigger_rate, true)) + cell((row.triggers ?? 0) + ' / ' + (row.runs ?? 0)) + '<td>' + badge(state) + '</td></tr>');
            if (list(row.outcomes).length)
                evidence.push('<details><summary>Scenario ' + (index + 1) + ' — host observations</summary>' + list(row.outcomes).map(o => '<p><strong>Run ' + escape(o.repetition) + ': ' + escape(o.outcome) + '</strong><br>' + escape(record(o.evidence).source) + ' · ' + escape(record(o.evidence).reference) + '</p>').join('') + '</details>');
        }
    }
    const advice = [];
    if (pending.length)
        advice.push('Execute the ' + pending.length + ' pending task(s), preserving completed work.');
    if (status === 'awaiting-observations' || status === 'inconclusive' && !behavioral)
        advice.push('Collect actual host load-tool observations. Missing telemetry is not a negative activation result.');
    if (behavioral && (list(d.pending_grading).length || counts.unavailable))
        advice.push('Complete missing grading with the anonymous request packets; do not rerun completed candidates.');
    if (counts.inconclusive)
        advice.push('Resolve inconclusive criteria with the missing evidence or qualified review; do not convert uncertainty into failure or success.');
    if (counts.failed)
        advice.push('Inspect failed scenarios and quoted evidence below. Propose a targeted correction; change the Skill only when authorized.');
    // Efficiency availability is secondary; missing historical telemetry is not a repair task.
    if (!advice.length)
        advice.push('Review the scenario evidence and confirm it addresses your intended use. Completed results alone do not establish acceptance or reliable improvement.');
    const summary = '<section aria-label="Summary"><h2>At a glance</h2><div class="cards">' + [['Pass', counts.passed], ['Fail', counts.failed], ['Inconclusive', counts.inconclusive], ['Unavailable', counts.unavailable]].map(([label, n]) => '<div class="card"><strong>' + n + '</strong><span>' + label + '</span></div>').join('') + '</div><p>' + (behavioral ? 'Counts are criterion judgments; ungraded output rows count as unavailable, not failed.' : 'Counts are scenario verdicts; incomplete observations remain unavailable or inconclusive.') + '</p></section>';
    const visibleRows = paired?.rows ?? scenarioRows;
    const scenarios = table(paired?.heads ?? ['Request', 'Expected selection', 'Observed activation', 'Triggers / classified runs', 'Outcome'], visibleRows.length ? visibleRows : ['<tr><td colspan="5">No scenario results available.</td></tr>'], 'Scenarios — ' + (behavioral ? 'paired descriptive outcomes, not a causal improvement verdict' : 'selection accuracy, not answer quality'));
    const priorities = paired && paired.findings.length ? '<details class="priorities"><summary>Priority findings — ' + paired.findings.length + ' failed or inconclusive criteria</summary><ul>' + paired.findings.join('') + '</ul></details>' : '';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(name) + ' — ' + escape(mode) + ' evaluation</title><style>body{font:16px/1.5 system-ui;margin:0;color:#172231;background:#f5f7fa}main{max-width:1200px;margin:auto;padding:24px}h1{margin-bottom:8px}h2{font-size:1.2rem}section,details{background:white;padding:20px;border:1px solid #dce2e8;border-radius:10px;margin:18px 0}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{display:flex;flex-direction:column;padding:16px;background:#f1f5f9;border-radius:8px}.card strong{font-size:2rem}.badge{display:inline-block;font-weight:650;padding:3px 10px;border-radius:20px;white-space:nowrap}.pass{background:#dcefe3;color:#165c32}.fail{background:#fde3e3;color:#962323}.unknown{background:#fff0d0;color:#735000}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}caption{text-align:left;margin-bottom:12px;font-weight:600}th,td{padding:12px;border-bottom:1px solid #dce2e8;vertical-align:top}th{background:#f1f5f9}td:first-child{min-width:180px}summary{cursor:pointer;font-weight:650}.criterion{padding:12px 0;border-bottom:1px solid #e4e9ee}pre{white-space:pre-wrap;overflow-wrap:anywhere}p,td{overflow-wrap:anywhere}a{color:#164a99}a:focus-visible,summary:focus-visible{outline:3px solid #164a99;outline-offset:4px}@media(max-width:600px){main{padding:12px}.cards{grid-template-columns:repeat(2,1fr)}section,details{padding:14px}}</style></head><body><main><header><h1>' + escape(mode) + ' evaluation</h1><p>' + escape(name) + '</p><p role="status">' + escape(status) + '</p></header>' + (behavioral ? valueHtml(rows, pending) : summary) + '<section><h2>Next actions</h2><ol>' + advice.map(a => '<li>' + escape(a) + '</li>').join('') + '</ol>' + priorities + '</section><section><h2>Scenarios</h2>' + scenarios + '</section><section><h2>Evidence</h2>' + evidence.join('') + '</section><section aria-label="Evidence limits"><h2>Evidence limits</h2><p>No authenticated execution receipt. Report completeness is not acceptance, provider proof or independent grading proof.</p><p>Unavailable observations and telemetry remain unavailable, never inferred. Comparisons are descriptive; shared context can prevent causal uplift claims.</p></section><details><summary>Technical data (JSON)</summary><pre>' + escape(JSON.stringify(data, null, 2)) + '</pre></details></main></body></html>';
}
