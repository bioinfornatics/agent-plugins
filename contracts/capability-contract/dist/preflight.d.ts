import type { HostPreflightOutcome } from "./preflight-types.js";
/** Resolves every planned job against one discovered host before launch. Malformed input returns a typed fail-closed result and is never negotiated. */
export declare function resolveHostCapabilityPreflight(value: unknown): HostPreflightOutcome;
