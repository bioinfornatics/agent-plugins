# Evaluation-completion improvement report

## Decision

**revise**

Behavioral execution improved materially and the official receipt is complete. Trigger routing is still variable across repeated `run_eval.js` passes, so no claim of globally stable triggering is made.

## Official behavioral evaluation

Workspace: `/home/jmercier/Codes/Servier/difa-mentoring2/.evals/agent-plugins-official/iteration-1`

Official artifacts generated:

- paired current/baseline outputs for four cases;
- `eval_metadata.json` per case;
- `grading.json` and `timing.json` per run;
- `benchmark.json` and `benchmark.md` from `aggregate_benchmark.js`;
- `review.html` from `eval-viewer/generate_review.js --static`;
- complete receipt verified by `validate_evaluation_receipt.js`.

### Result

| Configuration | Pass rate | Mean time | Tokens |
|---|---:|---:|---:|
| Revised contracts | 100% | 9.8 s | n/a |
| Repository HEAD baseline | 70% | 13.5 s | n/a |
| Delta | +30 points | -3.7 s | n/a |

Token metrics were unavailable from the delegation backend and are correctly reported as n/a.

## Trigger evaluation

Official `run_eval.js` results:

| Pass | skill-creator | plugin-creator |
|---|---:|---:|
| Initial, 1 run/query | 6/10 | 6/10 |
| First description revision, 2 runs/query | 6/10 | 9/10 |
| Boundary revision, 1 run/query | 7/10 | 7/10 |

The variance is too high to claim stable routing improvement. Recommended next step: review a 20-query trigger set, then execute `run_loop.js` with three repetitions and held-out queries.

## Mechanism changes

- Explicit evaluation requests now enter execution mode instead of returning a protocol-only answer.
- Skill evaluation requires paired runs, standardized grading, official aggregation and a viewer.
- Plugin evaluation requires complete skill receipts plus plugin integration cases.
- Ad-hoc two-agent comparisons cannot be called official evaluations.
- Missing capabilities produce `evaluation: blocked`, not fabricated results.
- Added deterministic receipt validation.
- Aggregator now reports actual run counts and n/a for unavailable token metrics.
- Build/test scripts no longer depend on shell cwd.

## Human review

The static viewer exists, but human feedback is not yet submitted. Automated evaluation is complete; human review is pending.
