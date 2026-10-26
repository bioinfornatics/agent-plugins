# Trigger evaluation checklist

Read this reference when testing or optimizing Skill selection.

The current trigger measures eventual target activation, not first-choice routing: unrelated Skill loads do not end the observation. All load requests in each event are scanned; qualified `plugin:skill` and directly addressed `skill/reference` names match only the exact target component. Terminal nonactivation is a classified negative; stream errors and explicitly failed terminals remain infrastructure outcomes, excluded from activation accuracy. An observed target load request measures selection, not successful loading, task execution or correct use of its resources. The evaluator stops and cancels after observing that request; it does not require subsequent task completion. A negative requires a successful terminal record and clean process close; a clean close without a terminal is unsupported-telemetry, not a negative.

## Current-session evaluation (no model launch)

Use `run-evaluation` when the current agent owns candidate calls. Input is
compatible without conversion with Anthropic's run_eval.py:

```json
[{"query":"Analyze this PDF","should_trigger":true},
 {"query":"What is the weather?","should_trigger":false}]
```

Only query and boolean should_trigger are required. This tests activation,
not answer quality: no assertions, fixtures or full-eval scaffold are required.

```bash
skill-creator run-evaluation --skill-path <skill-directory> --format json
# Optional: --eval-set <file> --output <new-directory>
# Optional: --runs-per-query 3 --trigger-threshold 0.5
```

Defaults: `<skill-directory>/eval.json` and
`<skill-directory>/eval_result/<local dd-mm-yy>-<fresh UUID>`.
The command creates run.json (authoritative coordinator state) and status.json
(detailed progress). Only after every repetition is classified does it emit
results.json with exactly the Anthropic run_eval.py result fields. Incomplete or
inconclusive state is not exported as an apparently complete boolean result.
No Skill snapshot or model subprocess is created. `review.html` is generated
for partial, inconclusive and complete progress, with explicit evidence limits.
Open it and inspect the rendered status/results before reporting; it never grants
acceptance or an authenticated receipt.
Existing output requires explicit --resume --output <directory>.
Repeat an overridden --eval-set on resume.

1. Read output.pending from the JSON command envelope. Entries contain only
   case_index (zero-based), repetition (one-based) and query.
2. The current session invokes its native candidate mechanism, giving each
   candidate only the query and intended discovery context. Do not forward the
   whole report, run.json, expectations or previous results. Do not force a
   Skill load or inject its body: that cannot measure natural activation.
3. Record actual host tool telemetry, not candidate self-report. A target load
   request is triggered; not-triggered requires a complete successful observation
   with no target request. Missing telemetry is unsupported-telemetry, never a
   negative. Other outcomes: timeout, host-failure and malformed-stream.
4. Import coordinator observations and repeat for remaining pending entries:

```json
[{"case_index":0,"repetition":1,"outcome":"unsupported-telemetry",
  "evidence":{"source":"host-observation","reference":"retained-observation-locator"}}]
```

This illustrates syntax, not observed execution evidence.

```bash
skill-creator run-evaluation --skill-path <skill-directory> --output <run-directory> --resume --observations <observations.json> --format json
```

Each import is a new batch, not the accumulated observation set. Duplicate,
replayed, invalid and out-of-range entries fail without replacing existing records.
SKILL.md and eval bytes plus repetition/threshold settings are bound locally;
changed inputs require a new run. Resources and ambient context are not frozen.
Host discovery, native delegation isolation and provider telemetry are not supplied
or enforced here. Missing host support is a capability limit, not permission to
invent observations. The pending projection hides expectations by construction,
but is not a filesystem sandbox.

The completed results.json contains only skill_name, description, results and
summary; each result contains query, should_trigger, trigger_rate, triggers, runs
and pass. Detailed status/uncertainty remains in status.json and command stdout. Positive cases pass at rate >= threshold; negative cases pass at rate
< threshold. Rates use classified observations only. Unfinished repetitions or
missing classifications make pass null; zero classified runs makes trigger_rate
null. Summary counts inconclusive separately. Status distinguishes
awaiting-observations, inconclusive and complete. Complete may contain failed
cases: inspect summary.failed. Exit 0 means operation success, not evaluation
acceptance or proof all calls ran; invalid operations exit 2.

Evidence source/reference are coordinator-reported locators, not authenticated
provenance: referenced host events are not verified by the command. No semantic
grader is needed for this activation-only schema. The optional legacy trigger-eval
command below still launches subprocesses and is not this path.

## Eval set

Create realistic `should_trigger` and difficult `should_not_trigger` queries. Include:

- explicit and implicit intent;
- formal, casual, abbreviated, and typo-bearing requests;
- multilingual requests while keeping the description English;
- close sibling capabilities;
- simple requests where loading the Skill adds no value;
- substantive requests where the Skill should clearly help.

Prefer at least 8–10 positive and 8–10 negative cases. Run each query multiple times when model variance matters.

## Metrics

Measure more than total accuracy:

- **precision:** relevant triggers / all triggers;
- **recall:** relevant triggers / all relevant requests;
- **F1:** balance of precision and recall;
- false positives by neighboring Skill;
- false negatives by intent category;
- variance across repeated runs and target models.


## Typed outcomes and efficiency telemetry

Each repetition now includes an additive, versioned outcome envelope. Outcomes are `triggered`, `not-triggered`, `timeout`, `host-failure`, `malformed-stream`, or `unsupported-telemetry`. The first two are classification decisions. The remaining four are infrastructure outcomes and are reported separately rather than scored as false positives or false negatives.

The envelope reports total duration and, when available, time-to-trigger, actual turns, allowlisted usage categories, and USD cost. Missing host telemetry is represented as `value: null` plus an explicit `unavailable_reason`; it is never inferred. Aggregate output adds the confusion matrix, false-positive and false-negative counts, trigger and total-duration distributions, infrastructure-failure counts, and per-field telemetry coverage. Existing `results`, `trigger_rate`, `triggers`, `runs`, `pass`, and `summary` fields remain available.

Stream processing is bounded. Non-JSON, oversized, excessive, or structurally invalid stream records produce `malformed-stream`; arbitrary event text and host errors are not copied into result artifacts.

## Optimization

Keep train and held-out test cases separate. Select the best description by held-out performance, not training accuracy. Do not expand descriptions into multilingual keyword lists or examples from the eval set.

```bash
skill-creator trigger-eval \
  --eval-set <trigger-eval.json> \
  --skill-path <skill-directory> \
  --runs-per-query 3
```

For iterative optimization, use the description-optimization reference linked directly from SKILL.md.

## Sibling overlap

Evaluate all nearby Skills on the same difficult negatives. A description is not acceptable when it improves recall by stealing requests that belong to a sibling.

## Completion checklist

- Positive and difficult-negative coverage is balanced.
- Precision, recall, and F1 are reported.
- Held-out results drive selection.
- Sibling overlap is inspected.
- Multilingual semantic discovery works without multilingual metadata.
- Trigger evidence is separate from behavioral output evidence.

## Host availability boundary

Trigger evaluation relies on the host's actual load_skill tool; direct instruction injection is not activation evidence. The stream adapter observes target requests, including qualified and resource names, while unrelated loads remain nonterminal. Children inherit the operator environment and normal authentication; no HOME/XDG/keyring overrides or credential preflight are imposed. Separate temporary workspaces do not isolate ambient Skills, profiles, hints or tools. Report possible ambient activation contamination; do not claim an OS sandbox or tool-free execution. Distinguish mocked stream lifecycle checks from installed-host tool availability and real-provider evidence.

Behavioral paired execution injects the candidate SKILL.md body in all declared tool modes, including developer-enabled execution. That treatment is instruction exposure, not evidence of natural load_skill triggering, supporting-resource access or correct tool use. Trigger evaluation must continue to observe actual target load_skill requests independently. Mock transport results prove protocol handling only, not installed-host or provider effectiveness. Honest uncertainty may reach review with complete retained artifacts, but neither exposure nor a complete receipt authorizes release or proves a winner.
