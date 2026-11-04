const lexical = /[A-Za-z0-9_./\\:@%+~-]/;
/** Short opaque tokens cannot match components of paths, numbers or larger words. */
export function matchesSensitiveValue(text, sensitive) {
    const value = sensitive.value;
    if (!value)
        return false;
    if (sensitive.kind === "credential" || value.length >= 8)
        return text.includes(value);
    let at = text.indexOf(value);
    while (at !== -1) {
        const before = at === 0 ? "" : text[at - 1], after = text[at + value.length] ?? "";
        if ((!before || !lexical.test(before)) && (!after || !lexical.test(after)))
            return true;
        at = text.indexOf(value, at + 1);
    }
    return false;
}
export function containsSensitiveValue(text, values) {
    return values.some(value => matchesSensitiveValue(text, value));
}
export class EvaluationSensitiveCapture extends Set {
    provenance = [];
    record(value, kind, source) {
        if (!value)
            return;
        super.add(value);
        const existing = this.provenance.find(item => item.value === value);
        if (!existing)
            this.provenance.push({ value, kind, source });
        else if (kind === "credential")
            Object.assign(existing, { kind, source });
    }
    add(value) { this.record(value, "opaque", "support-file"); return this; }
}
/** Apply the same provenance-aware matching policy used by public configuration projection. */
export function redactSensitiveValues(text, values) {
    for (const sensitive of [...values].sort((a, b) => b.value.length - a.value.length)) {
        if (!matchesSensitiveValue(text, sensitive))
            continue;
        if (sensitive.kind === "credential" || sensitive.value.length >= 8) {
            text = text.split(sensitive.value).join("[REDACTED]");
            continue;
        }
        let at = text.indexOf(sensitive.value);
        while (at !== -1) {
            const before = at === 0 ? "" : text[at - 1], after = text[at + sensitive.value.length] ?? "";
            if ((!before || !lexical.test(before)) && (!after || !lexical.test(after))) {
                text = text.slice(0, at) + "[REDACTED]" + text.slice(at + sensitive.value.length);
                at = text.indexOf(sensitive.value, at + 10);
            }
            else
                at = text.indexOf(sensitive.value, at + 1);
        }
    }
    return text;
}
