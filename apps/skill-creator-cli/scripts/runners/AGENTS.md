# Skill Creator runners — instructions and source map

## Mandatory rule: review documentation impact with every code change

For **every code modification** here, review this map and applicable ancestor
`AGENTS.md` files against the actual code, especially the
[parent execution map](../AGENTS.md) when a runner boundary changes.

- Before editing, read ancestor instructions and the relevant source.
- After editing, compare the diff against mapped symbols, ordered calls, data
  contracts, command construction, privacy/security limits, and verification gates.
- **Automatically update affected `AGENTS.md` content in the same change when
  needed**, without a separate documentation request. Replace obsolete guidance.
- If no update is needed, explain briefly in the delivery report why the existing
  map remains accurate; do not add no-change logs here.
- Respect current authorization and file ownership. For an affected file outside
  scope, a conflict, or an unavailable edit, report the exact required update;
  do not silently leave stale instructions or expand permission.
- Verify links and mapped entries before handoff; static checks do not prove
  runtime behavior, host compatibility, or agent compliance.

This rule applies to `scripts/runners/`; ancestors remain applicable. It is an
agent instruction, **not an installed hook or CI mechanism**. External links are
navigation, not expanded scope. It grants no source, tracker, Git, release,
credential, remote-sync, or installation mutation authority. Never use live
`~/.agents` installations as automated test targets.

## Progressive reading and ownership

1. Read [base.ts](base.ts) and [index.ts](index.ts) for selection/contracts.
2. For trigger evaluation, read the decision methods in [goose.ts](goose.ts), then
   the consuming [runSingleQuery()](../run_eval.ts).
3. For paired behavioral execution, read [paired.ts](paired.ts),
   `GooseRunner.executePaired()`, and [isolated_host.ts](../isolated_host.ts).
4. For isolated session evidence, read [goose_session.ts](goose_session.ts) and its
   caller [evaluation_isolated.ts](../evaluation_isolated.ts), not paired injection.

Keep runner-specific TypeScript here, not in the portable Skill instructions.
Edit sources, not emitted JavaScript. Use the [parent map](../AGENTS.md) for CLI
commands/build wrappers and the [launcher map](../../../../skills/skill-creator/scripts/AGENTS.md)
for installation startup; do not duplicate those inventories. Source is
authoritative; follow only imports needed for the current question.

## Selection, objects, and contracts

| Source / kind | Symbols and responsibility |
|---|---|
| [base.ts](base.ts) | `RunnerError` class; `StreamProcess` alias for stdout-only child; `Runner` interface with `runText`, `startStream`, `firstChoiceLoadedSkill`, `eventLoadedSkill` |
| [index.ts](index.ts) | `RUNNERS` object contains only `goose: GooseRunner`; `createRunner(name?)` selects explicit name, `SKILL_CREATOR_RUNNER`, then `goose`; unsupported names throw `RunnerError` |
| [goose.ts](goose.ts) | `GooseRunner implements Runner, PairedRunner`; `command` argv object; `retryBehavior = "none"` |
| Same module, exported functions | `commandArgv`, `configuredGooseArgv`; `normalizedEvidenceEventType`, `declaredEvidenceToolName`, `validEvidenceEventType` |
| Same module, private helpers | `record`, `projectEvent`, `projectionTranscript`, `parseEvents`, `classify`, `parseResponse`; `CLOSED_EVENT_TYPES` set |
| [paired.ts](paired.ts) | `PairedExecutionError` class; `PairedFailureCode`, `SanitizedEvidenceEventType` aliases; interfaces below |
| [isolated_host.ts](../isolated_host.ts) | `HOST_ENVIRONMENT_POLICY`, `hostEnvironment()`, `temporaryHost()`; inherited operator environment, temporary cwd only |

`index.ts` re-exports basic/paired errors and runner types; it does not implement
execution. Command selection is explicit constructor argument, then
`SKILL_CREATOR_GOOSE_COMMAND`, then `goose`. `commandArgv()` parses quotes/escapes
without executing a shell; it rejects incomplete escapes/quotes.
`configuredGooseArgv()` rejects empty argv.

| Paired interface | Data contract |
|---|---|
| `DeclaredCapabilities` | Boolean `filesystem`, `agent_runner`, `browser`, `network`; ordered unique `tools` |
| `PairedExecutionPlan` | `prompt`, `assertions`, `cwd`, nullable `model`, `tools`, `timeoutSeconds`; optional capabilities, turns, reasoning, configuration, Skill name, signal, seed/pair/order/fixture bindings |
| `PairedExecutionEvidence` | Sanitized JSON `transcript`, projected `events`, duration, host version, exit reason/code, command argv, normalized efficiency telemetry |
| `SanitizedEvidenceEvent` | Closed type, observed seconds, optional declared tool/safe locator, redaction labels; no raw provider payload |
| `ProviderErrorMetadata` | Transient/permanent classification, status/code/retry delay, `retryOwner: "provider-scheduler"`, optional resumability |
| `PairedExecutionResult` | Evidence plus exact `output`, nullable tokens and availability reason, numeric exit code |
| `PairedRunner` | `executePaired(plan)` promise; optional declared retry behavior |

Plan fields are not all enforced by this adapter: assertions are not graded;
seed/pair/order/fixture fields do not become host CLI arguments. Capability
validation requires filesystem/agent runner true, browser/network false, and exact
ordered tools. This is a contract check, **not OS/network enforcement**.
`PairedExecutionError` carries typed code, exit reason/code, optional evidence and
provider metadata; retry ownership metadata does not itself launch retries.

## Goose execution: ordered calls and limits

- `textCommand()` -> `run --no-session --quiet --output-format text --instructions -`.
  `runText()` optionally creates a temporary cwd, spawns with `hostEnvironment()`,
  writes prompt to stdin, collects output, and accepts only exit `0`.
- `streamCommand()` -> stream-json with query in `--text`.
  `startStream()` returns a detached group on non-Windows with stdout piped and
  stdin/stderr ignored. Its caller owns parsing, deadlines, and termination.
- `pairedCommand()` -> stream-json, stdin instructions, positive max turns
  (default `40`), optional model, explicit bounded reasoning `adapterConfig.argv`,
  repeated `--with-builtin` tools. Unsupported reasoning bindings fail closed.

```text
executePaired(plan)
  validateCapabilities -> pairedCommand -> validate cwd
  hostEnvironment -> hostVersion (temporary cwd, --version, 5s probe)
  optional SKILL.md direct injection (+ advisory supporting-resource access)
  spawn owned process group -> stdin task instructions
  decode/parse stream -> project events + observe first useful action
  close -> cancellation/timeout/exit checks -> parseResponse
  require successful complete -> gooseFinalResponse -> telemetry/result
  failure -> typed error with projected evidence
```

Direct injection reads `.agents/skills/<skillName>/SKILL.md` unless configuration
is `without_skill`; supporting-resource references require declared `developer`.
It is **not activation evidence**. Instruction text telling the agent to use only
the workspace is not a filesystem sandbox. `hostEnvironment()` copies all
operator environment values; it does not privatize HOME/XDG, strip discovery,
inspect/copy credentials, or force keyring disabling.

Paired execution uses fatal streaming UTF-8 decoding, records malformed JSON
counts, and rejects error events, unsuccessful/missing `complete`, or ambiguous
final response boundaries via [goose_final_response.ts](../goose_final_response.ts).
Cancellation/deadline send SIGTERM then SIGKILL after 250 ms; exit kills owned
descendants. Windows uses child-only termination. No adapter automatic retry.
Unlike [runProcess()](../evaluation_process.ts), paired/text capture has no 16 MiB
output cap. Projection redacts provider payload, tool arguments, undeclared tool
names, and unsafe locators; exact task output and some error messages are not a
safe-to-publish guarantee. Host version/configuration is not endpoint proof.

## Trigger decision semantics (not paired execution)

`firstChoiceLoadedSkill()` returns `null` until a supported first tool request;
an unrelated first tool or `complete` yields `false`. A matching `load_skill`
request yields `true`; malformed identities throw. It matches the first path
segment and rejects empty/dot/traversal segments and backslashes.
`eventLoadedSkill()` scans eventual requests, accepts optional plugin-qualified
names and valid resource paths, returns `false` on complete/error and otherwise
`null` if unmatched. Do not substitute eventual matching for first-choice checks.

[run_eval.ts](../run_eval.ts) stages description-only Skill text and owns
`runSingleQuery()` stream byte/line/event limits, deadline, group cleanup, and
[trigger outcomes](../trigger_evaluation.ts). A clean terminal/close can classify
negative; timeout, host failure, malformed stream, or unsupported telemetry are
unavailable (`classification: null`), not negative results. Requested loads do
not prove successful loading/use. This inherited-environment path is not the
private-discovery protocol documented in the [parent map](../AGENTS.md).

## Isolated session evidence (separate caller policy)

[goose_session.ts](goose_session.ts) is used by the private-discovery engine:

| Kind / symbols | Contract and ordered work |
|---|---|
| `evaluationSessionName()` | Validate prefix, baseline/with_targets arm, positive repetition; derive exact session identity |
| `projectSessionLog()` | `goose-session-log-v2`: ordered user-visible text/tools only, omitted counters; excludes hidden reasoning/metadata, not a full backup |
| `SessionFinalResponse` alias, `sessionFinalResponse()` | Available exact final visible assistant text or unavailable reason; original message boundaries, not flattened projection |
| `retainSessionLog()` | `runProcess(session export)` in caller HOME/cwd -> validate identity -> select final -> project -> exclusive `session-log.json` + hash/observation |
| `RawLogFile`, `RawLogArchive` interfaces | `goose-raw-logs-v1` origin/path/bytes/hash entries, complete/partial/unavailable status, issues/origins |
| `retainRawLogs()` | Snapshot only owned `state/logs` and `.local/state/goose/logs` -> exclusive raw files -> hashed manifest |
| Private helpers | `archiveError`, `regularAncestors`, `exclusiveBytes`: restricted errors, ancestor/type checks, exclusive 0600 writes/fsync |

Session export uses min(caller timeout, 30s) and `runProcess()`'s combined 16 MiB
capture guard; exports exceeding 8 MiB stdout are rejected after capture.
Projection limits: 4096 messages, 1 MiB text/tool identifiers, 2 MiB serialized
projection; final response has a 256 KiB cap. `_redact` is not applied by `projectSessionLog()`:
projection reports `redacted: false`. Visible tool arguments/results may be
sensitive; raw JSON export is not retained, but raw log bytes are confidential.
Raw capture has no decoding, masking, byte cap, or retries. It rejects symlinks,
hardlinked/special files and excluded settings/auth/database entries, checks
read consistency, and requires private destination permissions. Caller owns HOME
and must retain logs **before cleanup**. Evidence gaps never authorize reruns.

## Verification gates

Follow [parent build/test gates](../AGENTS.md#build-test-and-verification-gates)
and [root runtime/distribution gates](../../../../AGENTS.md). Instruction-only
edits: check links, symbols, contracts, Markdown, line budget, and actual diff;
do not build generated outputs solely for documentation.
Authorized runner changes require the CLI build/test suite. Built-`dist` seams:
[test_runners.test.ts](../../tests/test_runners.test.ts),
[test_runner_completion.test.ts](../../tests/test_runner_completion.test.ts),
[test_host_isolation.test.ts](../../tests/test_host_isolation.test.ts),
[test_trigger_evaluation.test.ts](../../tests/test_trigger_evaluation.test.ts),
[test_goose_session.test.ts](../../tests/test_goose_session.test.ts).
Remove `NODE_TEST_CONTEXT` before nested tests; never race builds with consumers.
Report source inspection, tests, generated equivalence, and actual host proof
separately; mocked transport or static maps do not prove host compatibility.
