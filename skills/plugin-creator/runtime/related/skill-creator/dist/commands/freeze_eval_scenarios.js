#!/usr/bin/env node
/** Derive elicitation-ready scenario shells and freeze a provenance-bound evaluation plan. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
export const scenarioKinds = ["normal", "boundary", "restraint", "missing-capability", "non-regression"];
export const assertionOperators = ["equals", "matches", "contains", "exists", "becomes", "stays", "reports", "returns", "creates", "writes", "emits", "preserves", "leaves", "declines", "fails", "blocks", "produces", "retains"];
const blankCaps = { filesystem: true, agent_runner: true, browser: false, network: false, tools: [] };
const executionLevels = ["explain", "dry-run", "execute", "resume"];
const purpose = {
    normal: "the expected successful path", boundary: "a difficult limit, sibling route, or conditional path", restraint: "a non-goal that the Skill must decline or leave unchanged", "missing-capability": "honest behavior when a required capability or dependency is unavailable", "non-regression": "behavior already known to work and that must remain intact",
};
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const strings = (value) => Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
const text = (value) => typeof value === "string" ? value : "";
const own = (value, key) => isRecord(value) && Object.hasOwn(value, key);
const isoUtc = (value) => typeof value === "string" && /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
function canonical(value, seen = new Set()) {
    if (value === null)
        return "null";
    if (typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("Canonical content contains a non-finite number.");
        return JSON.stringify(value);
    }
    if (typeof value !== "object")
        throw new TypeError(`Canonical content contains unsupported ${typeof value}.`);
    if (seen.has(value))
        throw new TypeError("Canonical content contains a cycle.");
    seen.add(value);
    let result;
    if (Array.isArray(value))
        result = `[${value.map(item => canonical(item, seen)).join(",")}]`;
    else {
        if (!isRecord(value))
            throw new TypeError("Canonical content must contain only plain JSON objects.");
        result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], seen)}`).join(",")}}`;
    }
    seen.delete(value);
    return result;
}
export function canonicalScenarioHash(plan) {
    if (!isRecord(plan))
        throw new TypeError("Scenario plan must be a plain object.");
    const { canonical_content_sha256: _ignored, ...content } = plan;
    return createHash("sha256").update(canonical(content)).digest("hex");
}
const morphologyFamilies = [
    ["equal", "equals", "equaled", "equalled", "equaling", "equalling"], ["be", "am", "is", "are", "was", "were", "been", "being"],
    ["match", "matches", "matched", "matching"], ["contain", "contains", "contained", "containing"],
    ["exist", "exists", "existed", "existing"], ["become", "becomes", "became", "becoming"],
    ["stay", "stays", "stayed", "staying"], ["report", "reports", "reported", "reporting"],
    ["return", "returns", "returned", "returning"], ["create", "creates", "created", "creating", "creation", "creations"],
    ["generate", "generates", "generated", "generating", "generation", "generations"],
    ["write", "writes", "wrote", "written", "writing", "writings"], ["emit", "emits", "emitted", "emitting"],
    ["preserve", "preserves", "preserved", "preserving"], ["leave", "leaves", "left", "leaving"],
    ["decline", "declines", "declined", "declining"], ["fail", "fails", "failed", "failing"],
    ["block", "blocks", "blocked", "blocking"], ["produce", "produces", "produced", "producing", "production"],
    ["retain", "retains", "retained", "retaining"], ["remain", "remains", "remained", "remaining"],
    ["cite", "cites", "cited", "citing", "citation", "citations"],
];
const morphology = new Map(morphologyFamilies.flatMap(([stem, ...forms]) => [stem, ...forms].map(form => [form, stem])));
function normalizeMorphology(token) {
    const known = morphology.get(token);
    if (known)
        return known;
    if (token.length > 4 && token.endsWith("ies"))
        return token.slice(0, -3) + "y";
    if (token.length > 4 && /(?:ches|shes|ses|xes|zes)$/.test(token))
        return token.slice(0, -2);
    if (token.length > 3 && token.endsWith("s") && !/(?:ss|us|is)$/.test(token))
        return token.slice(0, -1);
    return token;
}
function normalizedTokens(value) {
    return (value.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizeMorphology);
}
function assertionText(assertion) {
    const expected = typeof assertion.expected === "string" ? assertion.expected : JSON.stringify(assertion.expected);
    return `${assertion.subject} ${assertion.operator} ${expected}`;
}
function tokenOverlap(candidate, request) {
    const remaining = new Map();
    for (const token of request)
        remaining.set(token, (remaining.get(token) ?? 0) + 1);
    let overlap = 0;
    for (const token of candidate) {
        const count = remaining.get(token) ?? 0;
        if (count > 0) {
            overlap++;
            remaining.set(token, count - 1);
        }
    }
    return overlap;
}
function leaked(prompt, value) {
    const assertion = normalizedTokens(assertionText(value)), request = normalizedTokens(prompt);
    if (!assertion.length)
        return false;
    if (request.join(" ").includes(assertion.join(" ")))
        return true;
    const overlap = tokenOverlap(assertion, request);
    if (overlap === assertion.length || (assertion.length >= 3 && overlap / assertion.length >= 0.8))
        return true;
    const expected = typeof value.expected === "string" ? value.expected : JSON.stringify(value.expected);
    const content = normalizedTokens(`${value.subject} ${expected}`);
    return content.length >= 2 && tokenOverlap(content, request) === content.length;
}
const unconditionalClauseLink = /\b(?:because|if|when|unless|while|although|though|whereas|then)\b/iu;
const coordinatingLinks = new Set(["and", "or", "but"]);
const predicateStems = new Set([...assertionOperators.map(normalizeMorphology), "be", "equal", "match", "contain", "exist", "become", "stay", "report", "return", "create", "generate", "write", "emit", "preserve", "leave", "decline", "fail", "block", "produce", "retain", "remain", "cite"]);
function atomicAssertionString(value) {
    if (unconditionalClauseLink.test(value) || /[;\n]|&&|\|\|/.test(value))
        return false;
    const tokens = normalizedTokens(value);
    for (let i = 0; i < tokens.length; i++)
        if (predicateStems.has(tokens[i]) || (coordinatingLinks.has(tokens[i]) && tokens.slice(i + 1).some(token => predicateStems.has(token))))
            return false;
    return true;
}
function validAssertionParts(subject, operator, expected) {
    if (typeof subject !== "string" || !subject.trim() || !assertionOperators.includes(operator))
        return false;
    if (!(expected === null || typeof expected === "string" || typeof expected === "number" || typeof expected === "boolean") || (typeof expected === "number" && !Number.isFinite(expected)) || (typeof expected === "string" && !expected.trim()))
        return false;
    return atomicAssertionString(subject.trim()) && (typeof expected !== "string" || atomicAssertionString(expected.trim()));
}
function semanticsShell(kind) {
    if (kind === "normal")
        return { kind, success_path: "" };
    if (kind === "boundary")
        return { kind, boundary_condition: "" };
    if (kind === "restraint")
        return { kind, non_goal: "", expected_response: "decline" };
    if (kind === "missing-capability")
        return { kind, unavailable_capability: "", expected_response: "block" };
    return { kind, preservation_reference: { baseline_id: "", behavior: "", evidence_locator: { kind: "file", path: "" } } };
}
function shell(cap, kind, language) {
    return { id: `${cap.id}-${kind}`, capability_id: cap.id, kind, name: `${cap.id}-${kind}`, subject: cap.name, language, prompt: "", expected_output: "", execution_level: "execute", fixtures: [], capabilities: { ...blankCaps, tools: [] }, budget: { max_turns: 0, timeout_seconds: 0 }, assertions: [], review_questions: [], coverage_tags: [`capability:${cap.id}`, `category:${kind}`, `language:${language}`], preconditions: [], target: { kind: "", execution: "execute" }, files: [], navigation_expectations: { must_read: [], read_when_relevant: [], must_not_read: [] }, semantics: semanticsShell(kind), user_edits: [] };
}
function normalizeLocator(value) { const raw = isRecord(value) ? value : {}; const kind = text(raw.kind); if (kind === "json-pointer")
    return { kind, path: text(raw.path), pointer: text(raw.pointer) }; if (kind === "stdout" || kind === "stderr")
    return { kind, pattern: text(raw.pattern) }; if (kind === "exit-code")
    return { kind, expected: typeof raw.expected === "number" ? raw.expected : Number.NaN }; return { kind: "file", path: text(raw.path) }; }
function normalizeSemantics(value, kind) { const raw = isRecord(value) ? value : {}; if (kind === "normal")
    return { kind, success_path: text(raw.success_path) }; if (kind === "boundary")
    return { kind, boundary_condition: text(raw.boundary_condition) }; if (kind === "restraint")
    return { kind, non_goal: text(raw.non_goal), expected_response: raw.expected_response === "leave-unchanged" ? "leave-unchanged" : "decline" }; if (kind === "missing-capability")
    return { kind, unavailable_capability: text(raw.unavailable_capability), expected_response: raw.expected_response === "fail-honestly" ? "fail-honestly" : "block" }; const ref = isRecord(raw.preservation_reference) ? raw.preservation_reference : {}; return { kind, preservation_reference: { baseline_id: text(ref.baseline_id), behavior: text(ref.behavior), evidence_locator: normalizeLocator(ref.evidence_locator) } }; }
function normalizeEdits(value) { return Array.isArray(value) ? value.map(item => { const raw = isRecord(item) ? item : {}; const edit = { field: text(raw.field), after: (raw.after ?? null), actor: text(raw.actor), at: text(raw.at) }; if (own(raw, "before"))
    edit.before = raw.before; if (typeof raw.reason === "string")
    edit.reason = raw.reason; return edit; }) : []; }
function normalizeScenario(value, cap, kind, language) {
    const raw = isRecord(value) ? value : {}, base = shell(cap, kind, language), targetRaw = isRecord(raw.target) ? raw.target : {}, capsRaw = isRecord(raw.capabilities) ? raw.capabilities : {}, budgetRaw = isRecord(raw.budget) ? raw.budget : {}, navRaw = isRecord(raw.navigation_expectations) ? raw.navigation_expectations : {};
    const execution = executionLevels.includes(raw.execution_level) ? raw.execution_level : executionLevels.includes(targetRaw.execution) ? targetRaw.execution : base.execution_level;
    const target = { kind: text(targetRaw.kind), execution };
    if (typeof targetRaw.path === "string")
        target.path = targetRaw.path;
    return { id: text(raw.id) || base.id, capability_id: cap.id, kind, name: text(raw.name) || base.name, subject: text(raw.subject) || base.subject, language: text(raw.language) || language, prompt: text(raw.prompt), expected_output: text(raw.expected_output), execution_level: execution, fixtures: strings(raw.fixtures), capabilities: { filesystem: capsRaw.filesystem === true, agent_runner: capsRaw.agent_runner === true, browser: capsRaw.browser === true, network: capsRaw.network === true, tools: strings(capsRaw.tools) }, budget: { max_turns: typeof budgetRaw.max_turns === "number" ? budgetRaw.max_turns : 0, timeout_seconds: typeof budgetRaw.timeout_seconds === "number" ? budgetRaw.timeout_seconds : 0 }, assertions: Array.isArray(raw.assertions) ? raw.assertions.map((item, i) => { const a = isRecord(item) ? item : {}; return { id: text(a.id) || `a${i + 1}`, subject: text(a.subject), operator: text(a.operator), expected: (a.expected ?? null), locator: normalizeLocator(a.locator), deterministic: a.deterministic === true }; }) : [], review_questions: strings(raw.review_questions), coverage_tags: strings(raw.coverage_tags), preconditions: strings(raw.preconditions), target, files: strings(raw.files), navigation_expectations: { must_read: strings(navRaw.must_read), read_when_relevant: strings(navRaw.read_when_relevant), must_not_read: strings(navRaw.must_not_read) }, semantics: normalizeSemantics(raw.semantics, kind), user_edits: normalizeEdits(raw.user_edits) };
}
/** Derive five deterministic shells per material capability without inventing timestamps. */
export function deriveScenarioPlan(input, source = "memory") {
    const root = isRecord(input) ? input : {}, rawCaps = Array.isArray(root.material_capabilities) ? root.material_capabilities : [];
    const caps = rawCaps.filter(c => !isRecord(c) || c.material !== false).map((value, i) => { const c = isRecord(value) ? value : {}; return { id: text(c.id) || `capability-${i + 1}`, name: text(c.name) || text(c.id) || `Capability ${i + 1}`, description: text(c.description), material: true }; });
    const supplied = Array.isArray(root.scenarios) ? root.scenarios : [], language = text(root.language) || "en";
    const scenarios = caps.flatMap(cap => scenarioKinds.map(kind => normalizeScenario(supplied.find(s => isRecord(s) && s.capability_id === cap.id && s.kind === kind), cap, kind, language)));
    const rawProvenance = isRecord(root.provenance) ? root.provenance : {};
    const provenance = { source, created_by: text(rawProvenance.created_by), created_at: text(rawProvenance.created_at), user_edits: normalizeEdits(rawProvenance.user_edits) };
    const elicitation_questions = scenarios.filter(s => !s.prompt || !s.assertions.length).map(s => `For ${s.capability_id}/${s.kind}, provide a realistic prompt, fixtures, category semantics, and atomic observable deterministic assertions for ${purpose[s.kind]}.`);
    return { schema_version: "1.0", artifact: "frozen-evaluation-scenarios", status: "draft", skill_name: text(root.skill_name), material_capabilities: caps, scenarios, provenance, elicitation_questions, findings: [] };
}
function exactObject(value, required, optional, path, findings, scenario_id) {
    if (!isRecord(value)) {
        findings.push({ severity: "error", rule: "strict-shape", message: `${path} must be a plain object.`, scenario_id, path });
        return false;
    }
    for (const key of required)
        if (!Object.hasOwn(value, key))
            findings.push({ severity: "error", rule: "required-field", message: `${path}.${key} is required.`, scenario_id, path: `${path}.${key}` });
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(value))
        if (!allowed.has(key))
            findings.push({ severity: "error", rule: "unknown-field", message: `${path}.${key} is not allowed.`, scenario_id, path: `${path}.${key}` });
    return true;
}
function strictStringArray(value, path, findings, scenario_id) { if (!Array.isArray(value) || value.some(x => typeof x !== "string" || !x.trim()))
    findings.push({ severity: "error", rule: "strict-type", message: `${path} must be an array of non-empty strings.`, scenario_id, path }); }
function validateRootOptionalFields(root, findings) {
    if (own(root, "schema_version") && root.schema_version !== "1.0")
        findings.push({ severity: "error", rule: "schema-version", message: "$.schema_version must be the string '1.0'.", path: "$.schema_version" });
    if (own(root, "artifact") && root.artifact !== "frozen-evaluation-scenarios")
        findings.push({ severity: "error", rule: "artifact", message: "$.artifact must equal frozen-evaluation-scenarios.", path: "$.artifact" });
    if (own(root, "status") && !["draft", "frozen", "fail"].includes(root.status))
        findings.push({ severity: "error", rule: "status", message: "$.status must be draft, frozen, or fail.", path: "$.status" });
    if (own(root, "elicitation_questions"))
        strictStringArray(root.elicitation_questions, "$.elicitation_questions", findings);
    if (own(root, "canonical_content_sha256") && (typeof root.canonical_content_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(root.canonical_content_sha256)))
        findings.push({ severity: "error", rule: "content-hash", message: "$.canonical_content_sha256 must be a lowercase SHA-256 string.", path: "$.canonical_content_sha256" });
    if (own(root, "findings")) {
        if (!Array.isArray(root.findings))
            findings.push({ severity: "error", rule: "strict-type", message: "$.findings must be an array.", path: "$.findings" });
        else
            root.findings.forEach((item, i) => { const p = `$.findings[${i}]`; if (!exactObject(item, ["severity", "rule", "message"], ["scenario_id", "path"], p, findings))
                return; if (!["error", "warning"].includes(item.severity) || typeof item.rule !== "string" || !item.rule.trim() || typeof item.message !== "string" || !item.message.trim() || (own(item, "scenario_id") && (typeof item.scenario_id !== "string" || !item.scenario_id.trim())) || (own(item, "path") && (typeof item.path !== "string" || !item.path.trim())))
                findings.push({ severity: "error", rule: "strict-type", message: `${p} has invalid field types or enum values.`, path: p }); });
    }
}
function validateLocator(value, path, findings, scenario_id) {
    if (!isRecord(value) || typeof value.kind !== "string") {
        findings.push({ severity: "error", rule: "evidence-locator", message: `${path} must be a structured evidence locator.`, scenario_id, path });
        return;
    }
    const specs = { "json-pointer": [["kind", "path", "pointer"], []], file: [["kind", "path"], []], stdout: [["kind", "pattern"], []], stderr: [["kind", "pattern"], []], "exit-code": [["kind", "expected"], []] };
    const spec = specs[value.kind];
    if (!spec) {
        findings.push({ severity: "error", rule: "evidence-locator", message: `${path}.kind is unsupported.`, scenario_id, path: `${path}.kind` });
        return;
    }
    exactObject(value, spec[0], spec[1], path, findings, scenario_id);
    if (value.kind === "exit-code") {
        if (!Number.isInteger(value.expected) || value.expected < 0 || value.expected > 255)
            findings.push({ severity: "error", rule: "evidence-locator", message: `${path}.expected must be an exit code from 0 to 255.`, scenario_id, path: `${path}.expected` });
    }
    else if (value.kind === "json-pointer") {
        if (typeof value.path !== "string" || !value.path.trim() || typeof value.pointer !== "string" || (value.pointer !== "" && !value.pointer.startsWith("/")))
            findings.push({ severity: "error", rule: "evidence-locator", message: `${path} requires a non-empty path and RFC 6901 pointer.`, scenario_id, path });
    }
    else {
        const field = value.kind === "file" ? "path" : "pattern";
        if (typeof value[field] !== "string" || !value[field].trim())
            findings.push({ severity: "error", rule: "evidence-locator", message: `${path}.${field} must be non-empty.`, scenario_id, path: `${path}.${field}` });
    }
}
function validateEdits(value, path, findings, scenario_id) {
    if (!Array.isArray(value)) {
        findings.push({ severity: "error", rule: "user-edits", message: `${path} must be explicitly present as an array; [] acknowledges no edits.`, scenario_id, path });
        return;
    }
    value.forEach((item, i) => { const p = `${path}[${i}]`; if (!exactObject(item, ["field", "after", "actor", "at"], ["before", "reason"], p, findings, scenario_id))
        return; if (typeof item.field !== "string" || !item.field.trim() || typeof item.actor !== "string" || !item.actor.trim())
        findings.push({ severity: "error", rule: "edit-provenance", message: `${p} requires non-empty field and actor.`, scenario_id, path: p }); if (!isoUtc(item.at))
        findings.push({ severity: "error", rule: "timestamp", message: `${p}.at must be a valid UTC ISO-8601 timestamp.`, scenario_id, path: `${p}.at` }); if (own(item, "reason") && (typeof item.reason !== "string" || !item.reason.trim()))
        findings.push({ severity: "error", rule: "edit-provenance", message: `${p}.reason must be a non-empty string when present.`, scenario_id, path: `${p}.reason` }); try {
        canonical(item.after);
        if (own(item, "before"))
            canonical(item.before);
    }
    catch (error) {
        findings.push({ severity: "error", rule: "json-value", message: `${p} contains a non-JSON edit value: ${error.message}`, scenario_id, path: p });
    } });
}
function validateSemantics(value, kind, path, findings, scenario_id) {
    const fail = (message) => findings.push({ severity: "error", rule: "category-semantics", message, scenario_id, path });
    if (!isRecord(value) || value.kind !== kind) {
        fail(`${path}.kind must equal ${kind}.`);
        return;
    }
    const nonempty = (field) => typeof value[field] === "string" && value[field].trim().length > 0;
    if (kind === "normal") {
        exactObject(value, ["kind", "success_path"], [], path, findings, scenario_id);
        if (!nonempty("success_path"))
            fail("Normal scenarios require a concrete success_path.");
    }
    else if (kind === "boundary") {
        exactObject(value, ["kind", "boundary_condition"], [], path, findings, scenario_id);
        if (!nonempty("boundary_condition"))
            fail("Boundary scenarios require a concrete boundary_condition.");
    }
    else if (kind === "restraint") {
        exactObject(value, ["kind", "non_goal", "expected_response"], [], path, findings, scenario_id);
        if (!nonempty("non_goal") || !["decline", "leave-unchanged"].includes(value.expected_response))
            fail("Restraint scenarios require a non_goal and decline/leave-unchanged response.");
    }
    else if (kind === "missing-capability") {
        exactObject(value, ["kind", "unavailable_capability", "expected_response"], [], path, findings, scenario_id);
        if (!nonempty("unavailable_capability") || !["block", "fail-honestly"].includes(value.expected_response))
            fail("Missing-capability scenarios require the unavailable capability and block/fail-honestly response.");
    }
    else {
        exactObject(value, ["kind", "preservation_reference"], [], path, findings, scenario_id);
        const ref = value.preservation_reference;
        if (!exactObject(ref, ["baseline_id", "behavior", "evidence_locator"], [], `${path}.preservation_reference`, findings, scenario_id))
            return;
        if (typeof ref.baseline_id !== "string" || !ref.baseline_id.trim() || typeof ref.behavior !== "string" || !ref.behavior.trim())
            fail("Non-regression scenarios require a concrete baseline_id and preserved behavior.");
        validateLocator(ref.evidence_locator, `${path}.preservation_reference.evidence_locator`, findings, scenario_id);
    }
}
/** Validate strict, total JSON input and freeze it. No assertion text is copied into prompts. */
export function freezeScenarioPlan(input, source = "memory") {
    const plan = deriveScenarioPlan(input, source), findings = plan.findings, root = isRecord(input) ? input : {};
    exactObject(input, ["skill_name", "material_capabilities", "scenarios", "provenance"], ["language", "schema_version", "artifact", "status", "elicitation_questions", "findings", "canonical_content_sha256"], "$", findings);
    validateRootOptionalFields(root, findings);
    if (!plan.skill_name.trim())
        findings.push({ severity: "error", rule: "skill-name", message: "skill_name is required." });
    if (!Array.isArray(root.material_capabilities) || !plan.material_capabilities.length)
        findings.push({ severity: "error", rule: "material-capabilities", message: "Declare at least one material capability." });
    const capabilityIds = new Set();
    if (Array.isArray(root.material_capabilities))
        root.material_capabilities.forEach((cap, i) => { const path = `$.material_capabilities[${i}]`; if (!exactObject(cap, ["id", "name", "description"], ["material"], path, findings))
            return; if (![cap.id, cap.name, cap.description].every(x => typeof x === "string" && x.trim()) || (own(cap, "material") && typeof cap.material !== "boolean"))
            findings.push({ severity: "error", rule: "strict-type", message: `${path} fields have invalid types.`, path }); if (typeof cap.id === "string") {
            if (capabilityIds.has(cap.id))
                findings.push({ severity: "error", rule: "capability-id", message: `Duplicate material capability id ${cap.id}.`, path: `${path}.id` });
            capabilityIds.add(cap.id);
        } });
    if (own(root, "language") && (typeof root.language !== "string" || !root.language.trim()))
        findings.push({ severity: "error", rule: "strict-type", message: "$.language must be a non-empty string.", path: "$.language" });
    const supplied = Array.isArray(root.scenarios) ? root.scenarios : [];
    if (!Array.isArray(root.scenarios))
        findings.push({ severity: "error", rule: "strict-type", message: "$.scenarios must be an array.", path: "$.scenarios" });
    const declaredCapabilityIds = new Set(plan.material_capabilities.map(cap => cap.id));
    const pairCounts = new Map(), scenarioIds = new Set();
    for (const raw of supplied) {
        if (!isRecord(raw)) {
            findings.push({ severity: "error", rule: "strict-shape", message: "Every scenario must be a plain object.", path: "$.scenarios" });
            continue;
        }
        const key = `${String(raw.capability_id)}\0${String(raw.kind)}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        if (!declaredCapabilityIds.has(String(raw.capability_id)) || !scenarioKinds.includes(raw.kind))
            findings.push({ severity: "error", rule: "orphan-scenario", message: "Every scenario must reference a declared material capability and supported kind.", path: "$.scenarios" });
        if (typeof raw.id === "string") {
            if (scenarioIds.has(raw.id))
                findings.push({ severity: "error", rule: "scenario-id", message: `Scenario id ${raw.id} must be globally unique.`, scenario_id: raw.id, path: "$.scenarios" });
            scenarioIds.add(raw.id);
        }
    }
    const expectedScenarioCount = plan.material_capabilities.length * scenarioKinds.length;
    if (supplied.length !== expectedScenarioCount)
        findings.push({ severity: "error", rule: "scenario-cardinality", message: `Expected exactly ${expectedScenarioCount} scenarios; received ${supplied.length}.`, path: "$.scenarios" });
    for (const cap of plan.material_capabilities)
        for (const kind of scenarioKinds) {
            const s = plan.scenarios.find(x => x.capability_id === cap.id && x.kind === kind);
            const raw = supplied.find(x => isRecord(x) && x.capability_id === cap.id && x.kind === kind);
            const id = s.id, path = `$.scenarios[${id}]`;
            if ((pairCounts.get(`${cap.id}\0${kind}`) ?? 0) !== 1)
                findings.push({ severity: "error", rule: "scenario-cardinality", message: `Exactly one ${kind} scenario is required for ${cap.id}.`, scenario_id: id, path });
            if (!exactObject(raw, ["id", "capability_id", "kind", "name", "subject", "language", "prompt", "expected_output", "execution_level", "target", "fixtures", "files", "preconditions", "budget", "capabilities", "assertions", "review_questions", "coverage_tags", "navigation_expectations", "semantics", "user_edits"], [], path, findings, id))
                continue;
            for (const field of ["id", "capability_id", "kind", "name", "subject", "language", "prompt", "expected_output", "execution_level"])
                if (typeof raw[field] !== "string" || !raw[field].trim())
                    findings.push({ severity: "error", rule: "strict-type", message: `${path}.${field} must be a non-empty string.`, scenario_id: id, path: `${path}.${field}` });
            for (const field of ["fixtures", "files", "preconditions", "review_questions", "coverage_tags"])
                strictStringArray(raw[field], `${path}.${field}`, findings, id);
            if (!s.coverage_tags.length || s.coverage_tags.some(tag => !/^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._/-]*$/i.test(tag)) || !s.coverage_tags.includes(`capability:${cap.id}`) || !s.coverage_tags.includes(`category:${kind}`))
                findings.push({ severity: "error", rule: "coverage-tags", message: `coverage_tags must be non-empty key:value tags including capability:${cap.id} and category:${kind}.`, scenario_id: id, path: `${path}.coverage_tags` });
            if (!s.fixtures.length)
                findings.push({ severity: "error", rule: "fixtures", message: "Declare at least one fixture or explicit 'none' token.", scenario_id: id });
            if (!exactObject(raw.capabilities, ["filesystem", "agent_runner", "browser", "network", "tools"], [], `${path}.capabilities`, findings, id) || !["filesystem", "agent_runner", "browser", "network"].every(field => typeof raw.capabilities[field] === "boolean"))
                findings.push({ severity: "error", rule: "capabilities", message: "Capabilities require strict booleans and tools array.", scenario_id: id });
            else
                strictStringArray(raw.capabilities.tools, `${path}.capabilities.tools`, findings, id);
            if (!exactObject(raw.target, ["kind", "execution"], ["path"], `${path}.target`, findings, id) || typeof raw.target.kind !== "string" || !raw.target.kind.trim() || (own(raw.target, "path") && (typeof raw.target.path !== "string" || !raw.target.path.trim())) || !executionLevels.includes(raw.target.execution) || raw.execution_level !== raw.target.execution)
                findings.push({ severity: "error", rule: "execution-level", message: "target and execution_level must be strict, supported, and equal.", scenario_id: id });
            if (!exactObject(raw.budget, ["max_turns", "timeout_seconds"], [], `${path}.budget`, findings, id) || !Number.isInteger(raw.budget.max_turns) || raw.budget.max_turns <= 0 || typeof raw.budget.timeout_seconds !== "number" || !Number.isFinite(raw.budget.timeout_seconds) || raw.budget.timeout_seconds <= 0)
                findings.push({ severity: "error", rule: "budget", message: "Positive numeric max_turns and timeout_seconds are required.", scenario_id: id });
            if (!exactObject(raw.navigation_expectations, ["must_read", "read_when_relevant", "must_not_read"], [], `${path}.navigation_expectations`, findings, id)) { /* finding emitted */ }
            else
                for (const field of ["must_read", "read_when_relevant", "must_not_read"])
                    strictStringArray(raw.navigation_expectations[field], `${path}.navigation_expectations.${field}`, findings, id);
            validateSemantics(raw.semantics, kind, `${path}.semantics`, findings, id);
            if (!Array.isArray(raw.assertions) || !raw.assertions.length)
                findings.push({ severity: "error", rule: "assertions", message: "At least one deterministic assertion is required.", scenario_id: id });
            const ids = new Set();
            if (Array.isArray(raw.assertions))
                raw.assertions.forEach((item, i) => { const p = `${path}.assertions[${i}]`; if (!exactObject(item, ["id", "subject", "operator", "expected", "locator", "deterministic"], [], p, findings, id))
                    return; const assertionId = typeof item.id === "string" ? item.id : ""; if (ids.has(assertionId))
                    findings.push({ severity: "error", rule: "assertion-id", message: `Duplicate assertion id ${assertionId}.`, scenario_id: id, path: `${p}.id` }); ids.add(assertionId); if (!assertionId.trim() || item.deterministic !== true || !validAssertionParts(item.subject, item.operator, item.expected))
                    findings.push({ severity: "error", rule: "deterministic-assertion", message: "Assertions require atomic subject, operator enum, scalar expected, structured locator, and deterministic:true; because/if/when and embedded predicates are forbidden.", scenario_id: id, path: p }); if (typeof item.subject === "string" && typeof item.operator === "string" && own(item, "expected")) {
                    const candidate = { subject: item.subject, operator: item.operator, expected: item.expected };
                    if (/\?|\b(?:quality|appropriate|good|clear|helpful|loves?|feels?|seems?|appears?|believes?|prefers?|likes?|enjoys?)\b/iu.test(assertionText(candidate)))
                        findings.push({ severity: "error", rule: "qualitative-assertion", message: "Move qualitative judgement to review_questions.", scenario_id: id, path: p });
                    if (leaked(s.prompt, candidate))
                        findings.push({ severity: "error", rule: "assertion-leakage", message: `Prompt leaks assertion ${assertionId} wording.`, scenario_id: id, path: p });
                } validateLocator(item.locator, `${p}.locator`, findings, id); });
            validateEdits(raw.user_edits, `${path}.user_edits`, findings, id);
            for (const q of s.review_questions)
                if (!q.trim().endsWith("?"))
                    findings.push({ severity: "warning", rule: "review-question", message: "Qualitative review questions should be phrased as questions.", scenario_id: id });
        }
    if (!exactObject(root.provenance, ["created_by", "created_at", "user_edits"], ["source"], "$.provenance", findings)) { /* finding emitted */ }
    else {
        const provenance = root.provenance;
        if (own(provenance, "source") && (typeof provenance.source !== "string" || !provenance.source.trim()))
            findings.push({ severity: "error", rule: "provenance", message: "provenance.source must be a non-empty string when present.", path: "$.provenance.source" });
        if (typeof provenance.created_by !== "string" || !provenance.created_by.trim())
            findings.push({ severity: "error", rule: "provenance", message: "provenance.created_by must identify the actor.", path: "$.provenance.created_by" });
        if (!isoUtc(provenance.created_at))
            findings.push({ severity: "error", rule: "timestamp", message: "provenance.created_at must be a valid UTC ISO-8601 timestamp.", path: "$.provenance.created_at" });
        validateEdits(provenance.user_edits, "$.provenance.user_edits", findings);
    }
    plan.elicitation_questions = [];
    plan.status = findings.some(f => f.severity === "error") ? "fail" : "frozen";
    if (plan.status === "frozen")
        plan.canonical_content_sha256 = canonicalScenarioHash(plan);
    return plan;
}
export function main() { try {
    const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { draft: { type: "boolean" }, output: { type: "string", short: "o" } } });
    if (!positionals[0])
        throw new TypeError("usage: freeze_eval_scenarios.js <elicitation.json> [--draft] -o <plan.json>");
    const source = resolve(positionals[0]), input = JSON.parse(readFileSync(source, "utf8")), result = values.draft ? deriveScenarioPlan(input, source) : freezeScenarioPlan(input, source), json = JSON.stringify(result, null, 2) + "\n";
    if (values.output) {
        mkdirSync(dirname(resolve(values.output)), { recursive: true });
        writeFileSync(resolve(values.output), json);
    }
    console.log(json.trim());
    process.exit(result.status === "fail" ? 1 : 0);
}
catch (error) {
    console.error(`freeze_eval_scenarios: ${error.message}`);
    process.exit(2);
} }
const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (!import.meta.url.includes("/$bunfs/") && invoked && fileURLToPath(import.meta.url) === invoked)
    main();
