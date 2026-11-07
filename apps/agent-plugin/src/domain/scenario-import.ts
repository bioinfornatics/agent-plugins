import { validatePreparation } from "./retained-preparation.ts";
import { EvaluationError, type Scenario, type ScenarioDiagnostic } from "./evaluation.ts";

export const scenarioExtensionFields = ["name", "subject", "language", "target", "preconditions", "budget", "capabilities", "navigation_expectations", "coverage_tags", "execution_assertions"] as const;
const constraintFields = ["budget", "capabilities", "execution_assertions", "navigation_expectations", "preconditions"] as const;
export type JsonData = null | boolean | number | string | JsonData[] | { [key: string]: JsonData };

/** Sort object keys only; array order and exact text remain authored evidence. */
export function canonicalData(value: JsonData): JsonData {
  if (Array.isArray(value)) return value.map(canonicalData);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalData(value[key] ?? null)]));
  return value;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function jsonData(value: unknown): value is JsonData {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonData);
  return record(value) && Object.values(value).every(jsonData);
}

/** Workspace inputs cannot opt into ambient configuration or treatment instructions.
 * This is a reserved-name policy, not comprehensive detection of secrets authored in data.
 */
export function safeInputPath(path: string): boolean {
  const parts = path.split("/");
  return !!path && !path.includes("\\") && !path.includes(":") && ![...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && parts.length <= 64 &&
    parts.every(part => !!part && part !== "." && part !== ".." &&
      ![".git", ".agents", ".goose", ".config", ".ssh", "node_modules", "SKILL.md", "AGENTS.md", "config.yaml", "secrets.yaml", "permission.yaml", "tool_permissions.json"].includes(part) && !/^\.env(?:\.|$)/.test(part));
}

/** Presence (even empty/false/null) declares a constraint. Diagnostics never grant enforcement. */
export function scenarioDiagnostics(scenario: Pick<Scenario, "extensions">): ScenarioDiagnostic[] {
  return constraintFields.filter(field => Object.hasOwn(scenario.extensions ?? {}, field)).map(field => ({
    code: "unsupported-scenario-constraint", field, message: `Unsupported scenario constraint: ${field}; execution enforcement is not implemented`,
  }));
}
export function assertExecutableScenarios(scenarios: readonly Scenario[]): void {
  for (const scenario of scenarios) {
    validateScenarioImport(scenario);
    const diagnostics = scenarioDiagnostics(scenario);
    if (diagnostics.length) throw new EvaluationError(`${scenario.id}: ${diagnostics.map(diagnostic => diagnostic.message).join("; ")}`);
  }
}

/** Additive schema3 validation: absence is valid for historical frozen campaigns. */
export function validateScenarioImport(scenario: unknown): void {
  function invalid(): never { throw new Error("Invalid stored scenario import payload"); }
  if (!record(scenario)) invalid();
  if (typeof scenario.prompt !== "string") invalid();
  validatePreparation(scenario.preparation, scenario.prompt);
  if (Object.hasOwn(scenario, "expectedOutput") && typeof scenario.expectedOutput !== "string") invalid();
  if (Object.hasOwn(scenario, "extensions") && (!record(scenario.extensions) || Object.keys(scenario.extensions).some(key => !scenarioExtensionFields.includes(key as typeof scenarioExtensionFields[number])) || !jsonData(scenario.extensions))) invalid();
  if (Object.hasOwn(scenario, "suiteMetadata") && (!record(scenario.suiteMetadata) || Object.keys(scenario.suiteMetadata).some(key => key !== "coverage_dimensions") || !jsonData(scenario.suiteMetadata))) invalid();
  if (Object.hasOwn(scenario, "grading") && (!record(scenario.grading) || Object.keys(scenario.grading).length !== 1 || typeof scenario.grading.notable !== "boolean" || scenario.grading.notable !== (Array.isArray(scenario.expectations) && scenario.expectations.length > 0))) invalid();
  if (Object.hasOwn(scenario, "inputs")) {
    if (!Array.isArray(scenario.inputs) || scenario.fixtures !== undefined || !Array.isArray(scenario.fixturesFiles)) invalid();
    const paths = new Set<string>();
    for (const input of scenario.inputs) {
      if (!record(input) || Object.keys(input).sort().join(",") !== "source,workspace" || typeof input.source !== "string" || !safeInputPath(input.source) || input.workspace !== input.source || paths.has(input.source)) invalid();
      paths.add(input.source);
    }
    const captured = new Set<string>();
    let bytes = 0;
    for (const file of scenario.fixturesFiles) {
      if (!record(file) || typeof file.path !== "string" || !safeInputPath(file.path) || typeof file.content !== "string" || typeof file.executable !== "boolean" || captured.has(file.path) || ![...paths].some(path => file.path === path || (file.path as string).startsWith(`${path}/`))) invalid();
      // Base64 shape and exact decoded bounds can be checked without environment-dependent I/O.
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) invalid();
      const length = file.content.length / 4 * 3 - (file.content.endsWith("==") ? 2 : file.content.endsWith("=") ? 1 : 0);
      bytes += length;
      if (length > 4 * 1024 * 1024 || bytes > 64 * 1024 * 1024 || captured.size >= 20_000) invalid();
      captured.add(file.path);
    }
  }
  if (Object.hasOwn(scenario, "diagnostics")) {
    if (!Array.isArray(scenario.diagnostics)) invalid();
    const expected = scenarioDiagnostics(scenario as unknown as Scenario);
    if (JSON.stringify(canonicalData(scenario.diagnostics as JsonData)) !== JSON.stringify(canonicalData(expected as unknown as JsonData))) invalid();
  }
}
