# Evaluation Plan and Budget Contract 1.0.0

This host-neutral contract freezes what an evaluator intends to compare before launch. It references existing scenario documents; it does not copy or redefine creator scenario schemas, execute runs, emit progress, orchestrate models, approve releases, or define operation/verdict contracts.

## Plan

Every plan pins `schemaVersion: 1.0.0`, one named profile, scenario references, a baseline, configurations, and comparison pairs. References contain a stable `id`, portable `source`, and optional `selector`. Configurations freeze execution level (`static`, `behavioral`, or `integration`), capabilities, model roles, inputs, tools, fixtures, and optional budget overrides.

A pair must explicitly assert equivalent inputs, tools, fixtures, and budgets. Validation also compares normalized values; declarations cannot conceal a mismatch. Models and implementation identity may differ.

## Deterministic profiles

| Profile | Repetitions | Requested concurrency | Max turns/run | Timeout/run | Max retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| `fast` | 1 | 2 | 12 | 300 s | 0 |
| `standard` | 3 | 4 | **40** | 1200 s | 1 |
| `release` | 5 | 8 | 80 | 1800 s | 2 |

The public profile key `max_turns_per_run` records the table value exactly (40 for `standard`); normalized plan budgets expose the same value as `budget.perRun.maxTurns`. Explicit plan fields override profile values. The profile table is versioned contract data. Omitted total bounds normalize to exact computed requirements.

## Budgets and pre-launch capacity

Per-run budgets resolve to finite positive `maxTurns` and `timeoutSeconds`; optional token and USD dimensions must also be finite and positive. `totalJobs = scenarios × configurations × repetitions`. `totalRuns = totalJobs × (maxRetries + 1)` is the worst-case launch bound. Effective concurrency is the minimum of requested concurrency, total jobs, and total max runs. Supplied totals below requirements are contradictory.

Portable ceilings reject effectively unbounded plans: 1,000 turns, 86,400 seconds, 10,000,000 tokens, or USD 10,000 per run; 100,000 runs, 100,000,000 turns, 31,536,000 aggregate seconds, 1,000,000,000,000 tokens, or USD 1,000,000 per plan. Declared plan-level `budget.perRun` values and effective configuration budgets are each checked directly, so a smaller configuration override cannot mask an oversized plan default. Budget exhaustion must stop. Threshold failure may stop or continue; `maxFailedRuns` cannot exceed total runs.

## Normalization, hashing, and diagnostics

Validation precedes normalization. Normalization trims strings, materializes profile defaults, resolves configuration budgets, sorts set-like arrays and identified records, and adds computed capacity. Every string sort uses ascending ECMAScript UTF-16 code-unit order (`a < b ? -1 : a > b ? 1 : 0`), never locale-sensitive collation. Recursive key ordering uses the same built-in UTF-16 ordering; compact JSON is canonical. SHA-256 is computed over its UTF-8 bytes.

Diagnostics have stable code, JSON Pointer path, message, and remediation. Unsupported versions, malformed or unknown fields, missing equivalence, actual pair mismatch, contradictory totals, and safety-ceiling violations fail before launch.

## Existing creator eval compatibility

`adaptCreatorEvalsToEvaluationPlan` reads shared envelope fields from each `skills/*/evals/evals.json` and creates references to `/evals/{index}`. Scenario bodies remain authoritative in creator packages. The adapter aggregates fixture paths, tools, capabilities, and maximum legacy per-scenario turn/timeout limits into equivalent baseline/candidate configurations.

## Role-aware multi-model matrix 1.1.0

Version `1.1.0` additively introduces `modelMatrix`; 1.0.0 single-model plans remain valid and unchanged. Exactly one entry for each `builder`, `challenger`, `verifier`, and `grader` role is required, and every role selects one or many primary identities. An identity is either a concrete provider/model, an alias with explicit `alias` confidence, or a host default with explicit `host-default` confidence and a documentation binding. When a host can route an alias but intentionally does not expose its underlying identity, the resolution context may declare one documented opaque alias; its receipt preserves the requested alias and records `confidence: "unknown"` plus `executionIdentity: "host-opaque-alias"` rather than inventing or requiring a provider/model. Primary and fallback order is canonicalized, so resolution is independent of input ordering.

Before execution, `resolveEvaluationJobs` expands scenarios × configurations × role models × matrix repetitions into stable explicit job IDs. Every ID binds a deterministic run index, scenario, configuration, role, normalized requested matrix-entry index and identity digest, resolved concrete model or opaque host route, and repetition. Thus converging aliases and exact duplicate requests remain distinct without collisions; duplicate entries intentionally execute separately and retain stable zero-based entry indexes. Retries contribute to the worst-case total-run and aggregate budget bounds but not distinct initial jobs. Resolution requires a concrete available provider/model. Exposed aliases must resolve to exactly one concrete identity; opaque aliases must have exactly one documented host route; host defaults must match the documented host binding. An unavailable primary uses the first available canonical fallback and records its index; otherwise resolution fails before execution. Receipts bind the canonical plan hash, requested and resolved identities, confidence, fallback use, jobs, concurrency, and total runs.

Matrix plans must explicitly bound per-run turns, timeout, tokens, and cost, plus total runs, turns, timeout, tokens, cost, and concurrency. The portable 1.0 ceilings continue to apply. Computed requirements must fit every declared limit. Inputs are closed, length-bounded, cardinality-bounded, finite, and safe-integer checked.
