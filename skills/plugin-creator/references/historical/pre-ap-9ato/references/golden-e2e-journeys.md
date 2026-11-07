# Golden end-to-end journeys

The `plugin-creator golden-e2e` command provides three immutable offline journeys: idea to API-review Skill, dependency-review agent, and multi-component safety plugin. Each starts with natural language and no artifact, applies novice defaults or bounded expert overrides, and covers generation, validation, repeated evaluation, challenge, improvement, review, and release gating.

The deterministic offline adapter generates real isolated candidates under `.agents/plugins`, invokes the shipped Skill, agent, and plugin validators, then loads the behavior module referenced by each generated artifact in isolated child processes. Behavioral instructions and the executable policy must agree, so post-validation instruction corruption fails evaluation. Varied repetition inputs are fingerprinted in the records. Evidence says `kind: executed` and `executed: true` for local operations while `llm_executed: false` distinguishes the absence of model inference, network, host, or production execution.

Configured challenger branches run as separate children. Each receives candidate, records, and criteria paths and derives its own content-specific finding from those files. Improvement records map each finding to an explicit capability change, and reruns verify the changed behavior.

Metrics are derived from baseline and revised records: effectiveness is pass rate, productivity is intervention savings counted only from strict evaluator-owned observed-action events, and outcome success is normalized improvement over baseline. Candidate output fields are not metric inputs; event counts must be finite and nonnegative. Actual wall time is reported separately without claiming that the improved artifact is faster. Timer-driven heartbeats are emitted while evaluation and challenge children are active. Cancellation terminates the active child and durably persists the active phase plus complete baseline, initial, and revised repetition records; resume executes only remaining complete revised repetitions without duplicates. Provenance hashes and a checksummed CI archive reject direct or transitive artifact, result, record, and fixture tampering. Completed runs terminate at `pending-production-approval` (exit 4); the executor has no activation capability. Cancellation is exit 3. `--inspect` detects stale or invalid evidence and still denies activation.

    plugin-creator golden-e2e --list
    plugin-creator golden-e2e --journey idea-api-review-skill --workspace ./evaluations/golden/api --format json
    plugin-creator golden-e2e --journey dependency-review-agent --workspace ./evaluations/golden/deps --profile expert --override repetitions=9 --resume

Fixtures, suites, thresholds, and expected contracts live under `assets/golden-e2e/`. Fixture checksum mismatch fails closed.
