/** Per-column UTF-8 JSON ceilings, not a global grading quota. Keep writer and
 * history aligned: accepted native outcomes (including legacy 9 MiB rationales)
 * must remain readable. Encoding can expand quotes, control text and citations.
 */
const mib = 1024 * 1024;
export const gradingJsonLimits = {
  plan: 128 * mib, snapshot: 128 * mib, receipt: 8 * mib,
  request: 384 * mib, criteria: 8 * mib, manifest: 8 * mib,
  outcome: 16 * mib, provenance: 16 * mib, evidence: 16 * mib,
} as const;
export type GradingJsonField = keyof typeof gradingJsonLimits;

export function validateGradingJsonBytes(text: string, field: GradingJsonField): void {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > gradingJsonLimits[field]) throw new Error(`Stored grading ${field} exceeds JSON byte bound`);
}
export function serializeGradingJson(value: unknown, field: GradingJsonField): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error(`Stored grading ${field} is not JSON`);
  validateGradingJsonBytes(text, field);
  return text;
}
export function parseGradingJson(text: string, field: GradingJsonField): unknown {
  validateGradingJsonBytes(text, field);
  return JSON.parse(text);
}
