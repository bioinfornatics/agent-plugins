# Evidence-based candidate selection contract 1.0.0

This pure API selects among immutable candidate/evidence snapshots. All scores are normalized to [0,1], higher is better. The declared objective is the weighted conservative utility `sum(weight[d] * lowerBound[d]) / sum(weights)`; thresholds apply to lower bounds for effectiveness, productivity, stability, and safety.

## Decision rules

1. Reject malformed, accessor-bearing, cyclic, sparse, excessive, non-finite, duplicate, or unknown-field input.
2. A candidate below `criticalSafetyMinimum` is vetoed. No override can bypass that veto, the ordinary safety threshold, or insufficient safety evidence.
3. Sample counts must lie within the declared minimum/maximum and every confidence interval must fit its dimension limit. Missing certainty makes the automated decision inconclusive.
4. Candidates must clear every threshold. Pareto dominance and Pareto disposition reasons are computed only among fully eligible, non-veto candidates; a vetoed or otherwise ineligible candidate can never dominate another candidate. The objective ranks eligible candidates by conservative utility. If candidates fall within the declared tie tolerance, compare that tied set by Pareto dominance over conservative lower bounds. Select a sole objective winner or unique Pareto winner; unresolved ties/trade-offs are inconclusive and require a human decision.
5. A human may submit an identity- and rationale-bearing `nonSafetyOnly` override for any safety-qualified candidate. It may resolve non-safety thresholds, uncertainty, or Pareto conflicts, never safety.
6. Every decision embeds the exact configured weights, thresholds, tie tolerance, critical safety minimum, and uncertainty/sample policy used, in addition to the canonical input hash. Output traces bind every selected/rejected disposition to the candidate SHA-256 and sorted evidence SHA-256 values. Canonical input hashing sorts candidates and evidence hashes, making results deterministic and permutation invariant.

The input/result schemas are closed. Runtime validation also rejects symbol keys, non-enumerable fields, accessors, non-standard data descriptors, exotic prototypes, and cycles. Portable draft 2020-12 schemas express all structural and scalar bounds; cross-property numeric ordering (`maximumSamples >= minimumSamples`, `lowerBound <= estimate <= upperBound`) and projected candidate ID/hash uniqueness remain explicit runtime semantic invariants because `$data` is not assumed. Version `1.0.0` is independent from other capability-contract versions.
