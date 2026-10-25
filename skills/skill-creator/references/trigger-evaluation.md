# Trigger evaluation checklist

Read this reference when testing or optimizing Skill selection.

The current trigger measures eventual target activation, not first-choice routing: unrelated Skill loads do not end the observation. All load requests in each event are scanned; qualified `plugin:skill` and directly addressed `skill/reference` names match only the exact target component. Terminal nonactivation is a classified negative; stream errors and explicitly failed terminals remain infrastructure outcomes, excluded from activation accuracy. An observed target load request measures selection, not successful loading, task execution or correct use of its resources. The evaluator stops and cancels after observing that request; it does not require subsequent task completion. A negative requires a successful terminal record and clean process close; a clean close without a terminal is unsupported-telemetry, not a negative.

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

Trigger evaluation relies on the host's actual load_skill tool; direct instruction injection is not activation evidence. The stream adapter observes target requests, including qualified and resource names, while unrelated loads remain nonterminal. Redirected discovery roots and an explicitly allowlisted child environment prevent ambient profiles from being copied, but are not an OS sandbox or proof of tool-free execution. File/keyring-only and unsupported credential-chain transports need a separately verified adapter. Distinguish mocked stream lifecycle checks from installed-host tool availability and real-provider evidence.

Behavioral paired execution injects the candidate SKILL.md body in all declared tool modes, including developer-enabled execution. That treatment is instruction exposure, not evidence of natural load_skill triggering, supporting-resource access or correct tool use. Trigger evaluation must continue to observe actual target load_skill requests independently. Mock transport results prove protocol handling only, not installed-host or provider effectiveness. Honest uncertainty may reach review with complete retained artifacts, but neither exposure nor a complete receipt authorizes release or proves a winner.
