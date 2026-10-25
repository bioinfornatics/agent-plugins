import { recommendArtifact } from "./recommendation.js";
import { ADAPTIVE_ELICITATION_VERSION, AMBIGUITY_CLASSES, DECISION_KINDS, KNOWLEDGE_STATES, } from "./elicitation-types.js";
const OWN = Object.prototype.hasOwnProperty;
const REQUIRED_CONFIRMATION = new Set(["destructive", "security", "production", "untestable"]);
const DECISION_VALUE = { architecture: 30, safety: 50, evaluation: 20 };
const STATE_VALUE = { known: 0, assumed: 10, unknown: 20, contradictory: 30 };
const ID = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/;
const INVALID_INPUT = "request contains an inaccessible, accessor-backed, cyclic, or excessively nested value";
const MAX_SNAPSHOT_DEPTH = 32;
const MAX_SNAPSHOT_NODES = 10_000;
/** Copies data properties without invoking user code. Proxy traps are contained by the caller. */
function safeSnapshot(value) {
    const ancestors = new Set();
    let nodes = 0;
    const visit = (current, depth) => {
        if (current === null || typeof current !== "object")
            return current;
        if (depth > MAX_SNAPSHOT_DEPTH || ++nodes > MAX_SNAPSHOT_NODES || ancestors.has(current))
            throw new TypeError(INVALID_INPUT);
        ancestors.add(current);
        try {
            const descriptors = Object.getOwnPropertyDescriptors(current);
            const keys = Reflect.ownKeys(descriptors);
            if (Array.isArray(current)) {
                const length = descriptors.length;
                if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 100)
                    throw new TypeError(INVALID_INPUT);
                const copy = new Array(length.value);
                for (const key of keys) {
                    if (key === "length")
                        continue;
                    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length.value)
                        throw new TypeError(INVALID_INPUT);
                    const descriptor = descriptors[key];
                    if (!("value" in descriptor))
                        throw new TypeError(INVALID_INPUT);
                    Object.defineProperty(copy, key, { value: visit(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
                }
                return copy;
            }
            const copy = {};
            for (const key of keys) {
                if (typeof key !== "string")
                    throw new TypeError(INVALID_INPUT);
                const descriptor = descriptors[key];
                if (!("value" in descriptor))
                    throw new TypeError(INVALID_INPUT);
                Object.defineProperty(copy, key, { value: visit(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
            }
            return copy;
        }
        finally {
            ancestors.delete(current);
        }
    };
    try {
        return visit(value, 0);
    }
    catch {
        throw new TypeError(INVALID_INPUT);
    }
}
function object(value, name, keys) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new TypeError(`${name} must be an object`);
    for (const key of Object.keys(value))
        if (!keys.includes(key))
            throw new TypeError(`${name} has an unknown property`);
}
function text(value, name, max = 4000) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > max)
        throw new TypeError(`${name} must be a non-empty string of at most ${max} characters`);
}
function identifier(value, name) {
    if (typeof value !== "string" || !ID.test(value))
        throw new TypeError(`${name} must be a lowercase portable identifier`);
}
function dense(value, name) {
    for (let index = 0; index < value.length; index += 1)
        if (!OWN.call(value, index))
            throw new TypeError(`${name} must be dense`);
}
function stringList(value, name) {
    if (!Array.isArray(value) || value.length > 100)
        throw new TypeError(`${name} must be an array of at most 100 identifiers`);
    dense(value, name);
    const seen = new Set();
    for (const item of value) {
        identifier(item, `${name} item`);
        if (seen.has(item))
            throw new TypeError(`${name} contains a duplicate`);
        seen.add(item);
    }
}
function assertField(value, index) {
    const name = `fields[${index}]`;
    object(value, name, ["id", "label", "state", "value", "evidence", "decisions", "ambiguity", "question", "default"]);
    identifier(value.id, `${name}.id`);
    text(value.label, `${name}.label`, 200);
    if (!KNOWLEDGE_STATES.includes(value.state))
        throw new TypeError(`${name}.state is invalid`);
    if (OWN.call(value, "value"))
        text(value.value, `${name}.value`);
    if (!Array.isArray(value.evidence) || value.evidence.length > 100)
        throw new TypeError(`${name}.evidence must be an array of at most 100 items`);
    dense(value.evidence, `${name}.evidence`);
    const evidenceIds = new Set();
    value.evidence.forEach((item, evidenceIndex) => {
        const itemName = `${name}.evidence[${evidenceIndex}]`;
        object(item, itemName, ["id", "state", "summary", "source"]);
        identifier(item.id, `${itemName}.id`);
        if (evidenceIds.has(item.id))
            throw new TypeError(`${name}.evidence contains a duplicate id`);
        evidenceIds.add(item.id);
        if (!KNOWLEDGE_STATES.includes(item.state))
            throw new TypeError(`${itemName}.state is invalid`);
        text(item.summary, `${itemName}.summary`);
        if (OWN.call(item, "source"))
            text(item.source, `${itemName}.source`);
    });
    if (!Array.isArray(value.decisions) || value.decisions.length === 0 || value.decisions.length > 3)
        throw new TypeError(`${name}.decisions must contain one to three items`);
    dense(value.decisions, `${name}.decisions`);
    const decisions = new Set(value.decisions);
    if (decisions.size !== value.decisions.length || value.decisions.some((item) => !DECISION_KINDS.includes(item)))
        throw new TypeError(`${name}.decisions is invalid or duplicated`);
    if (!AMBIGUITY_CLASSES.includes(value.ambiguity))
        throw new TypeError(`${name}.ambiguity is invalid`);
    text(value.question, `${name}.question`, 500);
    if (OWN.call(value, "default")) {
        object(value.default, `${name}.default`, ["value", "reversible", "consequence"]);
        text(value.default.value, `${name}.default.value`);
        text(value.default.consequence, `${name}.default.consequence`);
        if (value.default.reversible !== true)
            throw new TypeError(`${name}.default.reversible must be true`);
        if (REQUIRED_CONFIRMATION.has(value.ambiguity))
            throw new TypeError(`${name}.default is forbidden for mandatory-confirmation ambiguity`);
    }
}
function assertRequest(value) {
    object(value, "request", ["version", "outcome", "explicitType", "expertise", "fields", "context"]);
    if (value.version !== ADAPTIVE_ELICITATION_VERSION)
        throw new TypeError("version must be 1.0.0");
    text(value.outcome, "outcome");
    if (OWN.call(value, "explicitType"))
        text(value.explicitType, "explicitType", 64);
    if (OWN.call(value, "expertise") && value.expertise !== "novice" && value.expertise !== "expert")
        throw new TypeError("expertise must be novice or expert");
    if (!Array.isArray(value.fields) || value.fields.length > 100)
        throw new TypeError("fields must be an array of at most 100 items");
    dense(value.fields, "fields");
    const ids = new Set();
    value.fields.forEach((field, index) => { assertField(field, index); if (ids.has(field.id))
        throw new TypeError("fields contains a duplicate id"); ids.add(field.id); });
    if (OWN.call(value, "context")) {
        object(value.context, "context", ["answeredFieldIds", "askedQuestionIds"]);
        if (OWN.call(value.context, "answeredFieldIds"))
            stringList(value.context.answeredFieldIds, "context.answeredFieldIds");
        if (OWN.call(value.context, "askedQuestionIds"))
            stringList(value.context.askedQuestionIds, "context.askedQuestionIds");
    }
}
function defaultFor(field) {
    return field.default ?? { value: "conservative", reversible: true, consequence: "Uses a conservative provisional choice for " + field.label.trim() + "; change it before finalization if needed." };
}
function cloneField(field, unresolved) {
    const generatedDefault = unresolved && !REQUIRED_CONFIRMATION.has(field.ambiguity) ? defaultFor(field) : field.default;
    return { ...field, evidence: field.evidence.map((item) => ({ ...item })), decisions: [...field.decisions], ...(generatedDefault ? { default: { ...generatedDefault } } : {}) };
}
/** Plans at most three high-value questions without performing I/O or mutating input. */
export function planAdaptiveElicitation(input) {
    input = safeSnapshot(input);
    assertRequest(input);
    const answered = new Set(input.context?.answeredFieldIds ?? []);
    const asked = new Set(input.context?.askedQuestionIds ?? []);
    const unresolved = input.fields.filter((field) => field.state !== "known" && !answered.has(field.id));
    const unresolvedIds = new Set(unresolved.map((field) => field.id));
    const candidates = [];
    for (const field of unresolved) {
        const id = `field:${field.id}`;
        if (asked.has(id))
            continue;
        const mandatory = REQUIRED_CONFIRMATION.has(field.ambiguity);
        if (!mandatory && input.expertise === "expert" && field.state === "assumed")
            continue;
        const decisionScore = field.decisions.reduce((sum, decision) => sum + DECISION_VALUE[decision], 0);
        const score = (mandatory ? 1000 : 0) + STATE_VALUE[field.state] + decisionScore;
        candidates.push({ id, fieldId: field.id, prompt: field.question.trim(), mandatory, ambiguity: field.ambiguity, value: { score, decisions: [...field.decisions], rationale: `Clarifies ${field.decisions.join(", ")} decisions; state=${field.state}; ambiguity=${field.ambiguity}.` }, ...(!mandatory ? { default: { ...defaultFor(field) } } : {}) });
    }
    candidates.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || b.value.score - a.value.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const questions = candidates.slice(0, 3);
    const selected = new Set(questions.map((question) => question.fieldId));
    const unresolvedMandatory = unresolved.filter((field) => REQUIRED_CONFIRMATION.has(field.ambiguity)).map((field) => field.id);
    const deferredMandatoryFieldIds = unresolvedMandatory.filter((id) => !selected.has(id));
    const unansweredOptional = unresolved.filter((field) => !REQUIRED_CONFIRMATION.has(field.ambiguity)).map((field) => field.id);
    const appliedDefaults = unresolved.filter((field) => !REQUIRED_CONFIRMATION.has(field.ambiguity)).map((field) => { const fallback = defaultFor(field); return { fieldId: field.id, value: fallback.value, consequence: fallback.consequence, reversible: true }; });
    return {
        version: ADAPTIVE_ELICITATION_VERSION,
        recommendation: recommendArtifact({ version: "1.0.0", outcome: input.outcome, ...(input.explicitType === undefined ? {} : { explicitType: input.explicitType }) }),
        model: { fields: input.fields.map((field) => cloneField(field, unresolvedIds.has(field.id))) },
        questions,
        deferredMandatoryFieldIds,
        preview: { ready: unresolvedMandatory.length === 0, unansweredOptionalFieldIds: unansweredOptional, appliedDefaults, blockers: unresolvedMandatory.map((id) => `Confirmation required for ${id}.`) },
    };
}
