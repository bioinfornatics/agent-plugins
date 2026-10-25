#!/usr/bin/env node
/** Host-neutral export/import for manual or externally executed evaluation evidence. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { assertionHashFromManifest, normalizeAssertions } from "./assertion_grading.js";
export const JOB_SCHEMA = "agent-creator.evidence-job/v1";
export const RUN_SCHEMA = "agent-creator.evidence-run/v1";
export const TRUST_LEVELS = ["unverified", "human-reviewed", "independently-verified"];
export const RUN_JSON_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: RUN_SCHEMA,
    title: "Agent Creator imported evaluation run",
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "job_id", "run_id", "eval_id", "configuration", "response", "timing", "provenance", "trust"],
    properties: {
        schema_version: { const: RUN_SCHEMA }, job_id: { type: "string", minLength: 1 },
        run_id: { type: "string", pattern: "^[A-Za-z0-9._-]+$" },
        eval_id: { anyOf: [{ type: "string", minLength: 1, maxLength: 256, pattern: "^[^\u0000-\u001F\u007F]+$" }, { type: "integer" }] },
        configuration: { type: "string", minLength: 1, pattern: "^[A-Za-z0-9._-]+$" },
        response: { type: "object", additionalProperties: false, required: ["text", "sha256"], properties: {
                text: { type: "string", minLength: 1 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
            } },
        timing: { type: "object", additionalProperties: false, required: ["total_duration_seconds"], properties: {
                total_duration_seconds: { type: "number", minimum: 0 }, total_tokens: { type: "integer", minimum: 0 },
            } },
        provenance: { type: "object", additionalProperties: false, required: ["source", "producer", "captured_at"], properties: {
                source: { enum: ["manual", "external"] }, producer: { type: "string", minLength: 1 },
                captured_at: { type: "string", format: "date-time" }, host: { type: "string" }, notes: { type: "string" },
            } },
        trust: { type: "object", additionalProperties: false, required: ["level", "reason"], properties: {
                level: { enum: [...TRUST_LEVELS] }, reason: { type: "string", minLength: 1 }, reviewed_by: { type: "string", minLength: 1 },
            } },
    },
    allOf: [{ if: { properties: { trust: { properties: { level: { enum: ["human-reviewed", "independently-verified"] } } } } }, then: { properties: { trust: { required: ["reviewed_by"] } } } }],
};
export class EvidenceDiagnostic extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = "EvidenceDiagnostic";
    }
}
function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Stable serialization used for all exchange identifiers and checksums. */
export function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch (error) {
        throw new EvidenceDiagnostic("INVALID_JSON", `${path}: ${error.message}`);
    }
}
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function isRfc3339(value) {
    const match = RFC3339.exec(value);
    if (!match)
        return false;
    const parts = match.slice(1, 7).map(Number), year = parts[0], month = parts[1], day = parts[2];
    if (month < 1 || month > 12 || parts[3] > 23 || parts[4] > 59 || parts[5] > 59)
        return false;
    if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())
        return false;
    const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
    return !offset || (Number(offset[2]) <= 23 && Number(offset[3]) <= 59);
}
function matchesSchema(value, schema, path = "$") {
    const errors = [];
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const isType = (type) => type === "object" ? object(value) : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === type;
    if (types.length && !types.some(isType))
        return [path + " has an invalid type"];
    if (schema.const !== undefined && value !== schema.const)
        errors.push(path + " must equal the schema constant");
    if (schema.enum && !schema.enum.includes(value))
        errors.push(path + " is not an allowed value");
    if (schema.anyOf && !schema.anyOf.some((candidate) => matchesSchema(value, candidate, path).length === 0))
        errors.push(path + " does not match any allowed schema");
    if (typeof value === "string") {
        if (schema.minLength !== undefined && value.length < schema.minLength)
            errors.push(path + " is too short");
        if (schema.maxLength !== undefined && value.length > schema.maxLength)
            errors.push(path + " is too long");
        if (schema.pattern && !(new RegExp(schema.pattern).test(value)))
            errors.push(path + " has an invalid format");
        if (schema.format === "date-time" && !isRfc3339(value))
            errors.push(path + " is not a strict RFC3339 timestamp");
    }
    if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum)
        errors.push(path + " is below minimum");
    if (object(value)) {
        for (const key of schema.required ?? [])
            if (!(key in value))
                errors.push(path + "." + key + " is required");
        const properties = schema.properties ?? {};
        if (schema.additionalProperties === false)
            for (const key of Object.keys(value))
                if (!(key in properties))
                    errors.push(path + "." + key + " is not allowed");
        for (const [key, child] of Object.entries(properties))
            if (key in value)
                errors.push(...matchesSchema(value[key], child, path + "." + key));
    }
    for (const condition of schema.allOf ?? [])
        if ((!condition.if || matchesSchema(value, condition.if, path).length === 0) && condition.then)
            errors.push(...matchesSchema(value, condition.then, path));
    return errors;
}
function hasOnlyUnicodeScalars(value) {
    for (let index = 0; index < value.length; index++) {
        const unit = value.charCodeAt(index);
        if (unit >= 0xD800 && unit <= 0xDBFF) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xDC00 && next <= 0xDFFF))
                return false;
            index++;
        }
        else if (unit >= 0xDC00 && unit <= 0xDFFF)
            return false;
    }
    return true;
}
function validateEvalId(id, label = "Eval id") {
    if ((typeof id === "string" && id.length > 0 && id.length <= 256 && !/[\u0000-\u001F\u007F]/.test(id) && hasOnlyUnicodeScalars(id)) || Number.isInteger(id))
        return;
    throw new EvidenceDiagnostic("INVALID_EVAL_ID", label + " must be an integer or 1-256 printable Unicode scalar characters");
}
function evalDirectoryName(id) {
    validateEvalId(id, "Evidence eval id");
    return "eval-" + encodeURIComponent(String(id));
}
function safeRelative(path, label) {
    if (!path || path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
        throw new EvidenceDiagnostic("UNSAFE_REF", `${label} must be a relative path without '..': ${path}`);
    }
    return path.replaceAll("\\", "/");
}
function assertInside(root, path) {
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(path) === resolve(root)) {
        throw new EvidenceDiagnostic("UNSAFE_REF", `Reference escapes fixture root: ${path}`);
    }
}
function parseAgentName(text) {
    const match = /^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$[\s\S]*?^---\s*$/m.exec(text);
    if (!match?.[1]?.trim())
        throw new EvidenceDiagnostic("INVALID_AGENT", "Agent frontmatter must contain name");
    return match[1].trim();
}
function metadata(evalCase) {
    const id = evalCase.id ?? evalCase.eval_id;
    return {
        id,
        name: evalCase.name ?? evalCase.eval_name ?? String(id),
        prompt: evalCase.prompt,
        subject: evalCase.subject ?? "",
        language: evalCase.language ?? "",
        target: evalCase.target ?? {},
        preconditions: evalCase.preconditions ?? [],
        files: evalCase.files ?? [],
        capabilities: evalCase.capabilities ?? {},
        coverage_tags: evalCase.coverage_tags ?? [],
        assertions: evalCase.assertions ?? [],
    };
}
/** Render the canonical workspace shape consumed by grading and aggregation. */
function workspaceMetadata(evalCase, job) {
    // External variants are pinned to the checksummed job manifest. The importing runner
    // cannot silently substitute a configuration without changing this source identity.
    const variantSources = Object.fromEntries(job.configurations.map(configuration => [configuration, {
            source_sha256: sha256(canonicalJson({ job_id: job.job_id, configuration, agent_sha256: job.agent.sha256 })),
        }]));
    const assertions = normalizeAssertions(evalCase.assertions);
    return {
        schema_version: 2,
        assertion_hash: assertionHashFromManifest(assertions, variantSources),
        variants: [...job.configurations].sort(),
        variant_sources: variantSources,
        eval_id: evalCase.id,
        eval_name: evalCase.name,
        prompt: evalCase.prompt,
        subject: evalCase.subject,
        language: evalCase.language,
        target: evalCase.target,
        preconditions: evalCase.preconditions,
        files: evalCase.files,
        capabilities: evalCase.capabilities,
        coverage_tags: evalCase.coverage_tags,
        assertions,
    };
}
function validateEvalCases(document) {
    if (!object(document) || !Array.isArray(document.evals) || !document.evals.length) {
        throw new EvidenceDiagnostic("INVALID_EVAL_SET", "Eval set must contain a non-empty evals list");
    }
    const ids = new Set();
    for (const item of document.evals) {
        if (!object(item))
            throw new EvidenceDiagnostic("INVALID_EVAL_SET", "Each eval must be an object");
        validateEvalId(item.id);
        if (ids.has(String(item.id)))
            throw new EvidenceDiagnostic("INVALID_EVAL_SET", `Duplicate eval id: ${item.id}`);
        ids.add(String(item.id));
        if (typeof item.prompt !== "string" || !item.prompt.trim())
            throw new EvidenceDiagnostic("INVALID_EVAL_SET", `Eval ${item.id} requires a prompt`);
        for (const field of ["preconditions", "files", "coverage_tags"])
            if (item[field] !== undefined && (!Array.isArray(item[field]) || !item[field].every((v) => typeof v === "string")))
                throw new EvidenceDiagnostic("INVALID_EVAL_SET", `Eval ${item.id} ${field} must be strings`);
        if (item.assertions !== undefined && !Array.isArray(item.assertions))
            throw new EvidenceDiagnostic("INVALID_EVAL_SET", `Eval ${item.id} assertions must be a list`);
        try {
            normalizeAssertions(item.assertions ?? []);
        }
        catch (error) {
            throw new EvidenceDiagnostic("INVALID_EVAL_SET", `Eval ${item.id} assertions are invalid: ${error.message}`);
        }
    }
    return document.evals;
}
export function exportEvidenceJob(options) {
    const agentPath = resolve(options.agentPath), evalSetPath = resolve(options.evalSetPath);
    const outputDir = resolve(options.outputDir);
    if (existsSync(outputDir))
        throw new EvidenceDiagnostic("OUTPUT_EXISTS", `Refusing to overwrite ${outputDir}`);
    const fixtureRoot = resolve(options.fixtureRoot ?? dirname(dirname(evalSetPath)));
    const agentText = readFileSync(agentPath, "utf-8"), evalText = readFileSync(evalSetPath, "utf-8");
    const evalCases = validateEvalCases(JSON.parse(evalText));
    const configurations = options.configurations ?? ["with_agent", "without_agent_instructions"];
    if (!configurations.length || !configurations.every(v => /^[A-Za-z0-9._-]+$/.test(v)) || new Set(configurations).size !== configurations.length)
        throw new EvidenceDiagnostic("INVALID_CONFIGURATION", "Configurations must be unique filesystem-safe names");
    mkdirSync(join(outputDir, "fixtures"), { recursive: true });
    copyFileSync(agentPath, join(outputDir, "agent.md"));
    copyFileSync(evalSetPath, join(outputDir, "evals.json"));
    const fixtureMap = new Map();
    for (const evalCase of evalCases)
        for (const raw of evalCase.files ?? []) {
            const sourceRef = safeRelative(raw, "Fixture reference");
            const source = resolve(fixtureRoot, sourceRef);
            assertInside(fixtureRoot, source);
            if (!existsSync(source) || !statSync(source).isFile())
                throw new EvidenceDiagnostic("MISSING_FIXTURE", `Fixture is not a file: ${sourceRef}`);
            const ref = `fixtures/${sourceRef}`;
            const content = readFileSync(source);
            mkdirSync(dirname(join(outputDir, ref)), { recursive: true });
            copyFileSync(source, join(outputDir, ref));
            fixtureMap.set(sourceRef, { source: sourceRef, ref, sha256: sha256(content) });
        }
    const evals = evalCases.map(item => {
        const base = metadata(item);
        return { ...base, metadata_sha256: sha256(canonicalJson(base)) };
    });
    const identity = {
        agent_sha256: sha256(agentText), eval_set_sha256: sha256(evalText),
        fixtures: [...fixtureMap.values()].sort((a, b) => a.source.localeCompare(b.source)), configurations, evals,
    };
    const job = {
        schema_version: JOB_SCHEMA,
        job_id: `job_${sha256(canonicalJson(identity))}`,
        created_at: options.now ?? new Date().toISOString(),
        agent: { name: parseAgentName(agentText), ref: "agent.md", sha256: sha256(agentText) },
        eval_set: { ref: "evals.json", sha256: sha256(evalText) },
        fixture_root: "fixtures",
        fixtures: [...fixtureMap.values()].sort((a, b) => a.source.localeCompare(b.source)),
        configurations, evals,
        notice: "Portable execution request only; this bundle and imported evidence do not constitute CI attestation.",
    };
    writeFileSync(join(outputDir, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
    writeFileSync(join(outputDir, "run.schema.json"), `${JSON.stringify(RUN_JSON_SCHEMA, null, 2)}\n`);
    writeFileSync(join(outputDir, "run.example.json"), `${JSON.stringify(exampleRun(job), null, 2)}\n`);
    return job;
}
function validateJob(job, jobPath) {
    if (!object(job) || job.schema_version !== JOB_SCHEMA || typeof job.job_id !== "string" ||
        !object(job.agent) || !object(job.eval_set) || !Array.isArray(job.evals) || !Array.isArray(job.configurations))
        throw new EvidenceDiagnostic("INVALID_JOB", `Not a ${JOB_SCHEMA} document: ${jobPath}`);
    if (!Array.isArray(job.fixtures) || !job.configurations.length || !job.configurations.every((value) => typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value)) || new Set(job.configurations).size !== job.configurations.length)
        throw new EvidenceDiagnostic("INVALID_JOB", "Job fixtures and unique filesystem-safe configurations are required");
    const ids = new Set();
    for (const evalCase of job.evals) {
        if (!object(evalCase))
            throw new EvidenceDiagnostic("INVALID_JOB", "Job evals must be objects");
        validateEvalId(evalCase.id, "Job eval id");
        if (ids.has(String(evalCase.id)))
            throw new EvidenceDiagnostic("INVALID_JOB", "Duplicate job eval id: " + evalCase.id);
        ids.add(String(evalCase.id));
    }
    const root = dirname(resolve(jobPath));
    for (const ref of [job.agent, job.eval_set, ...job.fixtures]) {
        if (!object(ref) || typeof ref.ref !== "string" || typeof ref.sha256 !== "string")
            throw new EvidenceDiagnostic("INVALID_JOB", "Every bundle reference requires ref and sha256");
        const safe = safeRelative(ref.ref, "Bundle reference"), path = resolve(root, safe);
        assertInside(root, path);
        if (!existsSync(path) || sha256(readFileSync(path)) !== ref.sha256)
            throw new EvidenceDiagnostic("STALE_BUNDLE", `Missing or checksum-mismatched bundle reference: ${safe}`);
    }
    // The checksummed eval snapshot, rather than job_id alone, is authoritative. Rebuild
    // every manifest entry from it so a recomputed job_id cannot bless altered metadata.
    const sourceEvals = validateEvalCases(readJson(resolve(root, safeRelative(job.eval_set.ref, "Eval set reference"))));
    if (sourceEvals.length !== job.evals.length)
        throw new EvidenceDiagnostic("INVALID_JOB", "Manifest evals do not correspond exactly to checksummed evals.json");
    for (let index = 0; index < sourceEvals.length; index++) {
        const canonical = metadata(sourceEvals[index]);
        const expected = { ...canonical, metadata_sha256: sha256(canonicalJson(canonical)) };
        const actual = job.evals[index];
        if (actual.metadata_sha256 !== expected.metadata_sha256)
            throw new EvidenceDiagnostic("INVALID_JOB", `metadata_sha256 does not match checksummed evals.json for eval ${canonical.id}`);
        if (canonicalJson(actual) !== canonicalJson(expected))
            throw new EvidenceDiagnostic("INVALID_JOB", `Manifest metadata does not correspond exactly to checksummed evals.json for eval ${canonical.id}`);
    }
    const identity = { agent_sha256: job.agent.sha256, eval_set_sha256: job.eval_set.sha256, fixtures: [...job.fixtures].sort((a, b) => String(a.source).localeCompare(String(b.source))), configurations: job.configurations, evals: job.evals };
    const expectedJobId = "job_" + sha256(canonicalJson(identity));
    if (job.job_id !== expectedJobId)
        throw new EvidenceDiagnostic("INVALID_JOB", "job_id does not match canonical manifest content; expected " + expectedJobId);
}
export function validateEvidenceRun(document, job) {
    const schemaErrors = matchesSchema(document, RUN_JSON_SCHEMA);
    if (schemaErrors.length) {
        const provenanceError = schemaErrors.some(error => error.startsWith("$.provenance"));
        const trustError = schemaErrors.some(error => error.startsWith("$.trust"));
        throw new EvidenceDiagnostic(provenanceError ? "INVALID_PROVENANCE" : trustError ? "INVALID_TRUST" : "INVALID_RUN", schemaErrors.join("; "));
    }
    if (document.job_id !== job.job_id)
        throw new EvidenceDiagnostic("WRONG_JOB", "Run targets " + document.job_id + "; expected " + job.job_id);
    if (!job.evals.find(item => item.id === document.eval_id))
        throw new EvidenceDiagnostic("WRONG_JOB", "Eval " + document.eval_id + " is not an exact id/type match in job " + job.job_id);
    if (!job.configurations.includes(document.configuration))
        throw new EvidenceDiagnostic("WRONG_JOB", "Configuration " + document.configuration + " is not in job " + job.job_id);
    if (document.response.sha256 !== sha256(document.response.text))
        throw new EvidenceDiagnostic("INVALID_RUN", "response.sha256 must match response.text exactly");
    return document;
}
export function importEvidenceRun(options) {
    const job = readJson(resolve(options.jobPath));
    validateJob(job, options.jobPath);
    const run = validateEvidenceRun(readJson(resolve(options.runPath)), job);
    const workspace = resolve(options.workspace), marker = join(workspace, "evidence_job.json");
    if (existsSync(marker)) {
        const existing = readJson(marker);
        if (existing.job_id !== job.job_id)
            throw new EvidenceDiagnostic("STALE_JOB", `Workspace is pinned to ${existing.job_id}; import targets ${job.job_id}`);
    }
    const evalCase = job.evals.find(item => item.id === run.eval_id);
    const evalDir = join(workspace, evalDirectoryName(run.eval_id));
    assertInside(workspace, evalDir);
    const metadataPath = join(evalDir, "eval_metadata.json");
    const expectedMetadata = workspaceMetadata(evalCase, job);
    if (existsSync(metadataPath)) {
        const existingMetadata = readJson(metadataPath);
        if (canonicalJson(existingMetadata) !== canonicalJson(expectedMetadata))
            throw new EvidenceDiagnostic("STALE_EVAL", `Workspace metadata for eval ${run.eval_id} does not match job ${job.job_id}`);
    }
    const destination = join(evalDir, run.configuration);
    assertInside(workspace, destination);
    const assertionMarker = join(destination, "assertion_hash.txt");
    if (existsSync(assertionMarker) && readFileSync(assertionMarker, "utf-8").trim() !== expectedMetadata.assertion_hash)
        throw new EvidenceDiagnostic("STALE_EVAL", `Assertion/variant marker for eval ${run.eval_id}/${run.configuration} does not match job ${job.job_id}`);
    const evidencePath = join(destination, "evidence.json");
    const evidenceText = `${canonicalJson(run)}\n`, evidenceHash = sha256(evidenceText);
    if (existsSync(evidencePath)) {
        if (sha256(readFileSync(evidencePath)) === evidenceHash)
            return { status: "duplicate", run_id: run.run_id, destination, evidence_sha256: evidenceHash };
        throw new EvidenceDiagnostic("DUPLICATE_CONFLICT", `Evidence already exists for eval ${run.eval_id}/${run.configuration}`);
    }
    mkdirSync(join(destination, "outputs"), { recursive: true });
    if (!existsSync(marker))
        writeFileSync(marker, `${JSON.stringify({ schema_version: JOB_SCHEMA, job_id: job.job_id }, null, 2)}\n`);
    if (!existsSync(metadataPath))
        writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);
    writeFileSync(join(destination, "outputs", "response.md"), `${run.response.text.replace(/\n?$/, "\n")}`);
    writeFileSync(join(destination, "timing.json"), `${JSON.stringify(run.timing, null, 2)}\n`);
    writeFileSync(assertionMarker, `${expectedMetadata.assertion_hash}\n`);
    writeFileSync(join(destination, "transcript.json"), `${JSON.stringify({
        schema_version: RUN_SCHEMA, imported: true, messages: [{ role: "assistant", content: [{ type: "text", text: run.response.text }] }],
        provenance: run.provenance, trust: run.trust,
    }, null, 2)}\n`);
    writeFileSync(evidencePath, evidenceText);
    return { status: "imported", run_id: run.run_id, destination, evidence_sha256: evidenceHash };
}
export function exampleRun(job) {
    const response = "Replace this placeholder with the observed agent response.";
    return {
        schema_version: RUN_SCHEMA, job_id: job.job_id, run_id: "host-neutral-example",
        eval_id: job.evals[0].id, configuration: job.configurations[0],
        response: { text: response, sha256: sha256(response) },
        timing: { total_duration_seconds: 0, total_tokens: 0 },
        provenance: { source: "external", producer: "replace-with-runner-name", captured_at: "2026-01-01T00:00:00Z", host: "host-neutral" },
        trust: { level: "unverified", reason: "Imported report has not been independently reviewed." },
    };
}
function usage() {
    console.error("usage:\n  evidence_exchange.js export --agent <file> --eval-set <file> --output <dir> [--fixture-root <dir>] [--configuration <name> ...]\n  evidence_exchange.js import --job <job.json> --run <run.json> --workspace <dir>");
    process.exit(2);
}
function main() {
    const [command, ...args] = process.argv.slice(2);
    if (command === "export") {
        const { values } = parseArgs({ args, options: {
                agent: { type: "string" }, "eval-set": { type: "string" }, output: { type: "string" },
                "fixture-root": { type: "string" }, configuration: { type: "string", multiple: true },
            } });
        if (!values.agent || !values["eval-set"] || !values.output)
            usage();
        const job = exportEvidenceJob({ agentPath: values.agent, evalSetPath: values["eval-set"], outputDir: values.output,
            fixtureRoot: values["fixture-root"], configurations: values.configuration });
        console.log(JSON.stringify({ ok: true, job_id: job.job_id, path: resolve(values.output, "job.json") }));
    }
    else if (command === "import") {
        const { values } = parseArgs({ args, options: { job: { type: "string" }, run: { type: "string" }, workspace: { type: "string" } } });
        if (!values.job || !values.run || !values.workspace)
            usage();
        console.log(JSON.stringify({ ok: true, ...importEvidenceRun({ jobPath: values.job, runPath: values.run, workspace: values.workspace }) }));
    }
    else
        usage();
}
if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        main();
    }
    catch (error) {
        const diagnostic = error instanceof EvidenceDiagnostic ? error : new EvidenceDiagnostic("IMPORT_FAILED", error.message);
        console.error(JSON.stringify({ ok: false, code: diagnostic.code, error: diagnostic.message }));
        process.exit(1);
    }
}
