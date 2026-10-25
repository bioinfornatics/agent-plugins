# Outcome and Productivity Metrics 1.0.0

This independent, additive contract measures the golden idea-to-release-candidate journey. `OUTCOME_METRIC_DICTIONARY` is the normative versioned dictionary. Every definition fixes its formula, population, exclusions, provenance inputs, unit, and target. `createGoldenJourneyMetricContract()` requires all ten metrics; callers cannot select only favorable metrics. The north star is **idea-to-release-candidate credible effectiveness within budget**.

## Collection and privacy

Only explicit, digest-provenanced events and evaluations are computed. There is no inference from file contents, prompts, user content, or ambient telemetry. Processing defaults to `local-only` when `privacy` is omitted. An explicit `opted-out` input must contain no records and produces `opted-out`, never `missing`; an included input with insufficient observations produces `missing`. IDs are opaque and content is intentionally absent from the schema.

## Metric semantics

The dictionary includes task success, time and intervention savings, creation completion, improvement yield, regression, recovery, review time, confidence, and the north star. Savings use matched baseline/candidate `pairId` populations. Rates use evaluated runs or explicit attempts, not raw event volume. Durations use explicit UTC boundaries. Values round to six decimal places only after computation.

Confidence is the mean score of passing, explicit confidence evaluations; the dictionary target is 0.8. A north-star numerator pair requires exactly one baseline and one candidate, passing scored effectiveness evaluations with candidate score strictly above baseline, passing improvement and regression evaluations, confidence at target, evidence credibility at least 0.8, safety, identified human approval, and explicit duration, cost, and intervention-count telemetry within every declared budget. Missing usage telemetry blocks; it is never interpreted as zero. Missing or failed guardrails remain in the denominator and mark the north star `guardrail-blocked`. This prevents throughput, event duplication, unverifiable claims, unsafe output, or automated approval from earning release credit.

## Integrity, validation, and determinism

Unknown fields, duplicate IDs, unsupported versions, non-golden journeys, partial metric lists, malformed provenance, unevidenced evaluations, automated human approvals, and opted-out records reject. Inputs are snapshot-strict inert JSON: getters are not invoked; proxies, cycles, symbols, sparse arrays, exotic prototypes, unsafe keys, non-finite values, and nonstandard descriptors fail closed. Inputs are bounded to 100,000 events and evaluations.

Computation sorts stable IDs, populations, provenance IDs, blocked runs, and reasons without locale-sensitive comparison. `computationHash` is SHA-256 over canonical key-sorted report JSON excluding the hash itself. Input array order cannot alter a report.

## Compatibility

This is a new `1.0.0` surface and does not alter capability, evaluation, result, host-adapter, or evidence-graph APIs. Unknown fields reject and incompatible semantics require a new schema/API version. Public package subpaths are `./outcome-metrics`, `./outcome-metrics-types`, and `./outcome-metrics-schema/1.0.0`.

## Evidence and runtime safety

Every evaluation evidence ID resolves through the required `evidence` registry to an explicit record bound to the same run and evaluation type. Dictionary provenance lists event, evaluation, and evidence dependencies, including both recovery lifecycle boundaries. Inputs are descriptor-validated as inert JSON and then copied with `structuredClone()`; this rejects accessors, exotic descriptors, cycles, and transparent proxies before computation.
