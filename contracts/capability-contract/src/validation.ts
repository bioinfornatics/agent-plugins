import {
  CAPABILITY_CONTRACT_VERSION,
  type CapabilityContractV1,
  type CapabilityDiagnostic,
  type CapabilityDiagnosticCode,
  type CapabilityValidationResult,
} from "./types.js";

const CANDIDATE_TYPES = new Set(["skill", "agent", "hook", "plugin"]);
const SIDE_EFFECT_KINDS = new Set(["filesystem", "process", "network", "credential", "external-system", "other"]);
const SUCCESS_OPERATORS = new Set(["<", "<=", "=", ">=", ">"]);
const PRODUCTION_LEVELS = new Set(["exploration", "prototype", "internal", "production"]);
const KNOWN_ROOT_FIELDS = new Set([
  "schemaVersion", "compatibility", "objective", "users", "targetTasks",
  "artifactRecommendation", "inputs", "outputs", "sideEffects", "constraints",
  "assumptions", "risks", "successSignals", "targetHosts", "productionBoundary",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function diagnostic(code: CapabilityDiagnosticCode, path: string, message: string, remediation: string): CapabilityDiagnostic {
  return { code, path, message, remediation };
}
function invalid(path: string, expected: string): CapabilityDiagnostic {
  return diagnostic("CAPABILITY_FIELD_INVALID", path, path + " must be " + expected + ".", "Provide " + path + " as " + expected + ".");
}
function validateKnownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, diagnostics: CapabilityDiagnostic[]): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value).sort()) {
    if (!known.has(key)) diagnostics.push(diagnostic("CAPABILITY_UNKNOWN_FIELD", path + "/" + key, "Unknown field is not allowed: " + key + ".", "Remove " + key + " or move future extension data to the contract root under preserve policy."));
  }
}
function validateStringArray(value: unknown, path: string, diagnostics: CapabilityDiagnostic[]): void {
  if (!Array.isArray(value) || value.some((item) => !nonBlank(item))) diagnostics.push(invalid(path, "an array of non-empty strings"));
}
function validateUsers(value: unknown, diagnostics: CapabilityDiagnostic[]): void {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item) || !nonBlank(item.name) || (item.need !== undefined && !nonBlank(item.need)))) {
    diagnostics.push(invalid("/users", "an array of users with a non-empty name and optional need"));
  }
  if (Array.isArray(value)) value.forEach((item, index) => { if (isRecord(item)) validateKnownFields(item, ["name", "need"], "/users/" + index, diagnostics); });
}
function validateValues(value: unknown, path: string, diagnostics: CapabilityDiagnostic[]): void {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item) || !nonBlank(item.name) || !nonBlank(item.description) || typeof item.required !== "boolean" || (item.format !== undefined && !nonBlank(item.format)))) {
    diagnostics.push(invalid(path, "an array of named values with description and required boolean"));
  }
  if (Array.isArray(value)) value.forEach((item, index) => { if (isRecord(item)) validateKnownFields(item, ["name", "description", "required", "format"], path + "/" + index, diagnostics); });
}

export function validateCapabilityContract(value: unknown): CapabilityValidationResult {
  const diagnostics: CapabilityDiagnostic[] = [];
  if (!isRecord(value)) {
    return { valid: false, diagnostics: [diagnostic("CAPABILITY_CONTRACT_NOT_OBJECT", "/", "Capability contract must be a JSON object.", "Provide an object conforming to capability-contract 1.0.0.")] };
  }

  if (!nonBlank(value.schemaVersion)) {
    diagnostics.push(diagnostic("CAPABILITY_VERSION_REQUIRED", "/schemaVersion", "schemaVersion is required.", "Set schemaVersion to " + CAPABILITY_CONTRACT_VERSION + "."));
  } else if (value.schemaVersion !== CAPABILITY_CONTRACT_VERSION) {
    diagnostics.push(diagnostic("CAPABILITY_VERSION_UNSUPPORTED", "/schemaVersion", "Unsupported capability contract version: " + value.schemaVersion + ".", "Use schemaVersion " + CAPABILITY_CONTRACT_VERSION + " or a validator that supports the requested version."));
  }

  const compatibility = value.compatibility;
  if (isRecord(compatibility)) validateKnownFields(compatibility, ["unknownFields"], "/compatibility", diagnostics);
  if (!isRecord(compatibility) || (compatibility.unknownFields !== "reject" && compatibility.unknownFields !== "preserve")) {
    diagnostics.push(diagnostic("CAPABILITY_COMPATIBILITY_REQUIRED", "/compatibility/unknownFields", "An explicit unknownFields compatibility policy is required.", "Set compatibility.unknownFields to reject or preserve."));
  }

  if (!nonBlank(value.objective)) {
    diagnostics.push(diagnostic("CAPABILITY_OBJECTIVE_REQUIRED", "/objective", "A non-empty capability objective is required.", "Describe the user outcome this capability must achieve."));
  }

  if (isRecord(value.artifactRecommendation)) validateKnownFields(value.artifactRecommendation, ["candidateType", "rationale"], "/artifactRecommendation", diagnostics);
  if (!isRecord(value.artifactRecommendation) || !CANDIDATE_TYPES.has(value.artifactRecommendation.candidateType as string) || (value.artifactRecommendation.rationale !== undefined && !nonBlank(value.artifactRecommendation.rationale))) {
    diagnostics.push(diagnostic("CAPABILITY_ARTIFACT_RECOMMENDATION_REQUIRED", "/artifactRecommendation", "An artifact recommendation with candidateType skill, agent, hook, or plugin is required.", "Choose a candidateType and optionally provide a non-empty rationale."));
  }

  const sideEffects = value.sideEffects;
  if (!isRecord(sideEffects) || typeof sideEffects.applicable !== "boolean") {
    diagnostics.push(diagnostic("CAPABILITY_SIDE_EFFECTS_REQUIRED", "/sideEffects", "Side-effect applicability must be declared explicitly.", "Set sideEffects.applicable and list effects when it is true."));
  } else {
    validateKnownFields(sideEffects, ["applicable", "effects"], "/sideEffects", diagnostics);
    const effects = sideEffects.effects;
    if (effects !== undefined && !Array.isArray(effects)) {
      diagnostics.push(invalid("/sideEffects/effects", "an array"));
    } else {
      const effectList = effects ?? [];
      if (sideEffects.applicable && effectList.length === 0) {
        diagnostics.push(diagnostic("CAPABILITY_SIDE_EFFECT_DETAILS_REQUIRED", "/sideEffects/effects", "Applicable side effects require at least one explicit effect.", "List each side effect with its kind and description."));
      }
      if (!sideEffects.applicable && effectList.length > 0) diagnostics.push(invalid("/sideEffects/effects", "empty when sideEffects.applicable is false"));
      if (effectList.some((effect) => !isRecord(effect) || !SIDE_EFFECT_KINDS.has(effect.kind as string) || !nonBlank(effect.description) || (effect.mitigation !== undefined && !nonBlank(effect.mitigation)))) {
        diagnostics.push(invalid("/sideEffects/effects", "effects with a supported kind and non-empty description"));
      }
      effectList.forEach((effect, index) => { if (isRecord(effect)) validateKnownFields(effect, ["kind", "description", "mitigation"], "/sideEffects/effects/" + index, diagnostics); });
    }
  }

  const successSignals = value.successSignals;
  if (!Array.isArray(successSignals) || successSignals.length === 0) {
    diagnostics.push(diagnostic("CAPABILITY_SUCCESS_SIGNAL_REQUIRED", "/successSignals", "At least one measurable success signal is required.", "Add a signal with name, metric, comparison operator, and finite numeric target."));
  } else {
    if (successSignals.some((signal) => !isRecord(signal) || !nonBlank(signal.name) || !nonBlank(signal.metric) || !SUCCESS_OPERATORS.has(signal.operator as string) || typeof signal.target !== "number" || !Number.isFinite(signal.target) || (signal.unit !== undefined && !nonBlank(signal.unit)))) {
      diagnostics.push(invalid("/successSignals", "measurable signals with name, metric, operator, and finite numeric target"));
    }
    successSignals.forEach((signal, index) => { if (isRecord(signal)) validateKnownFields(signal, ["name", "metric", "operator", "target", "unit"], "/successSignals/" + index, diagnostics); });
  }

  const boundary = value.productionBoundary;
  if (!isRecord(boundary) || !PRODUCTION_LEVELS.has(boundary.level as string) || !nonBlank(boundary.statement)) {
    diagnostics.push(diagnostic("CAPABILITY_PRODUCTION_BOUNDARY_REQUIRED", "/productionBoundary", "An explicit production boundary with level and statement is required.", "Declare exploration, prototype, internal, or production scope and describe the boundary."));
  } else {
    validateKnownFields(boundary, ["level", "statement", "conditions", "excludedUses"], "/productionBoundary", diagnostics);
    if (boundary.conditions !== undefined) validateStringArray(boundary.conditions, "/productionBoundary/conditions", diagnostics);
    if (boundary.excludedUses !== undefined) validateStringArray(boundary.excludedUses, "/productionBoundary/excludedUses", diagnostics);
    if (boundary.level === "production" && (!Array.isArray(boundary.conditions) || boundary.conditions.length === 0)) {
      diagnostics.push(diagnostic("CAPABILITY_PRODUCTION_CONDITIONS_REQUIRED", "/productionBoundary/conditions", "Production use requires at least one explicit condition.", "List the operational, security, or approval conditions for production use."));
    }
  }

  if (value.users !== undefined) validateUsers(value.users, diagnostics);
  if (value.targetTasks !== undefined) validateStringArray(value.targetTasks, "/targetTasks", diagnostics);
  if (value.inputs !== undefined) validateValues(value.inputs, "/inputs", diagnostics);
  if (value.outputs !== undefined) validateValues(value.outputs, "/outputs", diagnostics);
  for (const field of ["constraints", "assumptions", "risks", "targetHosts"] as const) {
    if (value[field] !== undefined) validateStringArray(value[field], "/" + field, diagnostics);
  }

  if (isRecord(compatibility) && compatibility.unknownFields === "reject") {
    for (const key of Object.keys(value).sort()) {
      if (!KNOWN_ROOT_FIELDS.has(key)) diagnostics.push(diagnostic("CAPABILITY_UNKNOWN_FIELD", "/" + key, "Unknown root field is not allowed by the reject policy: " + key + ".", "Remove " + key + " or explicitly use compatibility.unknownFields preserve."));
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.map((item) => (item as string).trim()) : [];

export class CapabilityContractValidationError extends Error {
  constructor(readonly diagnostics: CapabilityDiagnostic[]) {
    super(diagnostics.map((item) => item.code + " " + item.path + ": " + item.message).join("\n"));
    this.name = "CapabilityContractValidationError";
  }
}

/** Validate first, then apply deterministic defaults. Invalid or rejected fields are never silently dropped. */
export function normalizeCapabilityContract(value: unknown): CapabilityContractV1 {
  const result = validateCapabilityContract(value);
  if (!result.valid) throw new CapabilityContractValidationError(result.diagnostics);
  const source = value as Record<string, unknown>;
  const compatibility = source.compatibility as CapabilityContractV1["compatibility"];
  return {
    ...(compatibility.unknownFields === "preserve" ? source : {}),
    schemaVersion: CAPABILITY_CONTRACT_VERSION,
    compatibility: { unknownFields: compatibility.unknownFields },
    objective: (source.objective as string).trim(),
    users: ((source.users ?? []) as CapabilityContractV1["users"]).map((user) => ({ name: user.name.trim(), ...(user.need === undefined ? {} : { need: user.need.trim() }) })),
    targetTasks: strings(source.targetTasks),
    artifactRecommendation: { ...(source.artifactRecommendation as CapabilityContractV1["artifactRecommendation"]) },
    inputs: ((source.inputs ?? []) as CapabilityContractV1["inputs"]).map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim(), ...(item.format === undefined ? {} : { format: item.format.trim() }) })),
    outputs: ((source.outputs ?? []) as CapabilityContractV1["outputs"]).map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim(), ...(item.format === undefined ? {} : { format: item.format.trim() }) })),
    sideEffects: {
      ...(source.sideEffects as CapabilityContractV1["sideEffects"]),
      effects: [...(((source.sideEffects as Record<string, unknown>).effects ?? []) as CapabilityContractV1["sideEffects"]["effects"])].map((effect) => ({ ...effect })),
    },
    constraints: strings(source.constraints), assumptions: strings(source.assumptions), risks: strings(source.risks),
    successSignals: (source.successSignals as CapabilityContractV1["successSignals"]).map((signal) => ({ ...signal })),
    targetHosts: strings(source.targetHosts),
    productionBoundary: {
      ...(source.productionBoundary as CapabilityContractV1["productionBoundary"]),
      conditions: strings((source.productionBoundary as Record<string, unknown>).conditions),
      excludedUses: strings((source.productionBoundary as Record<string, unknown>).excludedUses),
    },
  };
}
