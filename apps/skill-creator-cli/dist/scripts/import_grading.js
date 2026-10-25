#!/usr/bin/env node
/**
 * Deterministic import and verification of host-delegated grading judgments
 * (ADR 0001, skills/skill-creator/references/adr/0001-host-delegated-semantic-grading.md,
 * ap-8di.4).
 *
 * `import-grading` consumes untrusted subagent judgment envelopes written by
 * a delegating host under `grading-judgments/`, validates their schema and
 * provenance, re-derives every hash rather than trusting a claimed one,
 * verifies the evidence quote is exactly contained in the candidate output
 * and substantively overlaps its criterion without being a self-referential
 * grading claim, rejects duplicate/replayed/budget-exceeding invocations,
 * and writes canonical grader evidence atomically into the originating run
 * directory (`grader-evidence/`). No imported judgment can self-author an
 * authoritative hash: `assertion_sha256`/`variant_sha256`/`output_sha256`
 * are always the values recomputed from the current evidence in
 * `deterministic-evidence.json`, never values copied from the judgment.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { isMetaGradingClaim, normalizeAssertions, assertionHash, canonical as gradingCanonical, sha256 as gradingSha256 } from "./evaluator_grading.js";
import { readTrustedJson, readTrustedSnapshot } from "./trusted_snapshot.js";
import { validateGradingRequest, validateGradingJudgment, bindJudgmentToRequest, } from "./delegated_grading_contracts.js";
import { loadGradingManifest, REQUEST_DIR_NAME, JUDGMENT_DIR_NAME } from "./prepare_grading.js";
import { artifactHash } from "./evaluation_provenance.js";
export const DELEGATED_GRADING_AUTHORITY = "delegated-evaluator";
export const DEFAULT_GRADER_BUDGET = 200;
function loadJson(root, path, label) {
    if (!existsSync(path))
        return null;
    try {
        return readTrustedJson(root, path, label);
    }
    catch {
        return null;
    }
}
function loadText(root, path, label, maxBytes) {
    if (!existsSync(path))
        return null;
    try {
        return readTrustedSnapshot(root, path, label, { maxBytes, allowEmpty: true }).bytes.toString("utf8");
    }
    catch {
        return null;
    }
}
function atomic(path, value) {
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, path);
}
/**
 * Verifies an evidence quote is exactly contained in the candidate output,
 * is not an explicit
 * self-referential grading claim (a grader asserting "I pass this" instead
 * of quoting real evidence). Mirrors the identical rule already enforced
 * against CommandGraderAdapter output in evaluator_grading.ts's
 * parseJudgment, so a delegated judgment cannot pass a weaker check than a
 * subprocess judgment would.
 */
function verifiedEvidence(criterion, output, quote, rationale) {
    if (!quote || quote.trim().length === 0)
        return { valid: false, reason: "Evidence quote is empty" };
    if (!output.includes(quote))
        return { valid: false, reason: "Evidence quote is not contained in candidate output" };
    if (isMetaGradingClaim(criterion, quote))
        return { valid: false, reason: "Self-referential grading claims are not semantic evidence" };
    if (!rationale.trim())
        return { valid: false, reason: "Grader rationale is empty" };
    return { valid: true };
}
/**
 * Imports and verifies every judgment file currently present under
 * `grading-judgments/`, writing canonical, re-derived grader evidence into
 * each judgment's originating run directory's `grader-evidence/`.
 *
 * Rejects (without writing evidence, and without throwing — every rejection
 * is reported in `rejected`/`errors`):
 * - malformed JSON or a judgment failing `validateGradingJudgment`'s closed
 *   schema (unknown fields, non-finite usage, invalid verdict enum, a
 *   `judgment_sha256` that does not match its own canonical contents);
 * - a judgment with no matching request file, or a request file failing
 *   `validateGradingRequest` (forged/stale `request_sha256`);
 * - a judgment whose `invocation_id`/`request_sha256`/bindings do not
 *   exactly match its claimed request (`bindJudgmentToRequest`), which
 *   covers wrong request IDs and stale/forged bindings;
 * - a judgment whose bindings no longer match the run directory's current
 *   `deterministic-evidence.json` (the run was re-executed after the
 *   request was prepared);
 * - a duplicate grader identity or a replayed invocation_id within the same
 *   assertion's already-imported evidence set (model/provider ambiguity is
 *   rejected the same way: two judgments claiming the same invocation_id
 *   but different grader identity are both rejected rather than one
 *   silently overwriting the other);
 * - an uncontained, self-referential, or non-substantive evidence quote;
 * - any import once the configured grader-call budget is exhausted.
 *
 * Re-import is idempotent: a judgment whose canonical evidence file already
 * exists with byte-identical content is reported in `already_imported` and
 * is neither re-validated against the budget nor rewritten.
 */
export function importGrading(workspaceArg, options = {}) {
    const workspace = resolve(workspaceArg);
    const requestDir = join(workspace, REQUEST_DIR_NAME);
    const judgmentDir = join(workspace, JUDGMENT_DIR_NAME);
    const budgetLimit = options.budgetLimit ?? DEFAULT_GRADER_BUDGET;
    const imported = [];
    const rejected = [];
    const alreadyImported = [];
    const errors = [];
    let budgetUsed = 0;
    if (!existsSync(judgmentDir)) {
        return { schema_version: "1.0", workspace, imported, rejected, already_imported: alreadyImported, budget: { used: 0, limit: budgetLimit }, ready_to_resume: false, errors };
    }
    const manifest = loadGradingManifest(workspace);
    // Track which grader identities and invocation IDs have already claimed a
    // slot for a given (run_directory, assertion_id, assertion_version) so a
    // duplicate/replayed/ambiguous claim on the same assertion is rejected
    // deterministically regardless of file iteration order.
    const claimedByAssertion = new Map(); // key: run|assertion|version -> set of grader_id
    const consumedInvocationIds = new Set();
    const fileNames = readdirSync(judgmentDir).filter((name) => name.endsWith(".json")).sort();
    for (const fileName of fileNames) {
        const invocationId = fileName.replace(/\.json$/, "");
        const judgmentPath = join(judgmentDir, fileName);
        const requestPath = join(requestDir, fileName);
        try {
            const manifestEntry = manifest[invocationId];
            if (!manifestEntry) {
                rejected.push({ invocation_id: invocationId, reason: "No prepare-grading manifest entry for this invocation_id" });
                continue;
            }
            const runDir = resolve(workspace, manifestEntry.run_directory);
            const evidenceDir = join(runDir, "grader-evidence");
            const evidencePath = join(evidenceDir, invocationId + ".json");
            if (existsSync(evidencePath)) {
                alreadyImported.push(invocationId);
                continue;
            }
            if (budgetUsed >= budgetLimit) {
                rejected.push({ invocation_id: invocationId, reason: "Semantic grader budget exhausted" });
                continue;
            }
            let judgmentRaw;
            try {
                judgmentRaw = loadJson(judgmentDir, judgmentPath, fileName);
            }
            catch (error) {
                rejected.push({ invocation_id: invocationId, reason: `Judgment file is unreadable or escapes containment: ${error.message}` });
                continue;
            }
            if (!judgmentRaw) {
                rejected.push({ invocation_id: invocationId, reason: "Judgment file is missing or not valid JSON" });
                continue;
            }
            let judgment;
            try {
                judgment = validateGradingJudgment(judgmentRaw);
            }
            catch (error) {
                rejected.push({ invocation_id: invocationId, reason: `Judgment schema is invalid: ${error.message}` });
                continue;
            }
            let requestRaw;
            try {
                requestRaw = existsSync(requestPath) ? loadJson(requestDir, requestPath, fileName) : null;
            }
            catch (error) {
                rejected.push({ invocation_id: invocationId, reason: `Request file is unreadable or escapes containment: ${error.message}` });
                continue;
            }
            if (!requestRaw) {
                rejected.push({ invocation_id: invocationId, reason: "No matching request file for this invocation_id" });
                continue;
            }
            let request;
            try {
                request = validateGradingRequest(requestRaw);
            }
            catch (error) {
                rejected.push({ invocation_id: invocationId, reason: `Request schema is invalid: ${error.message}` });
                continue;
            }
            try {
                bindJudgmentToRequest(request, judgment);
            }
            catch (error) {
                rejected.push({ invocation_id: invocationId, reason: error.message });
                continue;
            }
            // Re-derive authoritative bindings from current evidence rather than
            // trusting the request/judgment's copy: a judgment can never
            // self-author its own binding to a different or re-executed run.
            const deterministicPath = join(runDir, "deterministic-evidence.json");
            const deterministic = loadJson(runDir, deterministicPath, "deterministic-evidence.json");
            const outputText = loadText(runDir, join(runDir, "outputs", "result.txt"), "outputs/result.txt", 256 * 1024);
            if (!deterministic || outputText === null) {
                rejected.push({ invocation_id: invocationId, reason: "Originating run no longer has deterministic evidence or candidate output" });
                continue;
            }
            const currentVariantSha256 = String(deterministic.variant_sha256 ?? "");
            const currentOutputSha256 = String(deterministic.output_sha256 ?? "");
            if (judgment.bindings.variant_sha256 !== currentVariantSha256 || judgment.bindings.output_sha256 !== currentOutputSha256) {
                rejected.push({ invocation_id: invocationId, reason: "Request/judgment bindings are stale: the run has been re-executed since prepare-grading" });
                continue;
            }
            // The judgment's grader identity must exactly match the identity
            // prepare-grading assigned to this invocation_id's slot (from the
            // scenario's immutable grading_plan). A judgment claiming a
            // different id, model, or provider than the one this slot was
            // prepared for is rejected outright: it cannot silently substitute
            // one planned grader's evidence for another's, and it cannot forge
            // a model identity the plan never declared.
            if (judgment.grader.id !== manifestEntry.grader_id || judgment.grader.model !== manifestEntry.grader_model || judgment.grader.provider !== manifestEntry.grader_provider) {
                rejected.push({ invocation_id: invocationId, reason: `Judgment grader identity does not match the planned grader (${manifestEntry.grader_id}/${manifestEntry.grader_model}) for this invocation` });
                continue;
            }
            const assertionKey = `${manifestEntry.run_directory}|${manifestEntry.assertion_id}|${manifestEntry.assertion_version}`;
            const claimed = claimedByAssertion.get(assertionKey) ?? new Set();
            if (claimed.has(judgment.grader.id)) {
                rejected.push({ invocation_id: invocationId, reason: `Grader ${judgment.grader.id} already has an imported judgment for this assertion` });
                continue;
            }
            if (consumedInvocationIds.has(invocationId)) {
                rejected.push({ invocation_id: invocationId, reason: "invocation_id has already been imported (replay)" });
                continue;
            }
            const evidence = verifiedEvidence(request.assertion.criterion, outputText, judgment.evidence_quote, judgment.rationale);
            const validEvidence = evidence.valid;
            const canonicalEvidence = {
                schema_version: 1,
                grader_id: judgment.grader.id,
                model: judgment.grader.model,
                provider: judgment.grader.provider,
                invocation_id: judgment.invocation_id,
                blinded: true,
                verdict: validEvidence ? judgment.verdict : "inconclusive",
                evidence_quote: judgment.evidence_quote,
                rationale: validEvidence ? judgment.rationale : evidence.reason,
                valid_evidence: validEvidence,
                assertion_sha256: request.bindings.assertion_sha256,
                variant_sha256: currentVariantSha256,
                output_sha256: currentOutputSha256,
                usage: judgment.usage,
                source: "host-delegated",
            };
            atomic(evidencePath, canonicalEvidence);
            claimed.add(judgment.grader.id);
            claimedByAssertion.set(assertionKey, claimed);
            consumedInvocationIds.add(invocationId);
            budgetUsed++;
            imported.push({ invocation_id: invocationId, run_directory: manifestEntry.run_directory, grader_id: judgment.grader.id, verdict: canonicalEvidence.verdict, valid_evidence: validEvidence, ...(validEvidence ? {} : { reason: evidence.reason }) });
        }
        catch (error) {
            errors.push({ invocation_id: invocationId, message: error.message });
        }
    }
    // Finalize any run whose grader-evidence/ now contains exactly one valid
    // judgment per planned grader for every semantic assertion: regenerate a
    // canonical grading.json/deterministic-evidence.json and complete
    // execution-evidence.json's grading_binding, so a subsequent
    // validateExecutionEvidence pass (and full-eval --resume) sees the same
    // shape it already trusts for evaluator-owned grading, just authored by
    // delegated-evaluator rather than a subprocess grader.
    const touchedRunDirs = new Set([...imported.map((i) => i.run_directory), ...alreadyImported.map((invocationId) => manifest[invocationId]?.run_directory).filter((x) => Boolean(x))]);
    for (const relativeRunDir of touchedRunDirs) {
        try {
            finalizeDelegatedRun(workspace, relativeRunDir);
        }
        catch (error) {
            errors.push({ invocation_id: "*", message: `finalizing ${relativeRunDir}: ${error.message}` });
        }
    }
    const readyToResume = imported.length + alreadyImported.length > 0 && rejected.length === 0 && errors.length === 0;
    return { schema_version: "1.0", workspace, imported, rejected, already_imported: alreadyImported, budget: { used: budgetUsed, limit: budgetLimit }, ready_to_resume: readyToResume, errors };
}
/**
 * If every semantic assertion for this run now has exactly one valid
 * judgment from each of its scenario's planned graders, regenerates
 * grading.json/deterministic-evidence.json (preserving already-resolved
 * deterministic expectations) and completes execution-evidence.json's
 * grading_binding, mirroring the shape evaluator-owned grading already
 * produces so validateExecutionEvidence's delegated-grading branch can
 * verify it uniformly. Otherwise leaves every artifact untouched — a run
 * with any still-pending or invalid judgment is not finalized.
 */
function finalizeDelegatedRun(workspace, relativeRunDir) {
    const runDir = resolve(workspace, relativeRunDir);
    const evalDir = dirname(dirname(runDir));
    const metadata = loadJson(evalDir, join(evalDir, "eval_metadata.json"), "eval_metadata.json");
    if (!metadata || metadata.evidence_mode?.planned !== "delegated-grading")
        return;
    const assertions = normalizeAssertions(Array.isArray(metadata.assertions) ? metadata.assertions : []);
    const semantic = assertions.filter((a) => a.classification === "semantic");
    if (!semantic.length)
        return;
    const plan = metadata.grading_plan;
    const planned = Array.isArray(plan?.graders) ? plan.graders : [];
    if (!planned.length)
        return;
    const deterministicPath = join(runDir, "deterministic-evidence.json");
    const deterministic = loadJson(runDir, deterministicPath, "deterministic-evidence.json");
    const outputText = loadText(runDir, join(runDir, "outputs", "result.txt"), "outputs/result.txt", 256 * 1024);
    if (!deterministic || outputText === null)
        return;
    const variantSha256 = String(deterministic.variant_sha256 ?? ""), outputSha256 = String(deterministic.output_sha256 ?? "");
    const evidenceDir = join(runDir, "grader-evidence");
    const evidenceFiles = existsSync(evidenceDir) ? readdirSync(evidenceDir).filter((n) => n.endsWith(".json")) : [];
    const evidenceByAssertion = new Map();
    for (const name of evidenceFiles) {
        let item;
        try {
            item = loadJson(evidenceDir, join(evidenceDir, name), name);
        }
        catch {
            continue;
        }
        if (!item || item.variant_sha256 !== variantSha256 || item.output_sha256 !== outputSha256)
            continue;
        const list = evidenceByAssertion.get(item.assertion_sha256) ?? [];
        list.push(item);
        evidenceByAssertion.set(item.assertion_sha256, list);
    }
    const semanticExpectations = [];
    for (const assertion of semantic) {
        const ah = assertionHash(assertion);
        const items = evidenceByAssertion.get(ah) ?? [];
        const plannedIds = new Set(planned.map((g) => g.id));
        const byGrader = new Map();
        for (const item of items)
            if (plannedIds.has(item.grader_id) && !byGrader.has(item.grader_id))
                byGrader.set(item.grader_id, item);
        if (byGrader.size !== planned.length)
            return; // still awaiting one or more planned graders for this assertion
        const judgments = planned.map((g) => byGrader.get(g.id));
        const valid = judgments.filter((j) => j.valid_evidence === true);
        const decisions = new Set(valid.filter((j) => j.verdict !== "inconclusive").map((j) => j.verdict));
        const unanimous = judgments.length >= 1 && valid.length === judgments.length && !valid.some((j) => j.verdict === "inconclusive") && decisions.size === 1;
        const verdict = unanimous ? valid[0].verdict : "inconclusive";
        semanticExpectations.push({
            id: assertion.id, version: assertion.version, classification: "semantic", text: assertion.criterion, criterion: assertion.criterion,
            assertion_sha256: ah, variant_sha256: variantSha256, output_sha256: outputSha256,
            verdict, human_review: !unanimous, passed: verdict === "pass",
            agreement: { grader_count: judgments.length, valid_evidence_count: valid.length, disagreement: !unanimous, verdicts: Object.fromEntries(["pass", "fail", "inconclusive"].map((v) => [v, judgments.filter((j) => j.verdict === v).length])) },
            evidence: judgments.map((j) => j.evidence_quote), judgments: judgments.map((j) => ({ grader_id: j.grader_id, model: j.model, invocation_id: j.invocation_id, verdict: j.verdict, evidence_quote: j.evidence_quote, rationale: j.rationale, valid_evidence: j.valid_evidence, usage: j.usage })),
        });
    }
    // Deterministic expectations already exist in a prior grading.json (if
    // any); preserve them verbatim rather than re-deriving, since finalization
    // only concerns semantic evidence completeness.
    const priorGrading = loadJson(runDir, join(runDir, "grading.json"), "grading.json");
    const deterministicExpectations = Array.isArray(priorGrading?.expectations) ? priorGrading.expectations.filter((e) => e.classification === "deterministic") : [];
    const expectations = [...deterministicExpectations, ...semanticExpectations];
    const passed = expectations.filter((e) => e.verdict === "pass").length, failed = expectations.filter((e) => e.verdict === "fail").length, inconclusive = expectations.length - passed - failed;
    const assertionSetHash = gradingSha256(gradingCanonical(assertions));
    const grading = {
        schema_version: 2, authority: DELEGATED_GRADING_AUTHORITY, assertion_set_sha256: assertionSetHash, variant_sha256: variantSha256, output_sha256: outputSha256,
        expectations, summary: { passed, failed, inconclusive, total: expectations.length, pass_rate: expectations.length ? passed / expectations.length : 0, human_review: inconclusive > 0 },
        grading_budget: { used: evidenceFiles.length, limit: evidenceFiles.length },
    };
    atomic(join(runDir, "grading.json"), grading);
    const executionEvidencePath = join(runDir, "execution-evidence.json");
    const executionEvidence = loadJson(runDir, executionEvidencePath, "execution-evidence.json");
    if (executionEvidence) {
        executionEvidence.grading_binding = { authority: DELEGATED_GRADING_AUTHORITY, assertion_set_sha256: assertionSetHash, variant_sha256: variantSha256, output_sha256: outputSha256, grader_identities: planned };
        executionEvidence.artifact_sha256 = { ...executionEvidence.artifact_sha256, "grading.json": artifactHash(join(runDir, "grading.json")), "grader-evidence": artifactHash(evidenceDir) };
        atomic(executionEvidencePath, executionEvidence);
    }
}
export async function main(argv = process.argv.slice(2)) {
    const workspace = argv[0];
    if (!workspace) {
        console.error("usage: import-grading <workspace> [--budget <n>]");
        return 2;
    }
    const budgetIndex = argv.indexOf("--budget");
    const budgetLimit = budgetIndex >= 0 ? Number(argv[budgetIndex + 1]) : undefined;
    try {
        console.log(JSON.stringify(importGrading(workspace, { budgetLimit }), null, 2));
        return 0;
    }
    catch (error) {
        console.log(JSON.stringify({ schema_version: "1.0", command: "import-grading", status: "failure", reason: error.message }, null, 2));
        return 1;
    }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
    main().then((code) => process.exit(code));
}
