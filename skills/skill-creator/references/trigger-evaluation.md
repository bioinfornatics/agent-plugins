# Trigger evaluation checklist
## Isolated activation protocol

Use `run-evaluation --mode activation`: it shares mandatory fake-HOME/cwd execution with behavioral mode. There is no `isolated` mode. Select installed `--with-skills name,plugin:skill` or `--with-plugin name`; `--model` applies equally to A/B. Execute by default; `--dry-run` launches no Goose process.

Input: `[{id?:number,query:string,expected_skills:["exact-name"],fixtures?:"dir"}]` or `{evals:[...]}`. `should_trigger` is supported only for exactly one explicit selected skill and no full plugin (true: that name; false: empty set). Multi-skill/plugin cases require exact sets. One prompt requires `--expected-skills <name,plugin:skill|none>`.

The engine scans all actual load_skill requests and preserves plugin-qualified identities. Resource requests belong to their exact Skill. Malformed observations or loads absent from the arm inventory fail closed. Successful stream completion with zero requests is negative; failure/malformed streams leave activation unavailable. A selected loads are compared with the expected set. B is a contamination control, not a positive activation trial. Built-in loads are retained separately from target comparison. Hook execution is not inferred to be Skill activation. Request is not proof of successful load/use; no direct instruction injection.

Read report.json activation_results and review.html for exact expected/observed sets. --resume rebuilds reports without rerunning candidates; external observations are not imported into this protocol.

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
