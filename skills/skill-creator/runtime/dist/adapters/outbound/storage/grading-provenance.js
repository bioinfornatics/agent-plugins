import { isDeepStrictEqual } from "node:util";
const digest = /^[a-f0-9]{64}$/;
function requireValid(condition) {
    if (!condition)
        throw new Error("Invalid or mismatched judge provenance");
}
/** Shared append/read binding rules: reject noncanonical fields before serialization
 * or DB effects so every accepted append remains readable under the same contract.
 * JSON byte ceilings are independent and enforced by grading-serialization.
 */
export function validateGradingProvenance(value, options, technical) {
    if (value === null) {
        requireValid(technical);
        return null;
    }
    requireValid(value && typeof value === "object");
    const p = value;
    requireValid(p.host?.id === "goose" && (p.host.version === undefined || typeof p.host.version === "string"));
    requireValid(p.model?.effective === "unknown" && p.model.source === (options?.model === undefined ? "configuration-default" : "override") && p.model.requested === options?.model);
    requireValid(p.limits && ["maxTurns", "timeout", "preflightTimeout", "exportTimeout", "outputBytes"].every(key => {
        const v = p.limits[key];
        return Number.isSafeInteger(v) && v !== undefined && v >= (key === "maxTurns" || key === "outputBytes" ? 1 : 0);
    }));
    requireValid(p.limits.maxTurns === (options?.maxTurns ?? 50) && p.limits.timeout === (options?.timeout ?? 0) && p.limits.timeout <= 2147483);
    requireValid(p.sessionName === undefined || (typeof p.sessionName === "string" && p.sessionName.length <= 1024));
    requireValid(p.instructionsSha256 === undefined || (typeof p.instructionsSha256 === "string" && digest.test(p.instructionsSha256)));
    const canonical = { host: { id: "goose", ...(p.host.version === undefined ? {} : { version: p.host.version }) },
        model: { source: p.model.source, effective: "unknown", ...(p.model.requested === undefined ? {} : { requested: p.model.requested }) },
        limits: { maxTurns: p.limits.maxTurns, timeout: p.limits.timeout, preflightTimeout: p.limits.preflightTimeout, exportTimeout: p.limits.exportTimeout, outputBytes: p.limits.outputBytes },
        ...(p.sessionName === undefined ? {} : { sessionName: p.sessionName }), ...(p.instructionsSha256 === undefined ? {} : { instructionsSha256: p.instructionsSha256 }) };
    requireValid(isDeepStrictEqual(p, canonical));
    return canonical;
}
