/** Experimental defensive limits for this projection, not campaign quotas or an SLA. */
export const exportLimits = { selectedGrades: 1000, totalBytes: 512 * 1024 * 1024, jsonBytes: 16 * 1024 * 1024 } as const;
/** A parseable complete manifest with no pending marker signals delivery readiness,
 * not permanent authenticity of mutable output. Dedicated temporary staging is disposable;
 * destination cleanup must preserve user files. A crash may leave an explicit pending
 * directory; implementations never overwrite or automatically repair prior exports. */
export interface ExportWriter {
  publish(output: string, files: { path: string; content: Uint8Array }[], protectedRoots: string[]): Promise<void>;
}
