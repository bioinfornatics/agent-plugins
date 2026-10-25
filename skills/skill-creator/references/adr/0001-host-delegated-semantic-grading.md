# ADR 0001: Host-delegated semantic grading is the reference path; nested goose-run grading is an explicit compatibility fallback

- **Status:** Accepted
- **Date:** 2026-09-21
- **Decision story:** ap-8di.1
- **Scope:** Skill Creator's semantic (non-deterministic) evaluation grading path only. Deterministic checkers (`contains`/`not-contains`/`regex`/JSON-pointer) in `evaluator_grading.ts` are unaffected; this ADR does not change their behavior, evidence, or trust boundary.

## Context

Skill Creator's `full-eval` pipeline runs a fixed phase sequence — `validate`, `authoring-audit`, `evaluation-design`, `scaffold`, `paired-runs-and-grading`, `aggregate`, `static-review`, `receipt`, `post-evaluation-pattern-review`, `verify` (`apps/skill-creator-cli/scripts/full_eval.ts`) — as a durable, checkpointable, resumable job. Every phase today executes synchronously inside the Skill Creator CLI process.

Semantic assertions (`classification: "semantic"` in `evaluator_grading.ts`) require an LLM judgment that a deterministic checker cannot express. The only implemented adapter, `CommandGraderAdapter`, spawns a **nested** `goose run --no-session --quiet --output-format stream-json` child process per grader per assertion, configured via `SKILL_CREATOR_GRADER_COMMAND` (`execution_sampling_protocol.ts`, `paired_execution.ts`). This has three structural costs:

1. **Credential/session coupling.** The CLI must locate a working `goose` binary and any model credentials it needs, even though Skill Creator is otherwise a deterministic, offline-capable tool (`skill-creator migrate-evaluation`, `verify_skill_gates`, etc. all work without model access).
2. **Opaque nesting.** A goose-run parent session that invokes `full-eval`, which itself spawns nested `goose run` grader children, makes cost/turn/token accounting, cancellation, and interactive progress harder to reason about than one level of orchestration.
3. **No native place for a human-observed, host-delegated grading step**, even though Goose (the reference host) already supports independent subagent delegation (`delegate` tool: `async`, `context`, `model` override) that can carry an explicit model per grader without nesting a full `goose run` subprocess underneath the CLI.

Existing invariants that any new path must preserve, because they are already load-bearing and tested (`test_evaluator_grading.test.ts`, `paired_execution.ts`):

- Judgments carry `grader_identity_sha256`, `grader_config_sha256`, `invocation_id`, `invocation_nonce_sha256`, and `blinded`; **at least two graders with distinct blinded invocation IDs** are required before a semantic assertion can resolve to anything but `inconclusive` (`gradeOutput`, `aggregateJudgments`).
- A judgment's `evidence_quote` must be an exact, non-empty substring of the candidate output, must substantively overlap the criterion (`substantiveOverlap`), and must not be a self-referential grading claim (`META_GRADE`); otherwise it is forced to `invalid_evidence`/`inconclusive` (`parseJudgment`).
- Grading is `authority: "evaluator"` output bound by SHA-256 to the exact assertion set, variant, and output (`assertion_sha256`, `variant_sha256`, `output_sha256`); nothing may attach a judgment to different evidence after the fact.
- `full-eval` is a durable, lock-serialized, resumable job (`checkpoint`, `acquireJobLock`, `invalidateFrom`); any new phase or pause point must fit this same durable-state discipline, not a parallel ad hoc mechanism.

ACP (Agent Client Protocol) and a server-managed grading session were considered and are explicitly out of scope for this first implementation: they would require Skill Creator to hold a live session/transport to a model-capable process, reintroducing the credential/session coupling this ADR removes. A filesystem-based, host-neutral request/response protocol has no such requirement and matches the CLI's existing durable-job model.

## Decision

### 1. Reference path: Goose-delegated grading, filesystem-mediated

The reference semantic-grading flow becomes:

1. `full-eval` runs phases through `paired-runs-and-grading` as today for deterministic assertions and candidate/baseline generation, but **stops** before invoking any nested grader for semantic assertions. The job durably records a new terminal-until-resumed status, `awaiting-grading`, instead of blocking on internal grader invocation.
2. Skill Creator deterministically **prepares a grading request bundle**: for every semantic assertion needing judgment, a blinded, self-contained record — assertion criterion, candidate output (or output digest reference), variant alias, and a distinct `invocation_id` per required grader slot — written to a well-known path under the evaluation workspace. This is pure data preparation; it requires no model credentials and is itself deterministic and offline-testable.
3. **Goose, the reference host**, reads the prepared bundle and delegates each grading request to an **independent grader subagent** with an **explicit model** selection (mirroring the `delegate` tool's `model` parameter), one delegate per required blinded grader slot. Goose is responsible for actually calling a model; Skill Creator never needs direct model credentials for this step.
4. Each grader subagent's structured verdict (`verdict`, `evidence_quote`, `rationale`) is written back as a **judgment file** at a path Skill Creator specifies in the prepared bundle.
5. Skill Creator deterministically **imports and validates** every judgment file: re-derives `grader_identity_sha256`/`grader_config_sha256`/`invocation_nonce_sha256`, re-checks evidence containment/substantive-overlap/anti-self-reference, and re-binds to `assertion_sha256`/`variant_sha256`/`output_sha256`, exactly as `parseJudgment`/`aggregateJudgments` do today — the validation logic does not get weaker because the judgment arrived from a delegate instead of a subprocess.
6. `full-eval --resume` transitions `awaiting-grading` to `paired-runs-and-grading succeeded` once all required judgments for a scenario are present and valid, then proceeds through `aggregate` → `static-review` → `receipt` → `post-evaluation-pattern-review` → `verify` unchanged.

This flow is host-neutral only in the sense that it is filesystem-based and does not require ACP: any host capable of (a) reading the prepared bundle, (b) invoking an independent, explicitly-modeled grading step per required slot, and (c) writing back a judgment file in the documented shape can drive it. Goose is the first and only implemented orchestrator.

### 2. Trust boundary

- Skill Creator (the CLI) remains the **sole authority** for: assertion normalization, evidence validation, independence/blinding checks, SHA-256 binding, aggregation, and every existing gate (`verify_skill_gates`, receipt, release verification). None of this moves to the host.
- The host (Goose) is trusted only to: read the prepared bundle, run each delegated grading task with the identity it was given (an explicit model, a distinct blinded invocation), and write back the delegate's raw structured response unmodified. The host is never trusted to assert `valid_evidence`, pass/fail a criterion by fiat, or bypass independence requirements — those checks are always re-derived deterministically on import, identically to the existing `CommandGraderAdapter` path today.
- A forged, duplicate, stale (wrong `assertion_sha256`/`variant_sha256`/`output_sha256`), or non-substantive judgment fails closed into `invalid_evidence`/`inconclusive`, exactly as an untrusted subprocess response does today. Host delegation does not relax this; it changes only how the judgment is produced, not how it is trusted.

### 3. Lifecycle states

Add one durable phase status value, `awaiting-grading`, scoped to the `paired-runs-and-grading` phase:

| Status | Meaning |
|---|---|
| `pending` / `running` | Unchanged. |
| `awaiting-grading` | Deterministic grading request bundle is prepared and durably checkpointed; no nested grader has been invoked; the job is waiting for externally-produced judgment files. Not a failure. Machine output must include the exact prepare/status/resume commands, mirroring the existing "blocked checkpoint is not an evaluation failure" convention in `evaluation-workflow.md`. |
| `succeeded` | All required judgments imported and valid (or phase had no semantic assertions). |
| `blocked` / `failed` / `cancelled` / `stale` | Unchanged; a request bundle that goes stale (workspace mutated, plan hash mismatch) is invalidated the same way `invalidateFrom` already invalidates downstream phases today. |

### 4. Independent/blinded grader requirements

Unchanged from today's `gradeOutput`: at least two graders, distinct `id`s, distinct blinded `invocation_id`s, budget-limited (`grading_budget.used`/`limit`). Host delegation must produce one independent delegate invocation per required grader slot; a host that cannot guarantee independent, separately-modeled delegate execution must not claim more than one valid grader slot filled.

### 5. Cancellation/resume semantics

- `full-eval --resume` on an `awaiting-grading` job re-scans for judgment files and imports whatever is newly present; partial judgment sets keep the phase in `awaiting-grading` until the required count for every assertion is met (or a fixed compatibility rule already accepted an incomplete set — see `--finalize-release` behavior, unchanged).
- Cancelling a run (`SIGINT`, job cancel) leaves the prepared bundle and any imported judgments in place; nothing is retried automatically. A new `full-eval --resume` is always required to advance, matching the existing durable-job model.
- There is no server-managed grading session to keep alive or tear down; each delegate invocation is independent and stateless from Skill Creator's perspective.

### 6. Offline behavior

- `prepare-grading` (bundle generation) and judgment import/verification are pure, deterministic, and fully testable offline — no model access required, matching the existing offline-first posture of `verify_skill_gates`, `migrate-evaluation`, and friends.
- Without a host willing to delegate grading, a job simply remains `awaiting-grading` indefinitely; this is an explicit, inspectable state, never a silent hang or a fabricated pass.

### 7. Deprecation/compatibility policy for `SKILL_CREATOR_GRADER_COMMAND` and nested `goose-run` grading

- `CommandGraderAdapter` and `SKILL_CREATOR_GRADER_COMMAND` are **not removed**. They become an **explicit compatibility fallback**, opt-in via a documented flag/environment marker, for environments without a delegating host (e.g., pure CLI automation, CI, or a host that has not implemented the bundle/judgment protocol).
- The compatibility fallback keeps its current behavior and trust boundary unchanged: it is not weakened, and it is not the default for a Goose-orchestrated run.
- Documentation must distinguish the two paths explicitly and never let a reader default to nested subprocess grading without choosing it.

### 8. Non-goals

- **ACP is not introduced.** No Agent Client Protocol transport, no server-managed session, no bidirectional RPC. The bundle/judgment protocol is filesystem-based and stateless from Skill Creator's side.
- **No relaxation of evidence, independence, or binding requirements.** Every validation rule enforced against `CommandGraderAdapter` output today applies identically to imported delegate judgments.
- **No new credential handling in Skill Creator.** Model access is entirely the delegating host's responsibility.
- **No change to deterministic assertion checking**, aggregation math beyond judgment provenance, or any phase outside `paired-runs-and-grading`/`aggregate`.

## Consequences

- Skill Creator can run fully offline through `prepare-grading`, and independently, judgment import/verification also runs fully offline; only the actual grading call requires a model, and that call is the host's responsibility.
- A Goose parent session driving `full-eval` no longer needs to spawn nested `goose run` grader children; it delegates instead, which is visible, cancellable, and independently modeled per the host's own subagent tooling.
- The existing evidence/independence/binding contract carries over unchanged, so no previously-issued receipt's trust story changes retroactively.
- Follow-on work (blocked on this ADR) must specify the exact versioned bundle/judgment JSON contracts (ap-8di.2), implement `prepare-grading`/`grading-status` commands (ap-8di.3), implement judgment import/verification (ap-8di.4), add the Goose subagent workflow (ap-8di.5), wire `awaiting-grading` into `full_eval.ts` (ap-8di.6), formalize the compatibility fallback (ap-8di.7), and harden provenance/privacy/budgets (ap-8di.8) before end-to-end tests (ap-8di.9) and documentation/migration (ap-8di.10) can close.
