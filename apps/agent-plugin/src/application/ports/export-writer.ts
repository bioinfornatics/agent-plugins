/** Experimental defensive limits for this projection, not campaign quotas or an SLA. */
export const exportLimits = { selectedGrades: 1000, totalBytes: 512 * 1024 * 1024, jsonBytes: 16 * 1024 * 1024 } as const;
/** Authority for the single replaceable app-owned report view, never arbitrary output. */
export interface CampaignReportContext { campaignId: string; campaignDirectory: string }
/** Post-commit cleanup is diagnostic only; the delivered output remains successful. */
export interface ExportPublicationWarning { output: string; warnings: string[] }
export type ExportPublication = string | ExportPublicationWarning;
/** Explicit destinations are exclusive and never overwritten. Omitted output requires
 * authenticated campaign context and publishes report/export under an exclusive lock.
 * Precommit replacement failures preserve the prior validated export; cleanup after
 * the staged-to-output rename returns warnings and fences regeneration with residue;
 * no crash atomicity
 * or automatic stale-lock recovery. HTML generation is a separate operation. */
export interface ExportWriter {
  publish(output: string | undefined, files: { path: string; content: Uint8Array }[], protectedRoots: string[], context?: CampaignReportContext): Promise<ExportPublication> | Promise<void>;
}
