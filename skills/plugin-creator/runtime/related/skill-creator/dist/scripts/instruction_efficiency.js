/** Evidence-bounded analysis of observable Skill instruction-efficiency patterns. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
export const INSTRUCTION_EFFICIENCY_SCHEMA_VERSION = "1.2";
const MAX_JSON_BYTES = 8 * 1024 * 1024, MAX_MARKDOWN_BYTES = 1024 * 1024, MAX_CAMPAIGN_BYTES = 32 * 1024 * 1024, MAX_CAMPAIGN_FILES = 1024;
const PRIORITY = ["poorly_routed_progressive_disclosure", "missing_instruction", "ambiguous_instruction", "redundant_instruction", "overly_general_instruction"];
const PREDICATES = new Set(["repeated_same_action", "no_stop_condition_observed", "divergent_action_for_same_instruction", "unrelated_scope_actions", "repeated_target", "reference_loaded", "loaded_after_repeated_action"]);
const TEMPLATES = { missing_instruction: "The bounded events show a repeated action and no observable stop condition.", ambiguous_instruction: "The bounded events show divergent actions for the same instruction.", overly_general_instruction: "The bounded events show actions outside the instruction's stated scope.", redundant_instruction: "The bounded events show the same action repeated for the same target.", poorly_routed_progressive_disclosure: "The bounded events show a reference loaded only after repeated action." };
const REQUIREMENTS = { missing_instruction: ["repeated_same_action", "no_stop_condition_observed"], ambiguous_instruction: ["divergent_action_for_same_instruction"], overly_general_instruction: ["unrelated_scope_actions"], redundant_instruction: ["repeated_same_action", "repeated_target"], poorly_routed_progressive_disclosure: ["reference_loaded", "loaded_after_repeated_action"] };
const finiteDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const campaignId = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value);
const plain = (value, max = 500) => typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(value);
const isSha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const inside = (root, path) => { const rel = relative(root, path); return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".."); };
function unchanged(a, b) { return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function rejectSymlinkComponents(rootReal, path) { const rel = relative(rootReal, path); if (!inside(rootReal, path))
    throw new Error("path escapes root"); let cursor = rootReal; for (const part of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink())
        throw new Error("symlink path component");
} }
/** Testable primitive used by all evidence, manifest, Skill, and reference reads. */
export function snapshotRegularFile(path, root, maxBytes, afterRead) {
    const rootPath = resolve(root), rootStat = lstatSync(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
        throw new Error("root must be a real directory");
    const rootReal = realpathSync(rootPath), lexical = resolve(rootReal, relative(rootPath, resolve(path)));
    if (!inside(rootReal, lexical))
        throw new Error("path escapes root");
    rejectSymlinkComponents(rootReal, lexical);
    const lexicalStat = lstatSync(lexical);
    if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink())
        throw new Error("not a regular file");
    const beforeReal = realpathSync(lexical);
    if (!inside(rootReal, beforeReal) || beforeReal !== lexical)
        throw new Error("real path escapes root or uses a link");
    let fd;
    try {
        fd = openSync(lexical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const before = fstatSync(fd);
        if (!before.isFile())
            throw new Error("not a regular file");
        if (before.size < 0 || before.size > maxBytes)
            throw new Error("file exceeds byte limit");
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) {
            const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
            if (count === 0)
                break;
            offset += count;
        }
        afterRead?.();
        const after = fstatSync(fd);
        if (offset !== bytes.length || !unchanged(before, after))
            throw new Error("file mutated while being read");
        rejectSymlinkComponents(rootReal, lexical);
        if (realpathSync(lexical) !== beforeReal)
            throw new Error("path mutated while being read");
        return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), realpath: beforeReal };
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
function parseJson(snapshot) { try {
    return JSON.parse(snapshot.bytes.toString("utf8"));
}
catch {
    return null;
} }
function slug(value) { return value.trim().toLowerCase().replace(/[\x60*_]/g, "").replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-"); }
function headings(bytes) { const out = new Set(); for (const line of bytes.toString("utf8").split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (m)
        out.add(slug(m[1]));
} return out; }
function anchor(locator, skillRoot) { const m = locator.match(/^(SKILL\.md|references\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md)#([a-z0-9][a-z0-9-]*)$/); if (!m || m[1].split("/").some(x => x === "." || x === ".."))
    return null; try {
    const snap = snapshotRegularFile(resolve(skillRoot, m[1]), skillRoot, MAX_MARKDOWN_BYTES);
    return headings(snap.bytes).has(m[2]) ? { locator: m[1] + "#" + m[2] } : null;
}
catch {
    return null;
} }
const PLACEHOLDERS = new Set(["stuff", "thing", "things", "something", "anything", "todo", "tbd", "fix", "improve", "better", "behavior", "behaviour", "instruction", "change", "changes", "misc"]);
const ACTIONS = new Set(["add", "avoid", "call", "check", "choose", "close", "continue", "create", "define", "document", "emit", "ensure", "fail", "include", "load", "open", "prefer", "prevent", "read", "reject", "require", "return", "route", "run", "select", "skip", "stop", "use", "validate", "verify", "write"]);
const STOPWORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "then", "to", "when", "with"]);
function behavior(value) { if (!plain(value, 240))
    return null; const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim(), tokens = normalized.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [], substantive = tokens.filter(x => !STOPWORDS.has(x)); if (substantive.length < 4 || substantive.some(x => PLACEHOLDERS.has(x)) || !substantive.some(x => ACTIONS.has(x)) || !substantive.some(x => !ACTIONS.has(x) && !PLACEHOLDERS.has(x)))
    return null; return normalized; }
function target(value, skillRoot) { if (!value || typeof value !== "object")
    return null; if (value.kind === "instruction" && plain(value.locator, 300)) {
    const found = anchor(value.locator, skillRoot);
    return found ? { kind: "instruction", locator: found.locator } : null;
} if (value.kind !== "omission")
    return null; const missing = behavior(value.missing_behavior), insertion = plain(value.insertion_location, 300) ? anchor(value.insertion_location, skillRoot) : null; return missing && insertion ? { kind: "omission", missing_behavior: missing, insertion_location: insertion.locator } : null; }
function derive(values) { if (!Array.isArray(values) || !values.length || values.some(x => typeof x !== "string" || !PREDICATES.has(x)))
    return null; const set = new Set(values), matches = PRIORITY.filter(p => REQUIREMENTS[p].every(x => set.has(x))); return matches[0] ?? null; }
function selectorValid(name, selector, data) { let m; if (name === "events.json" && (m = selector.match(/^events\[(\d+):(\d+)\]$/))) {
    const lo = +m[1], hi = +m[2];
    return Array.isArray(data) && lo <= hi && hi < data.length && hi - lo < 50 && data.slice(lo, hi + 1).every((x) => x && typeof x.type === "string" && Array.isArray(x.redactions));
} if (name === "navigation.json" && (m = selector.match(/^(read|files_read)\[(\d+)\]$/)))
    return Array.isArray(data?.[m[1]]) && +m[2] < data[m[1]].length; if (name === "timing.json" && (m = selector.match(/^execution_efficiency\.(tool_calls|unique_tool_calls|references_read|unique_references_read|files_read|unique_files_read|turns|time_to_first_useful_action_seconds|total_duration_seconds|retries)$/)))
    return data?.execution_efficiency?.[m[1]]?.value !== undefined; if (name === "grading.json" && (m = selector.match(/^expectations\[(\d+)\]$/)))
    return Array.isArray(data?.expectations) && +m[1] < data.expectations.length; if (name === "grading.json" && selector === "summary.pass_rate")
    return typeof data?.summary?.pass_rate === "number"; if (name === "deterministic-evidence.json" && (m = selector.match(/^assertions\[(\d+)\]$/)))
    return Array.isArray(data?.assertions) && +m[1] < data.assertions.length; if (name === "execution-evidence.json" && /^(pair_equivalence\.(model|timeout_seconds|max_turns)|executor\.(adapter|host_version|exit_reason|pair_index|order_position))$/.test(selector))
    return true; return false; }
function memberValid(member, c) { return !!member && plain(member.artifact_root, 600) && member.scenario_id === c.scenario_id && isSha(member.scenario_sha256) && [c.candidate_configuration, c.baseline_configuration].includes(member.configuration) && Number.isSafeInteger(member.run_index) && member.run_index > 0 && Number.isSafeInteger(member.pair_index) && member.pair_index > 0 && member.model === c.model && member.reasoning === c.reasoning && isSha(member.manifest_sha256) && member.aggregate_evidence_sha256 === c.execution_evidence_sha256; }
function evidence(value, root, campaign) { if (!value || typeof value !== "object" || !plain(value.artifact, 700) || !plain(value.selector, 160) || !isSha(value.sha256))
    return null; const artifact = value.artifact.replaceAll("\\", "/"); if (artifact !== value.artifact || artifact.startsWith("/") || artifact.split("/").some(x => !x || x === "." || x === ".."))
    return null; const m = artifact.match(/^(eval-([^/]+))\/([^/]+)\/run-(\d+)\/(events|navigation|timing|grading|deterministic-evidence|execution-evidence)\.json$/); if (!m)
    return null; const artifactRoot = m[1] + "/" + m[3] + "/run-" + m[4], member = campaign.aggregate_membership.find(x => x.artifact_root === artifactRoot); if (!member || !memberValid(member, campaign) || m[2] !== campaign.scenario_id || member.configuration !== m[3] || member.run_index !== +m[4])
    return null; try {
    const path = resolve(root, artifact), artifactSnapshot = snapshotRegularFile(path, root, MAX_JSON_BYTES);
    if (artifactSnapshot.sha256 !== value.sha256)
        return null;
    const name = m[5] + ".json", data = parseJson(artifactSnapshot);
    if (data === null || !selectorValid(name, value.selector, data))
        return null;
    const manifestSnapshot = name === "execution-evidence.json" ? artifactSnapshot : snapshotRegularFile(resolve(dirname(path), "execution-evidence.json"), root, MAX_JSON_BYTES), manifest = parseJson(manifestSnapshot);
    if (!manifest || manifestSnapshot.sha256 !== member.manifest_sha256)
        return null;
    if (manifest.skill_source_sha256 !== campaign.skill_source_sha256 || manifest.eval_plan_sha256 !== campaign.eval_plan_sha256 || manifest.scenario_sha256 !== member.scenario_sha256 || manifest.configuration !== member.configuration || manifest.run_index !== member.run_index || manifest.pair_index !== member.pair_index || manifest.pair_equivalence?.model !== campaign.model)
        return null;
    if (name !== "execution-evidence.json" && manifest.artifact_sha256?.[name] !== value.sha256)
        return null;
    return { artifact, selector: value.selector, sha256: value.sha256, data };
}
catch {
    return null;
} }
function observedPredicates(locator) { if (!locator.artifact.endsWith("/events.json"))
    return []; const data = locator.data, m = locator.selector.match(/^events\[(\d+):(\d+)\]$/); if (!Array.isArray(data) || !m)
    return []; const events = data.slice(+m[1], +m[2] + 1), calls = events.filter((x) => typeof x?.tool_name === "string"), workCalls = calls.filter((x) => x.locator?.kind !== "reference"), identities = workCalls.map((x) => x.tool_name + "|" + (x.locator?.value ?? "")), out = []; if (identities.length > 1 && new Set(identities).size < identities.length)
    out.push("repeated_same_action", "repeated_target"); if (new Set(workCalls.map((x) => x.tool_name)).size > 1)
    out.push("divergent_action_for_same_instruction"); if (new Set(calls.map((x) => x.locator?.kind).filter(Boolean)).size > 1)
    out.push("unrelated_scope_actions"); const ref = events.findIndex((x) => x.locator?.kind === "reference"); if (ref >= 0)
    out.push("reference_loaded"); if (ref >= 2)
    out.push("loaded_after_repeated_action"); if (out.includes("repeated_same_action") && !events.some((x) => x.type === "complete"))
    out.push("no_stop_condition_observed"); return [...new Set(out)]; }
function compatible(a, b) { return a.scenario_id === b.scenario_id && a.model === b.model && a.reasoning === b.reasoning && a.candidate_configuration === b.candidate_configuration && a.baseline_configuration === b.baseline_configuration; }
function stratum(c) { return Array.isArray(c?.quality_conditioned_efficiency?.strata) ? c.quality_conditioned_efficiency.strata.find((s) => s?.scenario_id === c.scenario_id && s?.model === c.model && s?.reasoning === c.reasoning) ?? null : null; }
function metricMap(c) { const s = stratum(c), map = new Map(); for (const m of Array.isArray(s?.metrics) ? s.metrics : [])
    if (m && typeof m?.id === "string" && !map.has(m.id))
        map.set(m.id, m); return { stratum: s, map }; }
function composite(parts) { const h = createHash("sha256"); for (const part of parts) {
    h.update(part);
    h.update("\0");
} return h.digest("hex"); }
function campaignDirectory(root, id) { const campaigns = resolve(root, "campaigns"), dir = resolve(campaigns, id); for (const path of [root, campaigns, dir]) {
    const st = lstatSync(path);
    if (!st.isDirectory() || st.isSymbolicLink())
        throw new Error("campaign workspace must be a regular directory");
} rejectSymlinkComponents(realpathSync(root), dir); if (realpathSync(dir) !== dir)
    throw new Error("campaign workspace must not use links"); return dir; }
function artifactDigest(path, root, budget) { const st = lstatSync(path); if (st.isSymbolicLink())
    throw new Error("campaign artifact link rejected"); if (st.isFile()) {
    const snap = snapshotRegularFile(path, root, MAX_JSON_BYTES);
    budget.files++;
    budget.bytes += snap.bytes.length;
    if (budget.files > MAX_CAMPAIGN_FILES || budget.bytes > MAX_CAMPAIGN_BYTES)
        throw new Error("campaign evidence exceeds snapshot bounds");
    return snap.sha256;
} if (!st.isDirectory())
    throw new Error("campaign evidence must be regular"); const base = path, parts = []; const visit = (dir) => { for (const name of readdirSync(dir).sort()) {
    const child = resolve(dir, name);
    if (!inside(base, child))
        throw new Error("campaign evidence escapes directory");
    const cs = lstatSync(child);
    if (cs.isSymbolicLink())
        throw new Error("campaign evidence link rejected");
    if (cs.isDirectory())
        visit(child);
    else if (cs.isFile()) {
        const snap = snapshotRegularFile(child, root, MAX_JSON_BYTES);
        budget.files++;
        budget.bytes += snap.bytes.length;
        if (budget.files > MAX_CAMPAIGN_FILES || budget.bytes > MAX_CAMPAIGN_BYTES)
            throw new Error("campaign evidence exceeds snapshot bounds");
        parts.push(relative(base, child).replaceAll("\\", "/"), snap.bytes);
    }
    else
        throw new Error("campaign evidence must be regular");
} }; visit(base); return composite(parts); }
function loadLaterCampaign(root, requested) { try {
    if (!campaignId(requested?.campaign_id))
        return null;
    const dir = campaignDirectory(root, requested.campaign_id), benchmarkSnap = snapshotRegularFile(resolve(dir, "benchmark.json"), dir, MAX_JSON_BYTES), progressSnap = snapshotRegularFile(resolve(dir, "progress.json"), dir, MAX_JSON_BYTES), receiptSnap = snapshotRegularFile(resolve(dir, "receipt.json"), dir, MAX_JSON_BYTES), benchmark = parseJson(benchmarkSnap), progress = parseJson(progressSnap), receipt = parseJson(receiptSnap), record = benchmark?.campaign;
    if (!benchmark || !progress || !receipt || !record)
        return null;
    if (benchmark.status !== "complete" || benchmark.provisional !== false || benchmark.final_receipt !== true || benchmark.canonical !== true || benchmark.historical !== false)
        return null;
    if (progress.status !== "complete" || progress.provisional !== false || progress.final_receipt !== true)
        return null;
    if (receipt.schema_version !== "1.0" || receipt.artifact !== "skill" || receipt.status !== "pass")
        return null;
    const source = benchmark.metadata?.source_sha256, plan = benchmark.metadata?.eval_plan_sha256, claimedEvidence = benchmark.metadata?.execution_evidence_sha256, provenance = receipt.evaluation_provenance;
    if (!isSha(source) || !isSha(plan) || !isSha(claimedEvidence) || receipt.source_sha256 !== source || provenance?.skill_source_sha256 !== source || provenance?.eval_plan_sha256 !== plan || provenance?.execution_evidence_sha256 !== claimedEvidence || provenance?.benchmark_sha256 !== benchmarkSnap.sha256)
        return null;
    const later = { campaign_id: record.campaign_id, completed_at: record.completed_at, scenario_id: record.scenario_id, model: record.model, reasoning: record.reasoning, candidate_configuration: record.candidate_configuration, baseline_configuration: record.baseline_configuration, skill_source_sha256: record.skill_source_sha256, eval_plan_sha256: record.eval_plan_sha256, execution_evidence_sha256: record.execution_evidence_sha256, aggregate_membership: record.aggregate_membership, quality_conditioned_efficiency: benchmark.quality_conditioned_efficiency };
    if (later.campaign_id !== requested.campaign_id || later.skill_source_sha256 !== source || later.eval_plan_sha256 !== plan || later.execution_evidence_sha256 !== claimedEvidence || !campaignId(later.campaign_id) || !finiteDate(later.completed_at) || !isSha(later.skill_source_sha256) || !isSha(later.eval_plan_sha256) || !isSha(later.execution_evidence_sha256) || !Array.isArray(later.aggregate_membership) || !later.aggregate_membership.length)
        return null;
    const keys = later.aggregate_membership.map(x => x?.artifact_root);
    if (new Set(keys).size !== keys.length || later.aggregate_membership.some(x => !memberValid(x, later)))
        return null;
    const configs = new Set(later.aggregate_membership.map(x => x.configuration));
    if (!configs.has(later.candidate_configuration) || !configs.has(later.baseline_configuration))
        return null;
    const pairs = new Map(), parts = [], budget = { files: 0, bytes: benchmarkSnap.bytes.length + progressSnap.bytes.length + receiptSnap.bytes.length };
    for (const member of later.aggregate_membership) {
        const pair = pairs.get(member.pair_index) ?? new Set();
        pair.add(member.configuration);
        pairs.set(member.pair_index, pair);
        const manifestPath = resolve(dir, member.artifact_root, "execution-evidence.json"), manifestSnap = snapshotRegularFile(manifestPath, dir, MAX_JSON_BYTES), manifest = parseJson(manifestSnap);
        budget.files++;
        budget.bytes += manifestSnap.bytes.length;
        if (budget.files > MAX_CAMPAIGN_FILES || budget.bytes > MAX_CAMPAIGN_BYTES || manifestSnap.sha256 !== member.manifest_sha256 || !manifest)
            return null;
        if (manifest.schema_version !== "1.0" || manifest.skill_source_sha256 !== source || manifest.eval_plan_sha256 !== plan || manifest.scenario_sha256 !== member.scenario_sha256 || manifest.configuration !== member.configuration || manifest.run_index !== member.run_index || manifest.pair_index !== member.pair_index || manifest.pair_equivalence?.model !== later.model || !manifest.artifact_sha256 || typeof manifest.artifact_sha256 !== "object")
            return null;
        const label = member.artifact_root, actual = {};
        for (const name of Object.keys(manifest.artifact_sha256).sort()) {
            if (!["outputs", "grading.json", "timing.json", "navigation.json", "transcript.json", "events.json", "deterministic-evidence.json", "grader-evidence", "manual-import-manifest.json"].includes(name))
                return null;
            actual[name] = artifactDigest(resolve(dir, label, name), dir, budget);
            if (actual[name] !== manifest.artifact_sha256[name])
                return null;
        }
        for (const required of ["outputs", "grading.json", "timing.json"])
            if (!actual[required])
                return null;
        parts.push(label, manifestSnap.bytes);
        for (const [name, digest] of Object.entries(actual).sort(([a], [b]) => a.localeCompare(b)))
            parts.push(label + "/" + name, digest);
    }
    if ([...pairs.values()].some(config => config.size !== 2 || !config.has(later.candidate_configuration) || !config.has(later.baseline_configuration)) || composite(parts) !== claimedEvidence)
        return null;
    later._snapshot_hashes = { benchmark_sha256: benchmarkSnap.sha256, progress_sha256: progressSnap.sha256, receipt_sha256: receiptSnap.sha256 };
    return later;
}
catch {
    return null;
} }
function confirmation(root, current, requested, ids) { const later = loadLaterCampaign(root, requested); if (!later || later.campaign_id === current.campaign_id || Date.parse(later.completed_at) <= Date.parse(current.completed_at) || !compatible(current, later))
    return null; const cm = metricMap(current).map, { stratum: s, map } = metricMap(later); if (!s || s.quality?.regressed !== false || !s.quality?.availability?.available)
    return null; const improved = ids.filter(id => { const before = cm.get(id), after = map.get(id); return after?.id === before?.id && after?.unit === before?.unit && JSON.stringify(after?.taxonomy) === JSON.stringify(before?.taxonomy) && after?.taxonomy?.downstream_savings_eligible === true && after?.availability?.available === true && typeof before?.delta?.mean === "number" && Number.isFinite(before.delta.mean) && typeof after?.delta?.mean === "number" && Number.isFinite(after.delta.mean) && after.delta.mean < before.delta.mean; }); return improved.length === ids.length ? { campaign_id: later.campaign_id, completed_at: later.completed_at, evidence_locator: "campaigns/" + later.campaign_id + "/benchmark.json#quality_conditioned_efficiency", ...later._snapshot_hashes, execution_evidence_sha256: later.execution_evidence_sha256, improved_metric_ids: improved } : null; }
const locatorKey = (x) => x.artifact + "\0" + x.selector + "\0" + x.sha256;
export function analyzeInstructionEfficiency(input) {
    const rejected = [], accepted = [], seen = new Set(), current = input.current_campaign, root = typeof input.workspace_root === "string" ? resolve(input.workspace_root) : "", skillRoot = typeof input.skill_root === "string" ? resolve(input.skill_root) : "", { stratum: currentStratum, map } = metricMap(current);
    const members = Array.isArray(current?.aggregate_membership) ? current.aggregate_membership : [], memberKeys = members.map(x => x?.artifact_root).filter(Boolean);
    const campaignValid = campaignId(current?.campaign_id) && finiteDate(current?.completed_at) && isSha(current?.skill_source_sha256) && isSha(current?.eval_plan_sha256) && isSha(current?.execution_evidence_sha256) && members.length > 0 && new Set(memberKeys).size === members.length && members.every(x => memberValid(x, current)) && currentStratum && currentStratum.quality?.availability?.available === true && currentStratum.quality?.regressed === false;
    for (const raw of Array.isArray(input.observations) ? input.observations : []) {
        const sourceId = plain(raw?.id, 120) ? raw.id : "invalid";
        let reason = "";
        const resolved = campaignValid && Array.isArray(raw?.evidence_locators) ? raw.evidence_locators.map(x => evidence(x, root, current)) : [], locators = [...new Map(resolved.filter((x) => x !== null).map(x => [locatorKey(x), x])).values()].sort((a, b) => locatorKey(a).localeCompare(locatorKey(b))), predicates = [...new Set(locators.flatMap(observedPredicates))].sort(), derived = derive(predicates), metricIds = Array.isArray(raw?.affected_metric_ids) ? [...new Set(raw.affected_metric_ids.filter(x => typeof x === "string"))].sort() : [], normalizedTarget = skillRoot ? target(raw.target, skillRoot) : null;
        if (!campaignValid)
            reason = "current campaign immutable identity and validated aggregate membership are required";
        else if (!derived)
            reason = "observable predicates do not support a closed taxonomy class";
        else if (!Array.isArray(raw.observable_predicates) || raw.observable_predicates.some(x => !predicates.includes(x)))
            reason = "claimed predicates are not supported by bounded artifact fields";
        else if (raw?.requested_classification !== derived)
            reason = "requested classification is not supported by the observable predicates";
        else if (raw.statement !== TEMPLATES[derived])
            reason = "observation statement must use the closed non-causal template for the derived class";
        else if (!resolved.length || resolved.some(x => x === null))
            reason = "evidence must resolve to a stable digest-bound artifact in the current validated campaign aggregate";
        else if (!metricIds.length)
            reason = "at least one affected observed metric is required";
        else if (metricIds.some(id => { const m = map.get(id); return !m || m.taxonomy?.downstream_savings_eligible !== true || m.availability?.available !== true || typeof m.delta?.mean !== "number" || !Number.isFinite(m.delta.mean) || m.delta.mean >= 0; }))
            reason = "affected metrics must show taxonomy-eligible quality-conditioned efficiency improvement";
        else if (!normalizedTarget)
            reason = "target must resolve to a regular contained current Skill heading or a substantive action-and-object omission with insertion heading";
        else if (!new Set(["low", "medium", "high"]).has(raw.confidence))
            reason = "confidence is invalid";
        if (reason) {
            rejected.push({ observation_id: sourceId, reason });
            continue;
        }
        const classification = derived, acceptedTarget = normalizedTarget, publicLocators = locators.map(({ data, ...x }) => x), canonical = JSON.stringify({ classification, predicates: [...new Set(raw.observable_predicates)].sort(), locators: publicLocators, metricIds, target: acceptedTarget, confidence: raw.confidence }), stableId = "instruction-efficiency-" + createHash("sha256").update(canonical).digest("hex").slice(0, 20);
        if (seen.has(stableId))
            continue;
        seen.add(stableId);
        const later = (Array.isArray(input.confirmation_campaigns) ? [...input.confirmation_campaigns] : []).filter(c => c && typeof c === "object").sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at) || String(a.campaign_id).localeCompare(String(b.campaign_id))).map(c => confirmation(root, current, c, metricIds)).find(Boolean) ?? null, targetText = acceptedTarget.kind === "omission" ? acceptedTarget.missing_behavior + " at " + acceptedTarget.insertion_location : acceptedTarget.locator;
        accepted.push({ id: stableId, source_observation_ids: [sourceId], classification, priority: PRIORITY.indexOf(classification) + 1, observation: { statement: TEMPLATES[classification], observable_predicates: predicates, evidence_locators: publicLocators }, hypothesis: { statement: "The observed " + classification.replaceAll("_", " ") + " pattern may be associated with avoidable work in the affected metrics.", causal: false, private_reasoning_claimed: false }, recommendation: { statement: "Consider a bounded revision for " + targetText + ".", target: acceptedTarget, affected_observed_metrics: metricIds.map(id => { const m = map.get(id); return { id, current_delta_mean: m.delta.mean, unit: m.unit, taxonomy: m.taxonomy, evidence_locator: "benchmark.json#quality_conditioned_efficiency/" + current.scenario_id + "/" + id }; }), evidence_locators: publicLocators, confidence: raw.confidence, confirmation_state: later ? "confirmed" : "unconfirmed", confirmation: later, confirmation_rule: "A distinct later compatible canonical final campaign must be no-follow snapshot- and receipt-bound, validate nonempty aggregate membership and execution evidence, preserve metric ID, unit, and taxonomy, keep quality available and non-regressed, and improve every affected paired mean derived from its benchmark." } });
    }
    accepted.sort((a, b) => a.priority - b.priority || a.classification.localeCompare(b.classification) || JSON.stringify(a.recommendation.target).localeCompare(JSON.stringify(b.recommendation.target)) || a.id.localeCompare(b.id));
    return { schema_version: INSTRUCTION_EFFICIENCY_SCHEMA_VERSION, status: accepted.length ? "observed" : rejected.length ? "insufficient_evidence" : "no_observations", scope: "Observable stable digest-bound sanitized artifacts in the current validated campaign aggregate and normalized quality-conditioned paired metrics only; closed templates make no private-reasoning or causal claim.", ordering: "priority poorly routed, missing, ambiguous, redundant, overly general; then target and stable content ID", current_campaign_id: current?.campaign_id, recommendations: accepted, rejected_observations: rejected, refusal: accepted.length ? null : "Insufficient valid bounded evidence; no instruction prescription is produced." };
}
