#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
function isDir(path) { try {
    return statSync(path).isDirectory();
}
catch {
    return false;
} }
function json(path) { try {
    return JSON.parse(readFileSync(path, "utf8"));
}
catch {
    return null;
} }
function categorize(text) {
    const value = text.toLowerCase();
    if (/trigger|activate|route|select|description/.test(value))
        return { category: "selection", patterns: ["effective-description", "contrastive-boundaries"] };
    if (/coverage|rule space|rule-space|format|version|direction|unsupported construct|edge case|semantic pass|only one case|illustrative case/.test(value))
        return { category: "domain-coverage", patterns: ["rule-rich-domain-coverage", "evaluation-driven-development"] };
    if (/reference|read|navigation|progressive|provider|domain/.test(value))
        return { category: "navigation", patterns: ["progressive-disclosure", "domain-specific-organization", "conditional-details"] };
    if (/step|order|workflow|skip|sequence/.test(value))
        return { category: "workflow", patterns: ["sequential-workflow", "conditional-workflow"] };
    if (/validate|verify|evidence|grading|benchmark|receipt|review/.test(value))
        return { category: "verification", patterns: ["feedback-loop", "verifiable-intermediate-outputs"] };
    if (/script|command|deterministic|repeat/.test(value))
        return { category: "automation", patterns: ["utility-scripts", "solve-dont-defer"] };
    if (/image|visual|layout|render|screenshot/.test(value))
        return { category: "visual", patterns: ["visual-analysis"] };
    if (/delete|remove|migrate|deploy|publish|release|batch|overwrite/.test(value))
        return { category: "risk", patterns: ["plan-validate-execute", "appropriate-degree-of-freedom"] };
    if (/format|template|structure|schema|example/.test(value))
        return { category: "output", patterns: ["template-pattern", "examples-pattern"] };
    if (/tool|dependency|package|mcp|install|runner|browser|network/.test(value))
        return { category: "capability", patterns: ["dependency-and-mcp-guidance", "clear-script-intent"] };
    return { category: "instruction", patterns: ["concise-instructions", "appropriate-degree-of-freedom"] };
}
function runDirectories(workspace) {
    const out = [];
    for (const evalName of readdirSync(workspace).filter(n => n.startsWith("eval-")).sort()) {
        const evalDir = join(workspace, evalName);
        if (!isDir(evalDir))
            continue;
        for (const configuration of readdirSync(evalDir).filter(n => /with_skill|old_skill|without_skill/.test(n)).sort()) {
            const configDir = join(evalDir, configuration);
            if (!isDir(configDir))
                continue;
            const runs = readdirSync(configDir).filter(n => /^run-\d+$/.test(n) && isDir(join(configDir, n))).sort();
            for (const run of runs.length ? runs.map(n => join(configDir, n)) : [configDir])
                out.push({ evalName, configuration, run });
        }
    }
    return out;
}
export function analyzeEvaluation(workspaceArg, skillPathArg) {
    const workspace = resolve(workspaceArg), skillPath = resolve(skillPathArg), failures = [], uncertainty = [], navigation = [];
    if (!isDir(workspace))
        throw new TypeError(`evaluation workspace not found: ${workspace}`);
    if (!existsSync(join(skillPath, "SKILL.md")))
        throw new TypeError(`SKILL.md not found: ${skillPath}`);
    const runs = runDirectories(workspace), usableRuns = new Set();
    for (const item of runs) {
        const grading = json(join(item.run, "grading.json"));
        const expectations = Array.isArray(grading?.expectations) ? grading.expectations : [];
        const rate = grading?.summary?.pass_rate;
        if (expectations.length > 0 && typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1 &&
            !(grading?.summary?.inconclusive > 0 || grading?.summary?.unavailable > 0) &&
            expectations.every((e) => e && (grading.schema_version === 2 ? e.verdict === "pass" || e.verdict === "fail" : e.verdict === "pass" || e.verdict === "fail" || (e.verdict === undefined && typeof e.passed === "boolean"))))
            usableRuns.add(resolve(item.run));
        for (const expectation of expectations) {
            if (expectation?.verdict === "inconclusive" || expectation?.verdict === "unavailable") {
                uncertainty.push({ eval: item.evalName, configuration: item.configuration, assertion: String(expectation.text ?? ""), verdict: expectation.verdict, advice: expectation.verdict === "inconclusive" ? "Review bound evidence without a winner or instruction-repair claim." : "Recover unavailable grading; do not infer task failure or regenerate task execution automatically." });
                continue;
            }
            if (!(expectation?.verdict === "fail" || (grading.schema_version !== 2 && expectation?.verdict === undefined && expectation?.passed === false)))
                continue;
            const assertion = String(expectation.text ?? ""), evidence = String(expectation.evidence ?? ""), mapped = categorize(assertion + " " + evidence);
            failures.push({ eval: item.evalName, configuration: item.configuration, assertion, evidence, category: mapped.category, recommended_patterns: mapped.patterns });
        }
        const metadata = json(join(workspace, item.evalName, "eval_metadata.json")), expected = metadata?.navigation_expectations;
        if (expected && (expected.must_read?.length || expected.read_when_relevant?.length || expected.must_not_read?.length)) {
            const actual = json(join(item.run, "navigation.json")) ?? json(join(item.run, "outputs", "navigation.json"));
            if (!actual)
                navigation.push({ eval: item.evalName, configuration: item.configuration, status: "unavailable", message: "Navigation expectations exist but navigation.json was not captured." });
            else {
                const read = new Set(Array.isArray(actual.read) ? actual.read : []), missed = (expected.must_read ?? []).filter((p) => !read.has(p)), forbidden = (expected.must_not_read ?? []).filter((p) => read.has(p));
                navigation.push({ eval: item.evalName, configuration: item.configuration, status: missed.length || forbidden.length ? "warning" : "pass", message: missed.length || forbidden.length ? `missed: ${missed.join(", ") || "none"}; unexpectedly read: ${forbidden.join(", ") || "none"}` : "Navigation expectations satisfied." });
            }
        }
    }
    const counts = new Map();
    for (const failure of failures)
        for (const pattern of failure.recommended_patterns)
            counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    const recommendations = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([pattern, count]) => ({ pattern, count, action: `Review ${pattern} against the cited failures and apply the smallest correction.` }));
    const benchmark = json(join(workspace, "benchmark.json")), current = benchmark?.run_summary?.with_skill?.pass_rate?.mean ?? null, baselineKey = Object.keys(benchmark?.run_summary ?? {}).find(k => k.includes("old_skill") || k.includes("without_skill")), baseline = baselineKey ? benchmark.run_summary[baselineKey]?.pass_rate?.mean ?? null : null;
    const sampling = benchmark?.run_summary?.delta?.sampling, decisionEvidence = benchmark?.decision_evidence;
    // Acceptance requires affirmative membership and usable grading for every paired arm,
    // not just numeric summaries or whatever run directories happened to be found.
    let requiredRuns = [];
    let membershipComplete = sampling?.complete === true && decisionEvidence?.terminal === true;
    if (decisionEvidence?.mode === "fixed") {
        const scenarios = sampling?.scenario_weights, rounds = sampling?.planned_rounds;
        membershipComplete = membershipComplete && Array.isArray(scenarios) && scenarios.length > 0 &&
            scenarios.every((s) => typeof s?.scenario_id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.scenario_id)) &&
            new Set(scenarios.map((s) => s.scenario_id)).size === scenarios.length &&
            Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 1024 && sampling.complete_rounds === rounds &&
            Array.isArray(sampling.missing_quality) && sampling.missing_quality.length === 0 && Boolean(baselineKey);
        if (membershipComplete)
            requiredRuns = scenarios.flatMap((s) => Array.from({ length: rounds }, (_, i) => [join(workspace, "eval-" + s.scenario_id, "with_skill", "run-" + (i + 1)), join(workspace, "eval-" + s.scenario_id, baselineKey, "run-" + (i + 1))]).flat());
    }
    else if (decisionEvidence?.mode === "adaptive") {
        const pairs = decisionEvidence.counted_membership;
        membershipComplete = membershipComplete && Array.isArray(pairs) && pairs.length > 0 &&
            Array.isArray(decisionEvidence.scenario_weights) && decisionEvidence.scenario_weights.length > 0 &&
            Number.isSafeInteger(decisionEvidence.sample_count) && decisionEvidence.sample_count > 0 &&
            pairs.length === decisionEvidence.sample_count * decisionEvidence.scenario_weights.length && pairs.every((p) => typeof p?.candidate_run === "string" && typeof p?.baseline_run === "string" &&
            typeof p.scenario_id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.scenario_id) &&
            p.candidate_run === `eval-${p.scenario_id}/with_skill/run-${p.pair_index}` &&
            p.baseline_run === `eval-${p.scenario_id}/${baselineKey}/run-${p.pair_index}` &&
            Number.isSafeInteger(p.pair_index) && p.pair_index > 0);
        if (membershipComplete) {
            const ids = decisionEvidence.scenario_weights.map((s) => s.id);
            membershipComplete = new Set(ids).size === ids.length && ids.every((id) => typeof id === "string" && Array.from({ length: decisionEvidence.sample_count }, (_, i) => pairs.filter((p) => p.scenario_id === id && p.pair_index === i + 1).length === 1).every(Boolean));
        }
        if (membershipComplete)
            requiredRuns = pairs.flatMap((p) => [resolve(workspace, p.candidate_run), resolve(workspace, p.baseline_run)]);
    }
    else
        membershipComplete = false;
    const gradingComplete = requiredRuns.length > 0 && new Set(requiredRuns).size === requiredRuns.length && requiredRuns.every(run => usableRuns.has(resolve(run)));
    const missingQuality = !benchmark || typeof current !== "number" || !Number.isFinite(current) || current < 0 || current > 1 || typeof baseline !== "number" || !Number.isFinite(baseline) || baseline < 0 || baseline > 1 || uncertainty.length > 0 || !membershipComplete || !gradingComplete;
    const historical = Boolean(decisionEvidence?.mode === "fixed" && decisionEvidence?.method_version === "legacy");
    const pairedDelta = benchmark?.run_summary?.delta?.paired?.pass_rate?.mean;
    const qualityDelta = missingQuality ? null : typeof pairedDelta === "number" && Number.isFinite(pairedDelta) ? pairedDelta : typeof current === "number" && typeof baseline === "number" ? current - baseline : null;
    const completed = [...(benchmark ? ["benchmark"] : []), ...(existsSync(join(workspace, "review.html")) ? ["review viewer"] : [])], unavailable = navigation.filter(n => n.status === "unavailable").map(n => n.message), blocked = [...(missingQuality ? ["fixed or adaptive quality membership or usable grading incomplete; no winner claim"] : []), ...(historical ? ["historical fixed statistics retained without reinterpretation; use a new authorized campaign"] : []), ...(!benchmark ? ["benchmark missing"] : []), ...(!existsSync(join(workspace, "review.html")) ? ["review viewer missing"] : [])];
    return { schema_version: "1.0", artifact: "evaluation-analysis", status: blocked.length ? "blocked" : "complete", workspace, skill_path: skillPath, evidence: { completed, unavailable, blocked }, benchmark: { current, baseline, delta: qualityDelta, sampling: sampling ?? null, decision_evidence: decisionEvidence ?? null }, failures, uncertainty, navigation, pattern_review: { recommended: recommendations }, decision: failures.length ? "revise" : missingQuality || historical ? "inconclusive" : "accept" };
}
export function main() { try {
    const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { "skill-path": { type: "string" }, output: { type: "string", short: "o" } } });
    if (!positionals[0] || !values["skill-path"])
        throw new TypeError("usage: analyze_evaluation.js <workspace> --skill-path <dir> [-o analysis.json]");
    const result = analyzeEvaluation(positionals[0], values["skill-path"]), text = JSON.stringify(result, null, 2) + "\n";
    if (values.output) {
        mkdirSync(dirname(resolve(values.output)), { recursive: true });
        writeFileSync(resolve(values.output), text);
    }
    console.log(text.trim());
    process.exit(result.status === "blocked" ? 3 : 0);
}
catch (error) {
    console.error(`analyze_evaluation: ${error.message}`);
    process.exit(2);
} }
const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (!import.meta.url.includes("/$bunfs/") && invoked && fileURLToPath(import.meta.url) === invoked)
    main();
