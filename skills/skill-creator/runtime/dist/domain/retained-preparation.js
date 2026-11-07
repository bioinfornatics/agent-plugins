import { EvaluationError } from "./evaluation.js";
export const fixtureTokens = ["registry_path", "campaign_id", "with_attempt_id", "without_attempt_id", "new_export_path"];
/** Closed, trusted recipes only. Ordinary JSON braces are not template syntax. */
export function validatePreparation(value, prompt) {
    if (value !== undefined) {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "campaign,kind,version" ||
            !("kind" in value) || value.kind !== "retained-evaluation" || !("version" in value) || value.version !== 1 ||
            !("campaign" in value) || (value.campaign !== "completed" && value.campaign !== "interrupted"))
            throw new EvaluationError("Invalid retained preparation declaration");
    }
    for (const token of prompt.match(/\{\{fixture\.[^}]*\}\}/g) ?? []) {
        const key = token.slice(10, -2);
        if (!value || !fixtureTokens.includes(key) || (value.campaign === "interrupted" && key === "without_attempt_id"))
            throw new EvaluationError(`Unbound fixture token: ${token}`);
    }
    if (prompt.replace(/\{\{fixture\.[^}]*\}\}/g, "").includes("{{fixture."))
        throw new EvaluationError("Malformed fixture token");
}
/** Textual paths/bindings must not introduce control bytes or template delimiters.
 * This is prompt/argv safety, not a filesystem sandbox. */
export function assertSafeFixtureValue(value) {
    if (!value.trim() || [...value].some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)) || value.includes("{{") || value.includes("}}"))
        throw new EvaluationError("Unsafe fixture path or binding");
}
/** POSIX single-quoted argument semantics for paths containing spaces/metacharacters.
 * Never rescan substituted values; UUIDs and simple paths retain their literal spelling. */
function quoteFixtureValue(value) {
    return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
export function bindFixturePrompt(prompt, declaration, bindings) {
    validatePreparation(declaration, prompt);
    for (const value of Object.values(bindings)) {
        if (typeof value !== "string")
            throw new EvaluationError("Unsafe fixture binding");
        assertSafeFixtureValue(value);
    }
    return prompt.replace(/\{\{fixture\.([^}]+)\}\}/g, (_, key) => {
        const value = bindings[key];
        if (typeof value !== "string" || !value.trim())
            throw new EvaluationError(`Missing fixture binding: ${key}`);
        return quoteFixtureValue(value);
    });
}
