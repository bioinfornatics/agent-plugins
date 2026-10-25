# Behavioral evaluation workflow

Read this reference only when the user asks to evaluate, test, benchmark, compare, or prove improvement of a Skill.

## Completion contract

A complete evaluation contains:

- an eval set and one `eval_metadata.json` per case;
- paired `with_skill` and `old_skill` or `without_skill` runs;
- saved outputs or transcripts for every run;
- `timing.json` for every run, using null values with a reason when metrics are unavailable;
- `grading.json` for every run, with exactly `text`, `passed`, and `evidence` in each expectation;
- `benchmark.json` and `benchmark.md` produced by `aggregate_benchmark.js`;
- a review artifact produced by `eval-viewer/generate_review.js`;
- analyst findings and an accept, revise, or blocked decision.

Trigger-description evaluation (`run_eval.js` or `run_loop.js`) does not replace behavioral evaluation.

## Execution order

### 1. Freeze cases and baseline

Create realistic cases in `evals/evals.json`. For an improved Skill, snapshot the old Skill before editing. For a new Skill, use a no-Skill baseline.

For each case create:

```text
<workspace>/iteration-N/eval-<id>/
├── eval_metadata.json
├── with_skill/
│   └── outputs/
└── old_skill/ or without_skill/
    └── outputs/
```

Metadata format:

```json
{
  "eval_id": 1,
  "eval_name": "descriptive-name",
  "prompt": "realistic user request",
  "assertions": []
}
```

### 2. Launch paired runs together

Launch the current and baseline run for every case in the same turn. Keep inputs and requested outputs identical. Save complete task outputs and privacy-safe evidence projections in their assigned run directories; never persist raw provider streams, private reasoning, or raw tool arguments.

The Goose reference adapter can execute scaffolded pairs directly:

```bash
skill-creator full-eval <skill-directory> --workspace <workspace> \
  --execute --model <model> [--baseline old_skill --baseline-skill <snapshot>]
```

A successful one-command run intentionally stops review-ready when no human decision was supplied; that blocked checkpoint is not an evaluation failure. Machine output includes ordered executable recovery commands, and `--resume` begins at the first incomplete phase.

Each run uses `goose run --no-session` in a fresh temporary workspace. The adapter enforces the scenario model, declared tools, timeout, and `budget.max_turns` (default 40 when omitted). It records the host version, exit reason, duration, reported tokens or an explicit unavailability reason, output, grading, and bound execution evidence. `transcript.json` and `events.json` are sanitized projections containing bounded event type/timing, tool name, safe workspace-relative locator when available, and explicit redaction markers—not raw transcripts. A missing or failing host returns a typed blocked/failure receipt; omit `--execute` to preserve the manual evidence workflow.

### 3. Define assertions while runs execute

Use objective, discriminating assertions. Prefer programmatic checks for deterministic outputs and qualitative review for subjective quality. Update both the eval set and metadata.

### 4. Capture timing and normalized telemetry

Record reported duration and token data immediately. If the backend does not expose a metric, write null plus an `unavailable_reason`; never invent it. Provider usage and cost are read only from provider event metadata, never assistant output or nested output JSON. Counts are nonnegative safe integers and aliases must agree. When all five additive components (input, output, reasoning, cache read, cache write) are present, total must equal their sum. With a partial component set, total must be at least the sum of reported components; a smaller total is contradictory and unavailable. This documented lower-bound rule accommodates providers that omit zero or separately accounted components without accepting contradictions. A currency-specific field fixes its currency: `cost_usd` means USD and conflicts with explicit non-USD metadata. Generic cost requires one agreeing supported ISO currency. TTFA begins after preflight and host-version discovery, and advances only for an observable tool request or terminal non-reasoning task output.

Tool, reference, and file metrics persist occurrence and unique counts separately. Navigation evidence contains only bounded workspace-relative locators. URI schemes, userinfo, query strings, fragments, controls, absolute/escaping paths, and credential-like values are redacted. Malformed stream JSON creates typed invalid parse provenance and a redacted parse-error event. A run may continue only when a separately parsed valid terminal output exists; parse errors remain recorded even then. The telemetry schema version and parser protocol are part of run/cache identity, so legacy cached entries safely miss while legacy evidence remains readable.

#### Efficiency metric taxonomy and attribution boundary

Paired reports classify every metric before making a downstream-savings statement:

- **Context/overhead:** input tokens, cache-read tokens, cache-write tokens, and any future prompt/context-overhead metric. These may describe context overhead but never prove downstream execution savings.
- **Downstream execution:** output tokens, reasoning tokens, turns, tool calls, execution-derived reference/file reads, time to first useful action (TTFA), total duration, and retries. Only a negative paired mean for one of these component-specific metrics can support observed downstream savings.
- **Overall consumption:** total tokens. Its paired delta may be reported, but because it includes context/prompt overhead it can never independently prove downstream savings.
- **Resource tradeoff:** provider cost unless the provider exposes compatible context and downstream cost components. Aggregate cost is not treated as downstream savings.

Savings are paired observed differentials, not causal attribution. Input/cache/total-token reductions and metrics containing prompt or context overhead are explicitly excluded from downstream evidence. Reference and file counts qualify only when derived from observed execution. When component decomposition is absent—for example, only `total_tokens` or aggregate cost is available—the report marks downstream attribution unavailable rather than inferring it. JSON, Markdown, and review tables expose each metric’s category, eligibility, and boundary.

### 5. Grade every run

Read `../agents/grader.md`. Evaluate each assertion against the actual outputs and write:

```json
{
  "expectations": [
    {"text": "...", "passed": true, "evidence": "..."}
  ],
  "summary": {"pass_rate": 1}
}
```

### 6. Aggregate and analyze

```bash
skill-creator aggregate <workspace>/iteration-N --skill-name <name>
```

Read `../agents/analyzer.md` and identify weak assertions, variance, regressions, and time/token tradeoffs.

### 7. Generate the review artifact

Interactive:

```bash
skill-creator review <workspace>/iteration-N \
  --skill-name <name> \
  --benchmark <workspace>/iteration-N/benchmark.json
```

Headless:

```bash
skill-creator review <workspace>/iteration-N \
  --skill-name <name> \
  --benchmark <workspace>/iteration-N/benchmark.json \
  --static <workspace>/iteration-N/review.html
```

For later iterations, add `--previous-workspace`. The static and live modes render the same canonical decision IR; see [Decision-oriented evaluation review](review-viewer.md) for verdict, evidence, filtering, accessibility, and security semantics.

### 8. Validate and verify

```bash
skill-creator full-eval <skill-directory> --workspace <workspace>/iteration-N --resume [options]
skill-creator verify <skill-directory> --evaluation <workspace>/iteration-N [options]
```

A complete receipt is not necessarily a passing gate. Report `pass`, `fail`, `blocked`, and `na` exactly.

## Iteration

After human review, read `feedback.json`, improve the Skill, rerun all paired cases in a new iteration, and compare against the previous workspace. Stop when the user accepts the result, feedback is empty, or further iterations produce no meaningful improvement.

For rigorous A/B comparison, read `../agents/comparator.md` and keep variant identity hidden from the judge.

### Repeated counterbalanced pairs

`full-eval --run-profile fast|standard|release` requests exactly 1, 3, or 5 paired repetitions per scenario. Standard and release plans must declare a validated root `aggregate_budget` with positive `max_runs`, `max_turns`, and `timeout_seconds` large enough for every current/baseline run. An insufficient budget fails before run scaffolding; an interrupted or failed schedule returns typed `incomplete-paired-runs` data rather than silently aggregating a prefix.

Each scenario receives deterministic per-pair seeds and alternating current-first/baseline-first order. Both members retain pair index, seed, order, order position, model, ordered tools, fixture snapshot hash, timeout, turns, and source provenance. Change any evaluation input or profile to invalidate and regenerate the schedule.

Aggregation reports sample count and mean for available observations. Sample standard deviation and a 95% Student-t confidence interval are emitted only for two or more observations; a single observation uses null inferential fields. Stable improvement requires the paired-difference confidence interval to be wholly above zero. Release evidence must never describe one stochastic pair as stable improvement. These Student-t summaries are fixed-sample descriptions; the existing `fast`, `standard`, and `release` profiles and their output remain unchanged.

For optional stopping, use the separately predeclared `finite-horizon-fixed-weight-hoeffding-cs-v2` policy implemented by `anytime_quality.js`. A look is a complete pair index across every declared scenario, and its bounded quality difference is aggregated with immutable scenario weights. The policy versions and hashes the quality bounds, minimum and maximum pairs, alpha/confidence, practical superiority delta, regression tolerance, winner/regression multiplicity fractions, and optional futility equivalence interval before data are observed. Per-look alpha uses the normalized finite-horizon schedule `((M+1)/M)/(t(t+1))`; one-sided Hoeffding bounds and a union bound provide simultaneous coverage under optional stopping. The fixed estimand is the predeclared fixed-weight mean paired quality effect under a stable round data-generating process with independent rounds; arbitrary dependence within a paired round is allowed. This does not support a source-population generalization under informative missingness. The policy predeclares a comparison family (family ID, global alpha, planned count and positive allocation weights, comparison ID/index); campaign alpha must not exceed that comparison allocation, and the default family contains exactly one comparison. Winner and regression require strict crossing after the minimum. Futility uses non-strict closed equivalence containment and the explicit `at_max` rule: `futility-if-contained` is checked before maximum-look inconclusive, while `inconclusive` makes futility early-only. Canonical scenario/pair ordering, a policy SHA-256, an observation-set SHA-256, and deterministic look traces make asynchronous completion order auditable without changing semantics. Persisted sequential artifacts embed the policy, canonical observations, and result; consumers must use the strict bounded regular-file, non-symlink reader, which recomputes and exactly compares every hash, look, bound, and decision before returning data. These SHA-256 values are integrity bindings, not proof of external authenticity; authenticity requires a trusted signature, MAC, or independently trusted digest/distribution channel. Numeric policy caps bound pairs, scenarios, observations, artifact bytes, quality magnitude/range, and alpha; integer fields must be safe integers and every derived weighted value, logarithm, radicand, and confidence bound must remain finite.

### Progress stream semantics

`--progress jsonl` writes newline-delimited JSON to stderr and keeps the same durable projection in `<workspace>/progress.jsonl`; stdout remains reserved for the final command result. Each complete line is one UTF-8 JSON object with a globally monotonic `sequence` and idempotent `event_id`. Writers lock and replay the shared log before append, ignore duplicate event IDs, fsync appends, and atomically replace `progress.json`, so concurrent processes cannot regress counters. A truncated trailing line is discarded during recovery; corruption in a completed line is an error.

## Historical fixed-workspace compatibility

Compatibility policy `fixed-workspace-compatibility-v1` supports only trusted schema `2.0` jobs created before decision fields existed. Trust requires complete absence of all decision-policy/binding fields and a recognizable historical phase plus metadata/evidence shape; adaptive intent is never inferred. Unknown versions, mixed/partial bindings, adaptive markers, identity drift, and ambiguous workspaces fail closed.

Preview with `skill-creator migrate-evaluation <workspace> --dry-run`, apply with the same command without `--dry-run`, or use `full-eval ... --resume` for an unambiguous legacy fixed job. Both preview and successful migration return `original_job_sha256` and an exact `rollback_command`; record the digest in an independently trusted channel outside the migrated workspace. Migration serializes operations with an owned durable lock, captures bounded no-follow snapshots, rejects symlinks and special files in every controlled path, and detects identity changes before publication. It publishes canonical local journal, backup, archive, and receipt files using unique exclusive temporary files. These local files provide consistency and recovery bindings only: an attacker able to rewrite and rehash the workspace can forge all of them, so they do not authenticate the original job. Migration populates fixed bindings only and does not rerun historical evidence. Current aggregation must use an explicit new output path/regeneration workflow rather than silently changing archival bytes.

Rollback is explicit only and requires the original digest from that external channel: `skill-creator migrate-evaluation <workspace> --rollback --expected-original-sha256 <sha256>`. Missing or malformed digests block before mutation. Rollback rereads the backup with no-follow semantics, requires its bytes to match the externally supplied digest, and checks the journal, receipt, target, source/plan, and archive consistency bindings before atomically restoring it. A wrong digest or any inconsistent local rehash fails without changing the current job. Reapplying after rollback likewise requires the external digest; `full-eval --resume` never implicitly rolls back and blocks rather than implicitly reapplying a rolled-back workspace. Preserve local migration files for recovery and audit, but never treat their presence or hashes as proof of authenticity.

`--progress-interval <ms>` throttles/coalesces published `progress.json` and stderr snapshots. The first completed run and every failure, blocked, cancelled, or evaluation-complete event bypass the interval. The durable JSONL event log is never throttled. `--progress none` suppresses stderr only. Successful finalization sets `status=complete`, `provisional=false`, and `final_receipt=true`; this terminal projection is absorbing across restarts, duplicate finalization, and late concurrent events. `review.html` is canonical and final. `partial-benchmark.json` and `partial-review.json` remain explicitly marked `canonical=false` and `historical=true` for audit history. Receipt validation remains compatible with legacy artifacts that omit optional finality fields, but rejects any explicit provisional, non-final, noncanonical, or historical designation in canonical benchmark, review, or progress metadata.

### Evidence-bounded instruction-efficiency review

An evaluation workspace may include `instruction-efficiency-evidence.json` to request additive analysis of observable instruction patterns. Each evidence locator is a structured `{artifact, selector, sha256}` value. `artifact` must exist under a current `eval-*/<configuration>/run-N/` directory and be one of the sanitized JSON artifacts; its digest must match both the file and `execution-evidence.json`. `selector` uses only bounded event indices (`events[start:end]`) or the documented closed fields for navigation, timing, grading, deterministic evidence, and execution evidence. Arbitrary fragments, missing artifacts, unknown fields, and unbounded indices are rejected.

Classification is derived from explicit predicates observed in those selected fields, never trusted from the requested label. The closed classes are `missing_instruction`, `ambiguous_instruction`, `overly_general_instruction`, `redundant_instruction`, and `poorly_routed_progressive_disclosure`; an unsupported requested label is rejected. Observation statements must equal the closed non-causal template for the derived class, so paraphrased private-state or causal stories such as “latent rationale”, “led to”, or “resulted in” cannot enter the artifact. The analyzer emits only the fixed non-causal hypothesis and bounded recommendation templates.

Instruction targets must resolve against headings parsed from the current `SKILL.md` or its current directly addressed `references/*.md`. An omission instead requires both a precise `missing_behavior` and an `insertion_location` that resolves to such a heading; vague free-text locations are invalid. Recommendations require available, non-regressed current quality and every affected observed metric to be taxonomy-eligible with a negative current paired mean. Non-improved or worsened efficiency produces no recommendation.

Recommendations from the current campaign are unconfirmed. Confirmation requires a distinct chronologically later compatible A/B campaign, the same metric ID, unit, and complete taxonomy, available non-regressed quality, and a paired mean that actually improves beyond the current campaign for every affected metric. The later campaign must exist at campaigns/<campaign-id>/ as a contained regular non-symlink directory. Confirmation snapshots its canonical final benchmark.json, terminal progress.json, passing receipt.json, execution manifests, and manifest-listed evidence with no-follow and bounded reads; receipt/source/plan/benchmark hashes, nonempty paired aggregate membership, and the recomputed execution-evidence digest must agree. Later metrics come only from that bound benchmark, never caller fields. Stable content-derived IDs deduplicate equivalent recommendations. Output order is deterministic: poorly routed progressive disclosure, missing, ambiguous, redundant, overly general; then normalized target and stable content ID.


## Fixed and adaptive decision policy modes

### Durable comparison families and retry-inclusive DGP

Adaptive releases derive one authoritative family registry from the registered repository root (`.evaluation-control/comparison-families/<family-id>`); caller-selected alternate roots are rejected. Its locked canonical manifest has an immutable configuration hash and a separate evolving state hash, so concurrent append-only claims do not invalidate campaign resume. Claims transition `claimed → prepared → verified-final`: preparation binds the statistical result, while finalization occurs only after canonical aggregation, receipt, and release verification and binds the verification receipt. Public family status is always freshly reread and hash-verified from this authority. A release may state a familywise conclusion only when every planned comparison is registered and verified-final; otherwise it must say **partial family — no familywide conclusion**.

The execution sampling protocol is constructed internally from concrete runtime options and adapters; callers cannot inject an arbitrary protocol object. Strict validation and hash recomputation apply at construction, resume, run identity, and evidence verification. The binding includes runner and grader executable argv digests, adapter/protocol versions, provider/model revision, all provider concurrency/rate/budget/reservation/accounting/lease settings, retry classification/Retry-After/backoff/jitter behavior, grader identities/configuration/budget/timeout, orchestrator concurrency, and every scenario timeout/turn budget. Each excluded field carries a reason and proof that it cannot affect selection or outcomes; credentials and endpoint strings are transport-only, and a behavior-changing endpoint requires a new provider/model revision.

The default semantic grader (`--grading-mode subprocess`, or the flag omitted) spawns a `goose run` subprocess per grader invocation, with an explicit `--model` for each `--grader id=model` declared at plan time (`CommandGraderAdapter`). This is a legitimate default path, not a deprecated one: it needs no interactive session and its subprocess use is no more "nested" than candidate execution's own `goose run` invocation. [ADR 0001](adr/0001-host-delegated-semantic-grading.md) records the trust boundary, lifecycle states (including `awaiting-grading`), and non-goals for an **optional** alternative selected with `--grading-mode delegated` — a Goose parent session delegating grading to isolated subagents via its native delegation tool instead of a second subprocess — useful when a session is already running interactively and would rather avoid a second per-call `goose run` for a tool-free judgment task. With either mode, `--execute` with semantic assertions and no `--grader` fails fast rather than resolving an implicit default model. When a run reports `awaiting-grading`, follow the [delegated semantic grading workflow](delegated-grading-workflow.md).


### Adaptive family release finalization

A normal fast or standard `full-eval` run uses the `evaluation` verification profile. Even when those gates pass, its family claim remains `prepared`; an inconclusive or otherwise non-release result also remains prepared, and the family conclusion stays `partial-family` / `none`. Use `full-eval ... --finalize-release --human-review pass --tests-status pass --triggering-status pass` to perform explicit release verification. The transition to `verified-final` requires `verify_skill_gates` to return `status: pass`, `profile: release`, and adaptive evidence with a terminal winner and its required sample. The command is lock-serialized and idempotently resumable.

Final publication uses this acyclic provenance order: execution evidence -> immutable release-verification receipt -> comparison-family authority -> canonical benchmark/review/public receipt. Canonical public artifacts cite the upstream hashes but are not inputs to those hashes. After authority mutation, the command fresh-reads the family manifest and republishes the benchmark, review, receipt, job response, and claim/conclusion projection.

