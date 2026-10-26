/** Export candidate inputs only. No runner, model call, grading or execution receipt. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { artifactHash, compositeHash, expectedRunDirs, runCoordinates } from "./evaluation_provenance.js";
import { readTrustedJson, readTrustedSnapshot, captureTrustedArtifact } from "./trusted_snapshot.js";
import { sourceHash } from "./verify_skill_gates.js";
import { normalizeAssertions } from "./evaluator_grading.js";
import { taskPath } from "./task_evidence.js";
import { acquireDirectoryLock } from "./durable_file.js";
import { fullEval } from "./full_eval.js";
export const CANDIDATE_REQUEST_PROTOCOL = "host-candidate-request-v1";
const LIMIT_FILES = 8192, LIMIT_BYTES = 128 * 1024 * 1024;
function within(root, path) { const r = relative(root, path); return r === "" || (!isAbsolute(r) && !r.split(sep).includes("..")); }
function plainParents(path) { let current = resolve(path); while (true) {
    if (existsSync(current)) {
        const st = lstatSync(current);
        if (st.isSymbolicLink() || !st.isDirectory())
            throw new TypeError("Output parents must be regular directories");
    }
    const parent = dirname(current);
    if (parent === current)
        break;
    current = parent;
} }
function json(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function writeSnapshot(capture, target, select = () => true) {
    for (const [path, file] of capture.files) {
        if (!select(path))
            continue;
        const output = path ? join(target, taskPath(path)) : target;
        mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
        writeFileSync(output, file.bytes, { flag: "wx", mode: 0o600 });
    }
}
function bounded(captures) { let files = 0, bytes = 0; for (const c of captures)
    for (const f of c.files.values()) {
        if (++files > LIMIT_FILES || (bytes += f.bytes.length) > LIMIT_BYTES)
            throw new TypeError("Preparation snapshot budget exceeded");
    } }
export async function prepareExecution(workspaceArg, destinationArg, options = {}) {
    const workspace = resolve(workspaceArg), destination = resolve(destinationArg);
    plainParents(workspace);
    plainParents(dirname(destination));
    const jobPath = join(workspace, ".full-eval-job.json");
    const job = readTrustedJson(workspace, jobPath, "evaluation job");
    if (job.schema_version !== "2.0" || job.workspace !== workspace || job.decision_policy !== "fixed")
        throw new TypeError("Only a current fixed full-eval scaffold is supported; adaptive execution requires scheduler admission");
    const skill = resolve(job.skill), evalSet = resolve(job.eval_set), baseline = options.baselineSkillPath ? resolve(options.baselineSkillPath) : null;
    if (within(workspace, destination) || within(skill, destination) || (baseline && within(baseline, destination)))
        throw new TypeError("Output must be outside source and evaluation trees");
    if (existsSync(destination) || lstatSync(destination, { throwIfNoEntry: false }))
        throw new TypeError("Output destination already exists; preserve it and choose a new destination");
    const release = await acquireDirectoryLock(join(workspace, ".full-eval-orchestration-lock"), { timeoutMs: 15000, staleMs: 300000 });
    let staging, releaseDestination;
    try {
        releaseDestination = await acquireDirectoryLock(destination + ".preparation-lock", { timeoutMs: 15000, staleMs: 300000 });
        if (existsSync(destination) || lstatSync(destination, { throwIfNoEntry: false }))
            throw new TypeError("Output destination already exists");
        if (job.status === "cancelled" || job.status === "succeeded")
            throw new TypeError("Cancelled or finalized campaigns cannot prepare replacement candidates");
        const jobSnapshot = readTrustedSnapshot(workspace, jobPath, "evaluation job");
        if (JSON.stringify(JSON.parse(jobSnapshot.bytes.toString("utf8"))) !== JSON.stringify(job))
            throw new TypeError("Job changed before preparation");
        const scaffold = job.phases?.find((p) => p.name === "scaffold");
        if (scaffold?.status !== "succeeded" || !scaffold.artifact_hashes)
            throw new TypeError("A successful bound scaffold is required");
        const paths = expectedRunDirs(workspace, true);
        if (!paths.length)
            throw new TypeError("No paired candidate tasks are scheduled");
        const sourceCapture = captureTrustedArtifact(dirname(skill), skill, "Skill source"), baselineCapture = baseline ? captureTrustedArtifact(dirname(baseline), baseline, "Baseline source") : null;
        const source = sourceHash(skill, [evalSet]), evalPlan = artifactHash(evalSet);
        const sourceChecks = [[skill, sourceCapture.sha256], [evalSet, evalPlan]];
        if (baseline && baselineCapture)
            sourceChecks.push([baseline, baselineCapture.sha256]);
        const prepared = paths.map(runDir => {
            if (["execution-evidence.json", "execution-outcome.json", "grading.json"].some(name => existsSync(join(runDir, name))))
                throw new TypeError("Existing execution must be reconciled, never implicitly prepared again");
            const metadataPath = join(dirname(dirname(runDir)), "eval_metadata.json");
            if (scaffold.artifact_hashes[metadataPath] !== artifactHash(metadataPath))
                throw new TypeError("Scaffold metadata drift; preserve campaign and prepare a new one");
            const m = readTrustedJson(workspace, metadataPath, "scenario metadata"), c = runCoordinates(runDir);
            if (m.decision_policy !== "fixed" || m.execution_binding?.skill_source_sha256 !== source || m.execution_binding?.eval_plan_sha256 !== evalPlan)
                throw new TypeError("Source or evaluation plan drift");
            normalizeAssertions(m.assertions);
            if (m.source_bindings?.with_skill !== sourceCapture.sha256)
                throw new TypeError("Skill source binding drift");
            if (c.configuration === "old_skill" && (!baselineCapture || m.source_bindings?.old_skill !== baselineCapture.sha256))
                throw new TypeError("A matching --baseline-skill is required");
            const caps = m.capabilities;
            if (!caps || !["filesystem", "agent_runner", "browser", "network"].every(k => typeof caps[k] === "boolean") || !Array.isArray(caps.tools) || caps.tools.some((x) => typeof x !== "string") || new Set(caps.tools).size !== caps.tools.length)
                throw new TypeError("Invalid declared capabilities");
            const b = m.budget;
            if (!Number.isSafeInteger(b?.max_turns) || b.max_turns <= 0 || !Number.isFinite(b?.timeout_seconds) || b.timeout_seconds <= 0)
                throw new TypeError("Positive frozen execution budget required");
            if (typeof m.prompt !== "string" || !m.prompt || options.model !== undefined && (!options.model || /[\x00-\x1f]/.test(options.model)))
                throw new TypeError("A task prompt and a valid model selector are required");
            if (m.model !== null && m.model !== undefined && (typeof m.model !== "string" || !m.model || /[\x00-\x1f]/.test(m.model) || options.model !== undefined && options.model !== m.model))
                throw new TypeError("Model selector must match the frozen scenario");
            if (!Array.isArray(m.files))
                throw new TypeError("Fixture paths must be an array");
            const fixtures = (m.files ?? []).map((file) => { const target = taskPath(file); if (target.split("/").some((s) => s === ".agents" || s === ".host") || target === "eval_metadata.json" || target === "evals/evals.json")
                throw new TypeError("Fixture conflicts with host or grading state"); const path = join(skill, target); const capture = captureTrustedArtifact(skill, path, "Task fixture"); sourceChecks.push([path, capture.sha256]); return { target, capture }; });
            if (compositeHash(fixtures.flatMap((f) => [f.target, f.capture.sha256])) !== m.fixture_sha256)
                throw new TypeError("Fixture binding drift");
            const variant = c.configuration === "with_skill" ? sourceCapture : c.configuration === "old_skill" ? baselineCapture : null;
            const instructions = variant ? variant.files.get("SKILL.md")?.bytes.toString("utf8") : "";
            if (variant && !instructions)
                throw new TypeError("Variant has no SKILL.md");
            return { runDir, m, c, fixtures, variant, instructions: instructions ?? "", metadataPath, metadataHash: artifactHash(metadataPath) };
        });
        bounded([sourceCapture, ...(baselineCapture ? [baselineCapture] : []), ...prepared.flatMap(p => p.fixtures.map((f) => f.capture))]);
        // Bound the aggregate exported bytes too, not just one source snapshot.
        bounded(prepared.flatMap(p => [...(p.variant ? [{ sha256: p.variant.sha256, files: new Map([...p.variant.files].filter(([path]) => !path.startsWith("evals/") && !path.startsWith(".agents/") && !path.startsWith(".host/") && path !== "eval_metadata.json")) }] : []), ...p.fixtures.map((f) => f.capture)]));
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        staging = mkdtempSync(join(dirname(destination), ".prepare-execution-"));
        const requests = [], bindings = [];
        for (const p of prepared) {
            const requestId = "candidate-" + randomUUID(), packetRoot = join(staging, requestId), cwd = join(packetRoot, "workspace"), finalCwd = join(destination, requestId, "workspace");
            mkdirSync(cwd, { recursive: true, mode: 0o700 });
            if (p.variant)
                writeSnapshot(p.variant, join(cwd, ".agents", "skills", basename(skill)), path => !path.startsWith("evals/") && !path.startsWith(".agents/") && !path.startsWith(".host/") && path !== "eval_metadata.json" && path !== "eval.json");
            for (const f of p.fixtures)
                writeSnapshot(f.capture, join(cwd, f.target));
            mkdirSync(join(cwd, "outputs"), { recursive: true, mode: 0o700 });
            const request = { protocol: CANDIDATE_REQUEST_PROTOCOL, request_id: requestId, working_directory: finalCwd, prompt: p.m.prompt, instructions: p.instructions, model: options.model ?? p.m.model ?? null, reasoning: p.m.reasoning ?? null, tools: p.m.capabilities.tools, capabilities: p.m.capabilities, budget: { max_turns: p.m.budget.max_turns, timeout_seconds: p.m.budget.timeout_seconds }, constraints: { instruction_exposure: p.variant ? "direct-injection-not-activation" : "no-target-skill-injected", ambient_context: "Host discovery and filesystem isolation are not proven; do not read parent campaign or other packets", enforcement: "Budgets/tools are requested constraints, not verified host enforcement", write_scope: "Write only inside this working_directory; return the final task response, never grade yourself" } };
            const packetPath = join(packetRoot, "request.json");
            json(packetPath, request);
            requests.push({ request_id: requestId, request_path: join(destination, requestId, "request.json"), working_directory: finalCwd });
            bindings.push({ request_id: requestId, request_sha256: hash(Buffer.from(JSON.stringify(request, null, 2) + "\n")), run_directory: relative(workspace, p.runDir).replaceAll("\\", "/"), metadata_sha256: p.metadataHash, execution_binding: p.m.execution_binding, configuration: p.c.configuration, run_index: p.c.run_index, schedule: p.m.execution_schedule.find((s) => s.pair_index === p.c.run_index), model: request.model, workspace_sha256: artifactHash(cwd) });
        }
        json(join(staging, "manifest.json"), { schema_version: "1.0", protocol: CANDIDATE_REQUEST_PROTOCOL, execution_status: "not-run", receipt_status: "not-created", job_sha256: jobSnapshot.sha256, bindings, limitations: ["Preparation is local integrity, not authenticated host execution", "No claim/submit or native execution receipt integration yet", "Expected output and assertions are not candidate inputs; put required output syntax in the frozen prompt"] });
        for (const [path, digest] of sourceChecks)
            if (artifactHash(path) !== digest)
                throw new TypeError("Input changed during preparation");
        if (readTrustedSnapshot(workspace, jobPath, "evaluation job").sha256 !== jobSnapshot.sha256)
            throw new TypeError("Job changed during preparation");
        for (const p of prepared)
            if (artifactHash(p.metadataPath) !== p.metadataHash)
                throw new TypeError("Metadata changed during preparation");
        if (existsSync(destination) || lstatSync(destination, { throwIfNoEntry: false }))
            throw new TypeError("Output destination appeared during preparation");
        plainParents(dirname(destination));
        renameSync(staging, destination);
        staging = undefined;
        return { schema_version: "1.0", status: "prepared", execution_status: "not-run", workspace, destination, manifest: join(destination, "manifest.json"), requests, next_actions: ["Inspect candidate packets and host capabilities before delegation", "Native result submission is not integrated yet; do not fabricate execution-evidence.json or use these packets as completed runs"] };
    }
    finally {
        if (staging)
            rmSync(staging, { recursive: true, force: true });
        releaseDestination?.();
        release();
    }
}
/** Snapshot inputs before creating a result tree beneath the original Skill. */
function captureInputSkill(skill, evalSet) {
    plainParents(skill);
    const files = new Map(), parts = [];
    for (const name of readdirSync(skill).sort()) {
        if (["eval_result", "eval.json", ".git", ".verification"].includes(name) || resolve(skill, name) === evalSet)
            continue;
        const c = captureTrustedArtifact(skill, join(skill, name), "Skill input");
        parts.push(name, c.sha256);
        for (const [path, snapshot] of c.files)
            files.set(path ? name + "/" + path : name, snapshot);
    }
    const capture = { sha256: compositeHash(parts), files };
    bounded([capture]);
    return capture;
}
export async function prepareSkillExecution(options) {
    const skill = resolve(options.skillPath), evalSet = resolve(options.evalSet ?? join(skill, "eval.json")), runId = randomUUID(), now = new Date();
    const date = [now.getDate(), now.getMonth() + 1, now.getFullYear() % 100].map(x => String(x).padStart(2, "0")).join("-");
    const destination = resolve(options.output ?? join(skill, "eval_result", date + "-" + runId));
    plainParents(skill);
    plainParents(dirname(destination));
    if (!existsSync(join(skill, "SKILL.md")))
        throw new TypeError("Skill directory must contain SKILL.md");
    if (!existsSync(evalSet))
        throw new TypeError("Evaluation set not found: " + evalSet);
    if (within(skill, destination) && (!within(join(skill, "eval_result"), destination) || destination === join(skill, "eval_result")))
        throw new TypeError("Output inside the Skill must be a new child of eval_result");
    if (options.baselineSkillPath && within(resolve(options.baselineSkillPath), destination))
        throw new TypeError("Output must not modify the baseline Skill");
    const evalSnapshot = readTrustedSnapshot(dirname(evalSet), evalSet, "evaluation set");
    const evalDocument = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(evalSnapshot.bytes));
    if (evalDocument?.anytime_quality_policy || evalDocument?.decision_policy === "adaptive")
        throw new TypeError("Adaptive preparation is not supported");
    const input = captureInputSkill(skill, evalSet), baseline = options.baselineSkillPath ? resolve(options.baselineSkillPath) : null;
    const baselineInput = baseline ? captureInputSkill(baseline, join(baseline, "eval.json")) : null;
    bounded([input, ...(baselineInput ? [baselineInput] : [])]);
    const release = await acquireDirectoryLock(destination + ".creation-lock");
    let created = false;
    try {
        if (existsSync(destination) || lstatSync(destination, { throwIfNoEntry: false }))
            throw new TypeError("Output destination already exists; choose a new directory");
        if (captureInputSkill(skill, evalSet).sha256 !== input.sha256 || readTrustedSnapshot(dirname(evalSet), evalSet, "evaluation set").sha256 !== evalSnapshot.sha256)
            throw new TypeError("Inputs changed before preparation");
        mkdirSync(destination, { mode: 0o700 });
        created = true;
        const frozenSkill = join(destination, ".inputs", basename(skill));
        writeSnapshot(input, frozenSkill);
        const frozenEval = join(frozenSkill, "eval.json");
        writeFileSync(frozenEval, evalSnapshot.bytes, { flag: "wx", mode: 0o600 });
        const frozenBaseline = baselineInput ? join(destination, ".baseline", basename(skill)) : undefined;
        if (baselineInput && frozenBaseline)
            writeSnapshot(baselineInput, frozenBaseline);
        const workspace = join(destination, ".campaign");
        const result = await fullEval({ skillPath: frozenSkill, evalSet: frozenEval, workspace, execute: false, baseline: frozenBaseline ? "old_skill" : "without_skill", baselineSkillPath: frozenBaseline, gradingMode: "delegated", progress: "none" });
        if (!existsSync(join(workspace, ".full-eval-job.json")) || result.phases?.find((p) => p.name === "scaffold")?.status !== "complete")
            throw new TypeError("Evaluation preparation failed: " + JSON.stringify(result));
        const prepared = await prepareExecution(workspace, join(destination, "candidates"), { model: options.model, baselineSkillPath: frozenBaseline });
        json(join(destination, "run.json"), { schema_version: "1.0", run_id: runId, date, skill, eval_set: evalSet, source_snapshot_sha256: input.sha256, eval_set_sha256: evalSnapshot.sha256, execution_status: "not-run", workspace, packets: prepared.destination });
        return { ...prepared, destination, skill, eval_set: evalSet, run_id: runId };
    }
    catch (error) {
        if (created)
            rmSync(destination, { recursive: true, force: true });
        throw error;
    }
    finally {
        release();
    }
}
export async function main(argv = process.argv.slice(2)) {
    try {
        const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { "skill-path": { type: "string" }, "eval-set": { type: "string" }, output: { type: "string" }, model: { type: "string" }, "baseline-skill": { type: "string" } } });
        if (values["skill-path"]) {
            if (positionals.length)
                throw new TypeError("Choose --skill-path or legacy workspace, not both");
            console.log(JSON.stringify(await prepareSkillExecution({ skillPath: values["skill-path"], evalSet: values["eval-set"], output: values.output, model: values.model, baselineSkillPath: values["baseline-skill"] }), null, 2));
            return 0;
        }
        if (positionals.length !== 1 || !values.output || values["eval-set"]) {
            console.error("usage: prepare-execution --skill-path <dir> [--eval-set <file>] [--output <new-directory>] [--model <id>] | prepare-execution <workspace> --output <new-directory>");
            return 2;
        }
        console.log(JSON.stringify(await prepareExecution(positionals[0], values.output, { model: values.model, baselineSkillPath: values["baseline-skill"] }), null, 2));
        return 0;
    }
    catch (error) {
        console.log(JSON.stringify({ schema_version: "1.0", status: "failure", reason: error.message }));
        return 1;
    }
}
