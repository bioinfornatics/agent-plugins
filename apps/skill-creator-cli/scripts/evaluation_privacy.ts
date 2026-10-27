/** Private provenance: never serialize these values in public reports or bindings. */
export interface EvaluationSensitiveValue {
    value: string;
    kind: "credential" | "opaque";
    source: "secret-key" | "secret-file" | "credential-body" | "auth-argument" | "opaque-config" | "support-file";
}
const lexical = /[A-Za-z0-9_./\\:@%+~-]/;
/** Short opaque tokens cannot match components of paths, numbers or larger words. */
export function matchesSensitiveValue(text: string, sensitive: EvaluationSensitiveValue): boolean {
    const value = sensitive.value;
    if (!value) return false;
    if (sensitive.kind === "credential" || value.length >= 8) return text.includes(value);
    let at = text.indexOf(value);
    while (at !== -1) {
        const before = at === 0 ? "" : text[at - 1], after = text[at + value.length] ?? "";
        if ((!before || !lexical.test(before)) && (!after || !lexical.test(after))) return true;
        at = text.indexOf(value, at + 1);
    }
    return false;
}
export function containsSensitiveValue(text: string, values: readonly EvaluationSensitiveValue[]): boolean {
    return values.some(value => matchesSensitiveValue(text, value));
}
export class EvaluationSensitiveCapture extends Set<string> {
    readonly provenance: EvaluationSensitiveValue[] = [];
    record(value: string, kind: EvaluationSensitiveValue["kind"], source: EvaluationSensitiveValue["source"]): void {
        if (!value) return;
        super.add(value);
        const existing = this.provenance.find(item => item.value === value);
        if (!existing) this.provenance.push({value, kind, source});
        else if (kind === "credential") Object.assign(existing, {kind, source});
    }
    override add(value: string): this { this.record(value, "opaque", "support-file"); return this; }
}

/** Apply the same provenance-aware matching policy used by public configuration projection. */
export function redactSensitiveValues(text: string, values: readonly EvaluationSensitiveValue[]): string {
    for (const sensitive of [...values].sort((a,b) => b.value.length - a.value.length)) {
        if (!matchesSensitiveValue(text, sensitive)) continue;
        if (sensitive.kind === "credential" || sensitive.value.length >= 8) {
            text = text.split(sensitive.value).join("[REDACTED]");
            continue;
        }
        let at = text.indexOf(sensitive.value);
        while (at !== -1) {
            const before = at === 0 ? "" : text[at-1], after = text[at+sensitive.value.length] ?? "";
            if ((!before || !lexical.test(before)) && (!after || !lexical.test(after))) {
                text = text.slice(0,at) + "[REDACTED]" + text.slice(at+sensitive.value.length);
                at = text.indexOf(sensitive.value,at+10);
            } else at = text.indexOf(sensitive.value,at+1);
        }
    }
    return text;
}
