/** Reads the operator's activation queries file once; validation stays in the domain. */
export interface ActivationCaseSource {
  /** Bounded read; `sha256` identifies the exact bytes frozen into the plan. */
  read(path: string): Promise<{ document: unknown; sha256: string }>;
}
