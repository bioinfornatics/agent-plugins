#!/usr/bin/env node
/** Builds one decision-oriented review IR for both static and live viewers. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, writeFileSync, existsSync, statSync, mkdirSync, opendirSync } from "node:fs";
import { join, relative, dirname, extname, resolve, basename } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "node:http";
import { readTrustedSnapshot } from "../scripts/trusted_snapshot.js";
import { taskPath, validateTaskEvidence } from "../scripts/task_evidence.js";
import { expectedRunDirs } from "../scripts/evaluation_provenance.js";
import { EMBEDDED_VIEWER_HTML } from "./embedded_viewer.js";
const HERE = dirname(new URL(import.meta.url).pathname);
const TEXT = new Set([".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".tsx", ".jsx", ".yaml", ".yml", ".xml", ".html", ".css", ".sh", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".sql", ".r", ".toml", ".svg"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
export const REVIEW_OUTPUT_BUDGET = Object.freeze({ max_files: 256, max_total_bytes: 4 * 1024 * 1024, max_file_bytes: 256 * 1024, max_depth: 8, max_directory_entries: 8192, max_directories: 4096, max_runs: 2048, max_html_bytes: 8 * 1024 * 1024 });
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf" };
const isDir = (p) => { try {
    return statSync(p).isDirectory();
}
catch {
    return false;
} };
const isFile = (p) => { try {
    return statSync(p).isFile();
}
catch {
    return false;
} };
const json = (p) => { try {
    return JSON.parse(readFileSync(p, "utf8"));
}
catch {
    return null;
} };
function boundedFile(path, root, budget) { const ext = extname(path).toLowerCase(), name = basename(path), provenance = relative(root, path).split("\\").join("/"); try {
    let ancestor = dirname(path);
    while (ancestor !== resolve(root)) {
        const state = lstatSync(ancestor);
        if (state.isSymbolicLink() || !state.isDirectory() || ancestor === dirname(ancestor))
            throw new Error("unsafe parent");
        ancestor = dirname(ancestor);
    }
    const named = lstatSync(path);
    if (named.isSymbolicLink() || !named.isFile())
        return { name, type: "unavailable", content: "Output unavailable: not a regular file.", provenance, unavailable_reason: "not-regular" };
    if (budget.files >= REVIEW_OUTPUT_BUDGET.max_files)
        return { name, type: "unavailable", content: "Output unavailable: viewer file-count budget exhausted.", provenance, byte_length: named.size, unavailable_reason: "file-count-budget" };
    budget.files++;
    const remaining = Math.max(0, REVIEW_OUTPUT_BUDGET.max_total_bytes - budget.bytes), allowed = Math.min(named.size, REVIEW_OUTPUT_BUDGET.max_file_bytes, remaining);
    if (allowed <= 0 && named.size > 0)
        return { name, type: "unavailable", content: "Output unavailable: viewer byte budget exhausted.", provenance, byte_length: named.size, unavailable_reason: "total-byte-budget" };
    let fd;
    try {
        fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const before = fstatSync(fd);
        if (before.dev !== named.dev || before.ino !== named.ino || !before.isFile())
            throw new Error("identity changed");
        const buffer = Buffer.alloc(allowed);
        let offset = 0;
        while (offset < allowed) {
            const count = readSync(fd, buffer, offset, allowed - offset, offset);
            if (!count)
                break;
            offset += count;
        }
        const read = buffer.subarray(0, offset), after = fstatSync(fd);
        if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
            throw new Error("changed while read");
        budget.bytes += read.length;
        const truncated = read.length < named.size, notice = truncated ? "\n\n[Truncated by viewer budget: showing " + read.length + " of " + named.size + " bytes.]" : "";
        if (TEXT.has(ext) && Buffer.from(read.toString("utf8"), "utf8").equals(read) && !read.includes(0))
            return { name, type: "text", content: read.toString("utf8") + notice, provenance, byte_length: named.size, embedded_bytes: read.length, truncated };
        const data = read.toString("base64");
        return { name, type: IMAGE.has(ext) ? "image" : "download", data_uri: "data:" + (MIME[ext] || "application/octet-stream") + ";base64," + data, content: truncated ? "Binary uninterpreted; truncated preview: " + read.length + " of " + named.size + " bytes embedded. Full download is unavailable." : "Binary uninterpreted; download preserves exact bytes. No semantic content inspection is implied.", provenance, byte_length: named.size, embedded_bytes: read.length, truncated };
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
catch {
    return { name, type: "error", content: "Output unavailable: error reading file.", provenance, unavailable_reason: "read-error" };
} }
function configuration(root, runDir) { const parts = relative(root, runDir).split(/[\\/]/); return parts.find(x => /^(with_skill|without_skill|new_skill|old_skill|candidate|baseline)$/i.test(x)) || parts.at(-2) || "unknown"; }
function buildRun(root, runDir, budget) {
    const metadataCandidates = [join(runDir, "eval_metadata.json"), join(dirname(runDir), "eval_metadata.json"), join(dirname(dirname(runDir)), "eval_metadata.json")];
    const metadataPath = metadataCandidates.find(existsSync) || null, metadata = metadataPath ? json(metadataPath) : null;
    const gradingCandidates = [join(runDir, "grading.json"), join(dirname(runDir), "grading.json")], gradingPath = gradingCandidates.find(existsSync) || null;
    const timingCandidates = [join(runDir, "timing.json"), join(dirname(runDir), "timing.json")], timingPath = timingCandidates.find(existsSync) || null;
    const outputsDir = join(runDir, "outputs"), outputs = [];
    let output_omission = null;
    if (isDir(outputsDir)) {
        const remaining = Math.max(0, REVIEW_OUTPUT_BUDGET.max_files - budget.files), names = [];
        let scanned = 0, hasMore = false;
        const dir = opendirSync(outputsDir);
        try {
            while (true) {
                const entry = dir.readSync();
                if (!entry)
                    break;
                scanned++;
                if (scanned > REVIEW_OUTPUT_BUDGET.max_directory_entries) {
                    hasMore = true;
                    break;
                }
                if (!entry.isFile() || new Set(["user_notes.md", "metrics.json"]).has(entry.name))
                    continue;
                if (names.length >= remaining) {
                    hasMore = true;
                    break;
                }
                names.push(entry.name);
            }
        }
        finally {
            dir.closeSync();
        }
        for (const name of names.sort())
            outputs.push(boundedFile(join(outputsDir, name), root, budget));
        if (hasMore)
            output_omission = { omitted_count: null, omitted_at_least: 1, count_exact: false, limit: REVIEW_OUTPUT_BUDGET.max_files, reason: scanned > REVIEW_OUTPUT_BUDGET.max_directory_entries ? "directory-entry-budget" : "file-count-budget" };
    }
    // Read only paths declared in the bounded task manifest, never recursively discover artifacts.
    const manifestPath = join(outputsDir, "task-evidence.json");
    if (existsSync(manifestPath)) {
        try {
            const stat = lstatSync(manifestPath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 24 * 1024 * 1024)
                throw new Error("unsafe or oversized manifest");
            const context = validateTaskEvidence(JSON.parse(readTrustedSnapshot(root, manifestPath, "task manifest", { maxBytes: 24 * 1024 * 1024 }).bytes.toString("utf8"))), paths = Object.keys(context.files).sort();
            for (let index = 0; index < paths.length; index++) {
                if (budget.files >= REVIEW_OUTPUT_BUDGET.max_files) {
                    output_omission = { omitted_count: paths.length - index, omitted_at_least: paths.length - index, count_exact: true, limit: REVIEW_OUTPUT_BUDGET.max_files, reason: "file-count-budget" };
                    break;
                }
                const path = taskPath(paths[index]), artifact = join(outputsDir, "artifacts", path);
                if (budget.bytes >= REVIEW_OUTPUT_BUDGET.max_total_bytes) {
                    output_omission = { omitted_count: paths.length - index, omitted_at_least: paths.length - index, count_exact: true, limit: REVIEW_OUTPUT_BUDGET.max_total_bytes, reason: "total-byte-budget" };
                    break;
                }
                try {
                    const observed = readTrustedSnapshot(root, artifact, "task artifact", { maxBytes: 4 * 1024 * 1024, allowEmpty: true });
                    if (observed.sha256 !== context.files[path].sha256)
                        throw new Error("manifest hash mismatch");
                    const file = boundedFile(artifact, root, budget);
                    file.name = path;
                    outputs.push(file);
                }
                catch {
                    outputs.push({ name: path, type: "unavailable", content: "Artifact unavailable: missing, unsafe, or inconsistent with the bound task manifest.", provenance: relative(root, artifact), unavailable_reason: "manifest-binding-mismatch" });
                    budget.files++;
                }
            }
        }
        catch {
            output_omission = { omitted_count: null, omitted_at_least: 1, count_exact: false, limit: REVIEW_OUTPUT_BUDGET.max_files, reason: "invalid-task-manifest" };
        }
    }
    else if (existsSync(join(outputsDir, "artifacts")))
        output_omission = { omitted_count: null, omitted_at_least: 1, count_exact: false, limit: REVIEW_OUTPUT_BUDGET.max_files, reason: "artifact-directory-without-manifest" };
    const scenario = String(metadata?.eval_id ?? relative(root, runDir).split(/[\\/]/).find(x => x.startsWith("eval-")) ?? "unknown");
    return { id: relative(root, runDir).split(/[\\/]/).join("-"), scenario_id: scenario, configuration: configuration(root, runDir), prompt: String(metadata?.prompt ?? "(No prompt found)"), outputs, output_omission, grading: gradingPath ? json(gradingPath) : null, timing: timingPath ? json(timingPath) : null, provenance: { metadata: metadataPath ? relative(root, metadataPath) : null, grading: gradingPath ? relative(root, gradingPath) : null, timing: timingPath ? relative(root, timingPath) : null, run: relative(root, runDir) } };
}
function findRuns(root) {
    if (existsSync(join(root, ".adaptive-scheduling.json"))) {
        const budget = { files: 0, bytes: 0 };
        return expectedRunDirs(root).map(run => buildRun(root, run, budget)).sort((a, b) => a.scenario_id.localeCompare(b.scenario_id) || a.id.localeCompare(b.id));
    }
    const out = [], budget = { files: 0, bytes: 0 }, traversal = { directories: 0, entries: 0 };
    function walk(dir, depth = 0) { if (depth > REVIEW_OUTPUT_BUDGET.max_depth || out.length >= REVIEW_OUTPUT_BUDGET.max_runs || traversal.directories >= REVIEW_OUTPUT_BUDGET.max_directories)
        return; if (!isDir(dir))
        return; traversal.directories++; if (isDir(join(dir, "outputs"))) {
        out.push(buildRun(root, dir, budget));
        return;
    } const names = []; const handle = opendirSync(dir); try {
        while (true) {
            const entry = handle.readSync();
            if (!entry)
                break;
            traversal.entries++;
            if (traversal.entries > REVIEW_OUTPUT_BUDGET.max_directory_entries)
                break;
            if (entry.isDirectory() && !new Set(["node_modules", ".git", "skill", "inputs"]).has(entry.name))
                names.push(entry.name);
        }
    }
    finally {
        handle.closeSync();
    } for (const name of names.sort()) {
        walk(join(dir, name), depth + 1);
        if (out.length >= REVIEW_OUTPUT_BUDGET.max_runs || traversal.entries > REVIEW_OUTPUT_BUDGET.max_directory_entries)
            break;
    } }
    walk(root);
    return out.sort((a, b) => a.scenario_id.localeCompare(b.scenario_id) || a.id.localeCompare(b.id));
}
const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
const mean = (obj, key) => num(obj?.[key]?.mean);
function configIds(benchmark, runs) { const ids = Object.keys(benchmark?.run_summary || {}).filter(x => x !== "delta"); for (const r of runs)
    if (!ids.includes(r.configuration))
        ids.push(r.configuration); const candidate = ids.find(x => /with_skill|new_skill|candidate/i.test(x)) ?? ids[0] ?? null; const baseline = ids.find(x => /without_skill|old_skill|baseline/i.test(x)) ?? ids.find(x => x !== candidate) ?? null; return { candidate, baseline }; }
function passedMap(run) { return new Map((run.grading?.expectations || []).filter((x) => x.verdict === undefined || x.verdict === "pass" || x.verdict === "fail").map((x) => [String(x.text ?? "Unnamed assertion"), { passed: Boolean(x.passed), critical: x.critical !== false }])); }
const anchorToken = (value) => Buffer.from(value, "utf8").toString("hex") || "empty";
const scenarioAnchor = (id) => `scenario-${anchorToken(id)}`;
const runAnchor = (run) => `run-${anchorToken(run.id)}`;
const assertionAnchor = (run, label) => `${runAnchor(run)}-assertion-${anchorToken(label)}`;
function runFailed(run) { const expectations = run.grading?.expectations; return Array.isArray(expectations) ? expectations.some((x) => x.verdict !== undefined ? x.verdict === "fail" : x.passed === false) : (run.grading?.summary?.failed ?? 0) > 0; }
/** Includes candidate-vs-baseline, repeated-run, and grader/model outcome disagreements. */
function scenarioDisagreement(runs) {
    const outcomes = new Map(), signatures = new Set();
    for (const r of runs) {
        const assertions = [...passedMap(r)].sort(([a], [b]) => a.localeCompare(b));
        signatures.add(JSON.stringify(assertions));
        for (const [label, outcome] of assertions) {
            const values = outcomes.get(label) || new Set();
            values.add(outcome.passed);
            outcomes.set(label, values);
        }
    }
    return signatures.size > 1 || [...outcomes.values()].some(values => values.size > 1);
}
export function buildReviewIR(workspace, skillName, benchmark, previous = {}) {
    const runs = findRuns(workspace), progress = json(join(workspace, "progress" + ".json")), provisional = Boolean(benchmark?.provisional === true || (benchmark?.final_receipt !== true && progress && progress.final_receipt !== true && Number(progress.completed) < Number(progress.total))), ids = configIds(benchmark, runs), summary = benchmark?.run_summary || {}, delta = summary.delta || {}, paired = delta.paired?.pass_rate || {};
    const critical = [];
    for (const scenario of new Set(runs.map(r => r.scenario_id))) {
        const cs = runs.filter(r => r.scenario_id === scenario && r.configuration === ids.candidate), bs = runs.filter(r => r.scenario_id === scenario && r.configuration === ids.baseline);
        for (let i = 0; i < Math.min(cs.length, bs.length); i++) {
            const c = passedMap(cs[i]), b = passedMap(bs[i]);
            for (const [label, bp] of b) {
                const cp = c.get(label);
                if (bp.passed && bp.critical && cp?.critical !== false && cp?.passed === false)
                    critical.push({ text: `${scenario}: ${label}`, href: `#${assertionAnchor(cs[i], label)}` });
            }
        }
    }
    const missing = [];
    const miss = (text, href = "#provenance") => missing.push({ text, href });
    if (!benchmark)
        miss("benchmark.json is missing or invalid");
    if (!ids.candidate)
        miss("candidate configuration is missing", "#scenario-evidence");
    if (!ids.baseline)
        miss("baseline configuration is missing", "#scenario-evidence");
    const noGrade = runs.find(r => !r.grading);
    if (noGrade)
        miss("one or more runs have no valid grading.json", `#${runAnchor(noGrade)}`);
    const effect = num(paired.mean) ?? (() => { const v = Number.parseFloat(delta.pass_rate); return Number.isFinite(v) ? v : null; })();
    const ci = paired.confidence_interval_95 && num(paired.confidence_interval_95.lower) !== null && num(paired.confidence_interval_95.upper) !== null ? { lower: paired.confidence_interval_95.lower, upper: paired.confidence_interval_95.upper } : null;
    if (!ci)
        miss("paired 95% confidence interval is unavailable");
    const metricDefs = [["pass_rate", "rate"], ["time_seconds", "seconds"], ["tokens", "tokens"], ["cost", "cost"]];
    const metrics = metricDefs.map(([id, unit]) => { const candidate = mean(summary[ids.candidate || ""], id), baseline = mean(summary[ids.baseline || ""], id); return { id, candidate, baseline, delta: candidate !== null && baseline !== null ? candidate - baseline : null, unit, evidence_href: "#provenance-benchmark" }; });
    for (const m of metrics.filter(x => x.id !== "pass_rate" && x.candidate === null))
        miss(`${m.id} evidence is unavailable`, m.evidence_href);
    const sequential = benchmark?.decision_evidence ?? null, adaptive = sequential?.mode === "adaptive";
    let verdict = "inconclusive";
    if (!ids.candidate || !ids.baseline || runs.some(r => !r.grading) || !benchmark)
        verdict = "blocked";
    else if (runs.some(r => r.grading?.summary?.unavailable > 0))
        verdict = "blocked";
    else if (runs.some(r => r.grading?.summary?.inconclusive > 0))
        verdict = "inconclusive";
    else if (adaptive) {
        const decision = sequential.decision;
        if (critical.length || decision === "regression")
            verdict = "fail";
        else if (decision === "winner")
            verdict = "pass";
        else
            verdict = "inconclusive";
    }
    else if (critical.length || effect !== null && effect < 0)
        verdict = "fail";
    else if (effect !== null && effect > 0 && ci && ci.lower > 0 && sequential?.mode === "fixed" && sequential?.method_version === "2.0" && delta.sampling?.complete === true && delta.sampling?.unit === "complete-fixed-suite-repetition" && delta.stable_improvement === true && paired.statistically_valid === true && paired.count >= 2)
        verdict = "pass";
    if (provisional)
        verdict = "provisional";
    const action = verdict === "provisional" ? "Wait for the final receipt. The live sequential decision is provisional and cannot be accepted." : adaptive && sequential.decision === "futility" ? "Stop for futility: the confidence sequence is inside the predeclared equivalence region; do not claim a winner." : adaptive && sequential.decision === "continue" ? "Continue to the next predeclared look; current evidence crosses no stopping boundary." : verdict === "pass" ? adaptive ? "Confirm the anytime-valid winner evidence is representative, then accept or request another evaluation." : "Confirm the fixed-suite Student-t improvement evidence and its independence/stability assumptions, then accept or request another evaluation." : verdict === "fail" ? "Reject or revise the candidate; resolve every critical regression before acceptance." : verdict === "blocked" ? "Provide the missing evidence before making a decision." : "The final evidence is inconclusive; make no winner claim and decide whether to collect a new predeclared experiment.";
    const scenarios = [...new Set(runs.map(r => r.scenario_id))].map(id => { const sr = runs.filter(r => r.scenario_id === id), candidateRuns = sr.filter(r => r.configuration === ids.candidate), baselineRuns = sr.filter(r => r.configuration === ids.baseline); return { id, anchor: scenarioAnchor(id), prompt: sr[0]?.prompt || "", failed: candidateRuns.some(runFailed), baseline_weakness: baselineRuns.some(runFailed), disagreement: scenarioDisagreement(sr), runs: sr }; });
    const decisionHref = critical[0]?.href ?? missing[0]?.href ?? "#provenance-benchmark";
    return { schema_version: "1.0", status: provisional ? "provisional" : "complete", provisional, final_receipt: !provisional, canonical: !provisional, historical: false, skill_name: skillName, generated_at: String(benchmark?.metadata?.timestamp ?? "unavailable"), candidate_id: ids.candidate, baseline_id: ids.baseline, decision: { verdict, effect_size: effect, confidence_95: ci, variance: num(paired.stddev), critical_regressions: [...new Map(critical.map(x => [`${x.text}|${x.href}`, x])).values()], missing_evidence: [...new Map(missing.map(x => [`${x.text}|${x.href}`, x])).values()], required_human_action: action, evidence_href: decisionHref }, progress: progress ?? null, sequential, efficiency: benchmark?.quality_conditioned_efficiency ?? null, instruction_efficiency: benchmark?.instruction_efficiency_analysis ?? null, metrics, scenarios, provenance: { benchmark: benchmark ? "benchmark.json" : null, workspace: basename(workspace) }, previous_feedback: previous };
}
function safeJson(value) { return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
export function generateHtml(ir) {
    let template = import.meta.url.includes("/$bunfs/") ? EMBEDDED_VIEWER_HTML : readFileSync(join(HERE, "viewer.html"), "utf8"); // Adapt the bundled shared template at this owned rendering seam. Never convert
    // inconclusive/unavailable judgments to failed task outcomes in visible labels.
    template = template.replace("(x.passed?'✓ Pass: ':'✕ Fail: ')", "(x.availability==='unavailable'?'? Grading unavailable: ':x.verdict==='inconclusive'?'? Inconclusive: ':x.passed?'✓ Pass: ':'✕ Fail: ')");
    template = template.replace("const sd=d.sequential;if(!sd)", "const sd=d.sequential;if(sd?.mode==='fixed'){text($('sequential-explanation'),d.decision.required_human_action);for(const [k,v] of Object.entries({'Mode / method / version':sd.mode+' / '+sd.method+' / '+sd.method_version,'Sampling unit':sd.sampling?.unit??'Unavailable','Assumptions / missingness':JSON.stringify(sd.sampling??sd.assumptions),'Conclusion':d.decision.verdict})){append($('sequential-details'),'dt',k);append($('sequential-details'),'dd',v);}}else if(!sd)");
    template = template.replace("'Additional outputs omitted without enumeration: at least '+r.output_omission.omitted_at_least+'; exact count unavailable; limit '", "'Additional outputs omitted: '+(r.output_omission.count_exact?r.output_omission.omitted_count+' (exact)': 'at least '+r.output_omission.omitted_at_least+'; exact count unavailable')+'; limit '");
    template = template.replace("sd.looks.length", "(sd.looks||[]).length").replace("of sd.looks)", "of sd.looks||[])").replace("of sd.counted_membership)", "of sd.counted_membership||[])");
    const html = template.replace("/*__EMBEDDED_DATA__*/", `const REVIEW_IR=${safeJson(ir)};`);
    if (Buffer.byteLength(html) > REVIEW_OUTPUT_BUDGET.max_html_bytes)
        throw new Error("review HTML exceeds the explicit 8 MiB report budget");
    return html;
}
function previousFeedback(path) { if (!path)
    return {}; const data = json(join(resolve(path), "feedback.json")); return Object.fromEntries((data?.reviews || []).filter((x) => x.feedback).map((x) => [String(x.run_id), String(x.feedback)])); }
function loadBenchmark(path) { return path && existsSync(path) ? json(path) : null; }
export async function main() { const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { port: { type: "string", short: "p", default: "3117" }, "skill-name": { type: "string", short: "n" }, "previous-workspace": { type: "string" }, benchmark: { type: "string" }, static: { type: "string", short: "s" } } }); const arg = positionals[0]; if (!arg) {
    console.error("usage: generate_review.js <workspace> [--benchmark FILE] [--static FILE]");
    process.exit(2);
} const workspace = resolve(arg); if (!isDir(workspace)) {
    console.error(`Error: ${workspace} is not a directory`);
    process.exit(1);
} const skill = String(values["skill-name"] || basename(workspace).replace("-workspace", "")), bp = values.benchmark ? resolve(String(values.benchmark)) : existsSync(join(workspace, "benchmark.json")) ? join(workspace, "benchmark.json") : null, prev = previousFeedback(values["previous-workspace"]), feedback = join(workspace, "feedback.json"); const render = () => generateHtml(buildReviewIR(workspace, skill, loadBenchmark(bp), prev)); if (values.static) {
    const out = resolve(String(values.static));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, render());
    console.log(`Static viewer written to: ${out}`);
    return;
} const server = createServer((req, res) => { if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const body = Buffer.from(render());
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
    res.end(body);
    return;
} if (req.url === "/api/feedback" && req.method === "GET") {
    const body = existsSync(feedback) ? readFileSync(feedback) : Buffer.from("{}");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
} if (req.url === "/api/feedback" && req.method === "POST") {
    const chunks = [];
    req.on("data", x => chunks.push(x));
    req.on("end", () => { try {
        const body = Buffer.concat(chunks);
        if (body.length > 1024 * 1024)
            throw Error("feedback exceeds 1 MiB");
        const data = JSON.parse(body.toString("utf8"));
        if (!Array.isArray(data?.reviews))
            throw Error("reviews array required");
        writeFileSync(feedback, JSON.stringify(data, null, 2) + "\n");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
    }
    catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
    } });
    return;
} res.writeHead(404); res.end(); }); const port = Number(values.port); server.listen(port, "127.0.0.1", () => console.log(`Review viewer: http://127.0.0.1:${port}`)); }
if (!import.meta.url.includes("/$bunfs/") && process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
    main().catch(e => { console.error(e?.message || e); process.exit(1); });
