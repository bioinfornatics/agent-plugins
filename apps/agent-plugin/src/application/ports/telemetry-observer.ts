/** Host-reported resource usage for one verified attempt (product §34). Every field is
 * an observation copied from the host, never derived from prose, sizes or prices, and
 * absent data stays `null` — never zero. `costUsd` is the host's own estimate with an
 * unknown pricing source/version; it is not a billed amount. */
export interface RunTelemetry {
  source: string;
  tokens: { total: number; input: number; output: number; cacheRead: number | null; cacheWrite: number | null } | null;
  costUsd: number | null;
}
/** Read-only post-trial analysis of verified artifacts. Implementations must not call a
 * model or mutate evidence; unsupported hosts or missing events return undefined. */
export interface TelemetryObserver {
  observe(input: { agent: string; artifacts: readonly { path: string; content: Uint8Array }[] }): RunTelemetry | undefined;
}
