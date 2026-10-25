/** Public command help shared by direct and unified entry points. */
export const FULL_EVAL_HELP = `Usage: skill-creator full-eval <skill-directory> [options]

Decision policy:
  --decision-policy fixed|adaptive
      Select fixed-sample or anytime-valid adaptive evaluation (default: fixed).
  --adaptive-policy <JSON>
      Requires --decision-policy adaptive. Inline JSON object used with adaptive mode.
      Alternatively declare the same object at
      anytime_quality_policy in the eval-set JSON file. Required fields are schema_version,
      method, estimand, assumptions, comparison_family {family_id,global_alpha,
      planned_comparisons,comparison_ids,allocation_weights,comparison_id,comparison_index}, min_pairs,
      max_pairs, campaign alpha, quality_bounds {min,max}, practical_superiority_delta,
      regression_tolerance, multiplicity {winner_fraction,regression_fraction}, scenarios
      [{id,weight}], and futility {enabled,minimum_pairs,equivalence_lower,
      equivalence_upper,at_max}. The default family is exactly one comparison.

Adaptive terminal semantics:
  winner or regression stops when its anytime-valid confidence bound crosses the declared
  threshold; futility uses closed containment and, when at_max=futility-if-contained, takes
  precedence over max_pairs inconclusive. continue is nonterminal. The estimand is only the
  predeclared fixed-weight mean paired quality effect under stable independent rounds. Every admitted round contains complete candidate/baseline pairs and must complete; a failed/incomplete round blocks inference and cannot be skipped. Provider-limited or budget-exhausted
  failures block and resume the same admitted round. Retries belong to the declared terminal-attempt policy. Under informative missingness, no claim
  generalizes to an unobserved source population. Campaign alpha cannot exceed family allocation. Evaluation-profile or inconclusive results remain prepared with a partial/not-eligible conclusion. Only release-profile verification that passes with a terminal adaptive winner and the required sample may finalize. Use --finalize-release to resume explicit release finalization. Provenance is layered evidence -> release verification -> family authority -> canonical publication, preventing circular hashes. Each planned ID/index is atomically claimed once in the shared family workspace; an incomplete family is reported as partial with no familywide conclusion. Retry/provider/model/grader sampling settings are hashed into every campaign and resume rejects drift.

Budget requirement:
  The eval set must declare aggregate_budget for the adaptive worst case: max_runs >=
  scenarios * max_pairs * 2, with max_turns and timeout_seconds covering both cells of every
  scenario and pair through max_pairs. Provider limits are separate safety caps.

Execution options:
  --workspace <dir>                 Evaluation workspace
  --eval-set <file>                 Eval-set JSON (default: <skill>/evals/evals.json)
  --execute                         Run the configured provider
  --concurrency <n>                 Concurrent evaluation cells
  --provider-concurrency <n>        Provider admission concurrency
  --provider-rpm <n>                Provider requests per minute
  --provider-max-attempts <n>       Bounded attempts per provider call
  --max-cost-usd <n>                Provider worst-case cost cap
  --max-tokens <n>                  Provider worst-case token cap
  --max-provider-seconds <n>        Provider worst-case time cap
  --reserve-cost-usd <n>            Per-attempt cost reservation
  --reserve-tokens <n>              Per-attempt token reservation
  --reserve-provider-seconds <n>    Per-attempt time reservation
  --model <id>                      Provider model
  --run-profile fast|standard|release
  --baseline-skill <dir>            Prior Skill used with --baseline old_skill
  --cache-dir <dir> | --no-cache
  --progress auto|terminal|jsonl|none
  --progress-interval <ms>
  --dry-run
  --resume | --retry | --cancel
  --finalize-release                  Release-verify and publish a prepared adaptive family claim

Semantic grading:
  --grader <id>=<model>              Declare one explicit grader identity (repeatable). A
                                      scenario may plan a single development grader (fast
                                      iteration; resolves to inconclusive, never a trusted
                                      pass/fail on its own) or two-or-more independent
                                      standard/release graders. --execute with semantic
                                      assertions and no --grader fails fast: an implicit
                                      default model is never permitted.
  --grading-mode subprocess|delegated (default: subprocess)
                                      subprocess: each grader call spawns its own goose run
                                      subprocess with --model, exactly as candidate execution
                                      already does. Needs no interactive session; this is a
                                      fully supported default, not a deprecated fallback.
                                      delegated: no grader subprocess is ever spawned. Once
                                      candidate output is complete, full-eval reports an
                                      "awaiting-grading" checkpoint with exact next steps
                                      (prepare-grading -> delegate -> import-grading ->
                                      --resume); see
                                      skills/skill-creator/references/delegated-grading-workflow.md.
                                      Use this when an interactive Goose session running
                                      full-eval would rather delegate grading to its own
                                      subagents than spawn a second per-call subprocess for a
                                      tool-free judgment task.
  --grader-command <cmd>             Override the goose binary/argv used for subprocess
                                      grading (default: $SKILL_CREATOR_GOOSE_COMMAND or
                                      "goose"). Only meaningful with --grading-mode subprocess.
  --max-grader-calls <n>              Grader call budget (default: 100)

Examples:
  skill-creator full-eval ./my-skill --execute --decision-policy adaptive --adaptive-policy '{"schema_version":"2.0","method":"finite-horizon-fixed-weight-hoeffding-cs-v2","estimand":"fixed-weight-mean-paired-quality-effect","assumptions":{"round_data_generating_process":"stable-independent-rounds","completion_missingness":"all-admitted-rounds-complete-no-skip","retry_target":"terminal-attempt-policy","informative_missingness_scope":"no-source-population-generalization"},"comparison_family":{"family_id":"default","global_alpha":0.05,"planned_comparisons":1,"comparison_ids":["candidate-vs-baseline"],"allocation_weights":[1],"comparison_id":"candidate-vs-baseline","comparison_index":1},"min_pairs":3,"max_pairs":30,"alpha":0.05,"quality_bounds":{"min":0,"max":1},"practical_superiority_delta":0,"regression_tolerance":0,"multiplicity":{"winner_fraction":0.5,"regression_fraction":0.5},"scenarios":[{"id":"1","weight":1}],"futility":{"enabled":false,"minimum_pairs":3,"equivalence_lower":0,"equivalence_upper":0,"at_max":"futility-if-contained"}}'
  skill-creator full-eval ./my-skill --workspace ./evaluation --execute --decision-policy adaptive --resume
  skill-creator full-eval ./my-skill --execute --grader grader-a=gpt-5.6-sol --grader grader-b=claude-sonnet-5
  skill-creator full-eval ./my-skill --execute --grading-mode delegated --grader dev=claude-sonnet-5
  skill-creator full-eval ./my-skill --workspace ./evaluation --resume   # after prepare-grading/import-grading in delegated mode

Common options:
  --format text|json  Select output format (default: text)
  --quiet             Suppress successful text output
  --help              Show this help`;

export const AGGREGATE_HELP = `Usage: skill-creator aggregate <benchmark-directory> [options]

Decision policy:
  --decision-policy fixed|adaptive  Select aggregation semantics (default: fixed).
      fixed aggregates the complete predeclared fixed sample. adaptive requires the workspace's
      canonical .adaptive-scheduling.json and anytime-quality-decision.json; it independently
      verifies the eval-set anytime_quality_policy and counted pair membership. --adaptive-policy
      is configured by full-eval as inline JSON (or at the --eval-set path); aggregate intentionally
      accepts no policy override so canonical evidence cannot be replaced during aggregation.

Adaptive terminal semantics:
  winner, regression, futility, and max_pairs inconclusive are terminal; continue is nonterminal
  and cannot produce a final adaptive aggregate. Provider-limited or budget-exhausted attempts
  are not samples: only complete candidate/baseline pairs in canonical membership are counted.

Budget requirement:
  Before execution, the eval set must cover the adaptive worst case in aggregate_budget:
  max_runs >= scenarios * max_pairs * 2; max_turns and timeout_seconds must likewise cover both
  cells for every scenario through max_pairs.

Options:
  --skill-name <name>
  --skill-path <dir>
  -o, --output <benchmark.json>

Examples:
  skill-creator aggregate ./evaluation --decision-policy fixed
  skill-creator aggregate ./evaluation --decision-policy adaptive

Common options:
  --format text|json  Select output format (default: text)
  --quiet             Suppress successful text output
  --help              Show this help`;
