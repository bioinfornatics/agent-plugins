# Behavioral evaluation workflow

Read this reference only when the user asks to evaluate, test, benchmark, compare, or prove improvement of a Skill.

## Contents

- [Completion contract](#completion-contract)
- [Installed-capability discovery-isolated comparison](#installed-capability-discovery-isolated-comparison)
- [Execution order](#execution-order)
- [Unavailable grading and grading-only recovery](#unavailable-grading-and-grading-only-recovery)
- [Grading compatibility](#grading-compatibility)
- [Iteration](#iteration)
- [Historical fixed-workspace compatibility](#historical-fixed-workspace-compatibility)
- [Fixed and adaptive decision policy modes](#fixed-and-adaptive-decision-policy-modes)

## Completion contract

A complete evaluation contains:

- an eval set and one `eval_metadata.json` per case;
- paired `with_skill` and `old_skill` or `without_skill` runs;
- saved outputs or transcripts for every run;
- `timing.json` for every run, using null values with a reason when metrics are unavailable;
- `grading.json` for every run, with `text`, `passed`, and `evidence` in each expectation (canonical evaluator records also retain verdicts and provenance);
- `benchmark.json` and `benchmark.md` produced by the applicable command: simple `run-evaluation --mode behavioral`, or advanced `aggregate_benchmark.js`;
- a review artifact produced by `eval-viewer/generate_review.js`;
- analyst findings and an accept, revise, or blocked decision.

Trigger-description evaluation (`run_eval.js` or `run_loop.js`) does not replace behavioral evaluation. Completion means usable scoped evidence and an honest result, not passing release gates.

```text
Agree realistic cases + atomic assertions; freeze current/baseline
                           |
                    Run workspace-separated A/B pairs
                           |
          Check deterministic properties with scripts
                           |
  One independent blinded grader per output: all semantic criteria
                           |
       Aggregate quality + available duration/token measures
                           |
       Review actual outputs with the user -> revise -> rerun

Separately requested release decision -> release verification gates
```

Use additional independent graders for ambiguity or higher stakes, not routinely. Disagreement remains inconclusive for human review; do not majority-vote it into a pass.

## Installed-capability discovery-isolated comparison

`run-evaluation` executes through mandatory discovery isolation for both `--mode activation` and `--mode behavioral` (default). Isolation is not a mode. Execution is default; `--dry-run` launches no Goose process, only validates/stages/hashes inputs. 

- Select installed names with repeatable/comma-separated `--with-skills name,plugin:skill`, or full manifest-bearing Open Plugins with repeatable `--with-plugin name`. Subsets preserve namespaces but exclude siblings/hooks; whole plugins retain hooks/resources. Missing/ambiguous/symlink inputs fail.
- Original HOME is the source (`--source-home` overrides). Private HOME, GOOSE_PATH_ROOT=HOME, cwd and XDG/config/cache/temp are created per arm. A has selected targets, B none, with the same built-ins. Actual discovery is checked before either task. This is not an OS sandbox; only use trusted hooks/tools.
- `--model` is forwarded unchanged to both Goose runs; `--provider` is common too. Compare models using identical cases/selectors/fixtures and new outputs. Original-HOME Goose provider configuration and support files are copied recursively, with secret files protected at0600. --config overlays defaults. CLI provider/model overrides env, which overrides stored values. Arbitrary extensions/hints/discovery are stripped; plugins are declared only at copied private paths. File secrets are excluded from reports/hashes/grading; system keyring access remains available under the same OS user/session, without extracting keys.
- Behavioral input: `{evals:[{id,prompt,expectations:["criterion"],fixtures?:"dir"}]}`. `assertions` is a string-array alias. Case fixtures resolve relative to the eval-set file; global `--fixtures` is common. Skill-relative `files` are rejected. Expectations never enter candidates.
- One case: `--prompt <text> [--expectations <JSON-array>]`. No criteria means awaiting-grading, not pass. Tasks retain responses and bounded regular artifacts before cleanup, with hashes/duration/available tokens. Missing tokens are null.
- Independently judge anonymous `grading_requests[].request_path` packets, then import with `run-evaluation --resume --output <dir> --grading-results <file>`. Resume revalidates frozen inputs and quote/criteria bindings without executing candidates. report.json/review.html show paired descriptive quality/efficiency, not acceptance receipts.
- Activation uses the same engine with exact per-case expected name sets; see [activation protocol](trigger-evaluation.md#isolated-activation-protocol). Availability, requested loads, successful use and quality are distinct claims.

## Execution order

### 1. Freeze cases and baseline

Apply the risk-to-evidence mapping from evaluation design: select distinct material risks, use deterministic checks wherever a reliable oracle exists, and keep only representative costly operational journeys. Freeze the confidence question, repetition budget/stop rule and repair bound before execution. Repetitions do not expand risk coverage. This does not waive protocol-required runs or release checks.

Create realistic cases in `evals/evals.json`. For an improved Skill, snapshot the old Skill before editing. For a new Skill, use a no-Skill baseline.

For each case create:

```text
<workspace>/iteration-N/eval-<id>/
├── eval_metadata.json
├── with_skill/
│   └── outputs/
└── old_skill/ or without_skill/
    └── outputs/
```

Metadata format:

```json
{
  "eval_id": 1,
  "eval_name": "descriptive-name",
  "prompt": "realistic user request",
  "assertions": []
}
```

### 2. Launch paired runs together

Launch the current and baseline run for every case in the same turn. Keep inputs and requested outputs identical. Save complete task outputs and privacy-safe evidence projections in their assigned run directories; never persist raw provider streams, private reasoning, or raw tool arguments.

The Goose reference adapter can execute scaffolded pairs directly:

```bash
skill-creator full-eval <skill-directory> --workspace <workspace> \
  --execute --model <model> --grader grader-a=<grader-model> [--baseline old_skill --baseline-skill <snapshot>]
```

A successful one-command run intentionally stops review-ready when no human decision was supplied; that blocked checkpoint is not an evaluation failure. Machine output includes ordered executable recovery commands, and `--resume` begins at the first incomplete phase.

Each run uses `goose run --no-session` in a fresh temporary workspace. The adapter enforces the scenario model, declared tools, timeout, and `budget.max_turns` (default 40 when omitted). It records the host version, exit reason, duration, reported tokens or an explicit unavailability reason, output, grading, and bound execution evidence. `transcript.json` and `events.json` are sanitized projections containing bounded event type/timing, tool name, safe workspace-relative locator when available, and explicit redaction markers—not raw transcripts. A missing or failing host returns a typed blocked/failure receipt; omit `--execute` to preserve the manual evidence workflow.

#### Optional advanced behavioral preparation (fixed plans, preparation only)

This is not required for the simple Anthropic-compatible activation loop. Use
`run-evaluation --mode activation --with-skills <installed-name> --eval-set <file> --output <new-dir>` as documented in [trigger evaluation](trigger-evaluation.md)
for that loop. The behavioral packet interface below is an optional, incomplete
advanced path, not the default current-session evaluation workflow.

To export fixed behavioral candidate packets directly from the Skill:

```bash
skill-creator prepare-execution --skill-path <skill-directory> [--eval-set <file>] [--output <new-directory>] [--model <id>] [--baseline-skill <snapshot>]
```

`--eval-set` defaults to `<skill-directory>/eval.json` (the existing behavioral
scenario schema, not the trigger-only query/should_trigger format). `--output`
defaults to `<skill-directory>/eval_result/<dd-mm-yy>-<run-id>` using the local
calendar date and a fresh UUID. Explicit paths override defaults. The directory
must be new; an output inside the Skill must be beneath root `eval_result/`.
Input snapshots exclude root `eval_result/`, `eval.json`, `.git/` and `.verification/`.
The selected eval file is frozen separately. Prior results are never candidate inputs.
The command creates its internal `.inputs/`, `.campaign/`, `candidates/` and
`run.json` under the result directory; no manual scaffold is required.
The returned `skill` and `eval_set` identify original inputs, while `workspace`
identifies the internal frozen campaign. Required task fixtures remain relative
to the Skill directory, including when the evaluation file lives elsewhere.

The legacy `prepare-execution <workspace> --output <new-directory>` entry remains
available for an existing fixed `full-eval` scaffold; that packet destination
must be outside its source and campaign trees. This command launches no model. It exports one `host-candidate-request-v1` packet
per planned run, staged fixtures and variant instructions. Candidate packets contain
only the frozen prompt, variant instructions, working directory, model selector,
reasoning, tools, budget and explicit isolation/enforcement limitations. Assertions
and `expected_output` are not forwarded. Required output syntax therefore belongs
in the frozen prompt; do not append hidden expected answers during delegation.
Staged variant copies exclude root `evals/`, `.agents/`, `.host/` and metadata.
These exclusions are not a general secret detector: inspect shareable source inputs
and declared fixtures before exporting them.

The coordinator-only manifest binds packets to original metadata and workspace
bytes. Give each candidate only its packet and working directory, never this
manifest, another packet, grading requests or the parent campaign. Host discovery
and absolute filesystem access are not proven isolated; tools and budgets are
requested constraints, not evidence of enforcement. Seed/order bindings describe
the frozen plan, not verified provider seed application.

This is **preparation only**: no claims, native result submission, candidate completion,
provider telemetry, grading or accepted execution receipt are produced. Adaptive
plans are rejected until scheduler admission is integrated. Existing destinations
are never intentionally overwritten. Do not relabel these packets as Goose runner
evidence or handwrite receipts. Continue implementation of the native submit boundary
before claiming a complete agent-controlled campaign.

### 3. Use the frozen assertions

Define assertions before step 2 and keep the eval set and metadata aligned. Each assertion checks one observable requirement of the same coherent user task. Use scripts for genuinely deterministic properties and semantic grading for meaning or usefulness. New criteria discovered during review belong in the next iteration, rerun against both variants; never add hidden criteria after seeing one output. See [evaluation design](evaluation-design.md) for a concrete plan/handoff example.

### 4. Capture timing and normalized telemetry

Record reported duration and token data immediately. If the backend does not expose a metric, write null plus an `unavailable_reason`; never invent it. Provider usage and cost are read only from provider event metadata, never assistant output or nested output JSON. Counts are nonnegative safe integers and aliases must agree. When all five additive components (input, output, reasoning, cache read, cache write) are present, total must equal their sum. With a partial component set, total must be at least the sum of reported components; a smaller total is contradictory and unavailable. This documented lower-bound rule accommodates providers that omit zero or separately accounted components without accepting contradictions. A currency-specific field fixes its currency: `cost_usd` means USD and conflicts with explicit non-USD metadata. Generic cost requires one agreeing supported ISO currency. TTFA begins after preflight and host-version discovery, and advances only for an observable tool request or terminal non-reasoning task output.

Tool, reference, and file metrics persist occurrence and unique counts separately. Navigation evidence contains only bounded workspace-relative locators. URI schemes, userinfo, query strings, fragments, controls, absolute/escaping paths, and credential-like values are redacted. Malformed stream JSON creates typed invalid parse provenance and a redacted parse-error event. A run may continue only when a separately parsed valid terminal output exists; parse errors remain recorded even then. The telemetry schema version and parser protocol are part of run/cache identity, so legacy cached entries safely miss while legacy evidence remains readable.

#### Efficiency metric taxonomy and attribution boundary

Paired reports classify every metric before making a downstream-savings statement:

- **Context/overhead:** input tokens, cache-read tokens, cache-write tokens, and any future prompt/context-overhead metric. These may describe context overhead but never prove downstream execution savings.
- **Downstream execution:** output tokens, reasoning tokens, turns, tool calls, execution-derived reference/file reads, time to first useful action (TTFA), total duration, and retries. Only a negative paired mean for one of these component-specific metrics can support observed downstream savings.
- **Overall consumption:** total tokens. Its paired delta may be reported, but because it includes context/prompt overhead it can never independently prove downstream savings.
- **Resource tradeoff:** provider cost unless the provider exposes compatible context and downstream cost components. Aggregate cost is not treated as downstream savings.

Savings are paired observed differentials, not causal attribution. Input/cache/total-token reductions and metrics containing prompt or context overhead are explicitly excluded from downstream evidence. Reference and file counts qualify only when derived from observed execution. When component decomposition is absent—for example, only `total_tokens` or aggregate cost is available—the report marks downstream attribution unavailable rather than inferring it. JSON, Markdown, and review tables expose each metric’s category, eligibility, and boundary.

### 5. Grade every run

### Execution isolation limits

Candidates, subprocess graders and trigger checks inherit the operator environment unchanged. The runner does not rewrite HOME, USERPROFILE, XDG, GOOSE_PATH_ROOT, temporary-directory variables or keyring settings; it does not copy secrets, parse provider configuration, require environment credentials or force --no-profile. Goose resolves normal configuration and authentication, including stored credentials or provider login. Each run still uses a separate process and workspace; graders get a fresh temporary cwd. This is workspace separation, not discovery isolation or an OS sandbox. Ambient Skills, hints, extensions, profiles, tool permissions and environment settings may influence both variants or graders; do not claim an uncontaminated no-Skill baseline, tool-free grader or proven independence from fresh process IDs alone. Confirm equivalent operator context before paired execution, record relevant non-secret limits, and use a new campaign after context changes. Never persist environment dumps, credential values or credential stores in evidence. Runner/grader protocol identities distinguish this policy from historical isolated runs and prevent cross-policy resume/cache reuse.

Every candidate tool plan, including developer-enabled plans, receives the staged SKILL.md body by direct instruction injection. This proves instruction exposure only, not natural activation, tool availability, actual resource access or correct use. Supporting-resource references require the declared developer tool; availability is not proof that the model used a resource correctly. POSIX candidate cancellation owns a detached process group, escalates SIGTERM to SIGKILL after 250 ms, and reaps descendants holding pipes; Windows currently targets only the direct child. No additional builtins are requested by the subprocess grader, but the host still exposes its built-in load_skill mechanism; an fresh grader cwd is not a tool-free guarantee. Candidate resource access requests the developer builtin only when declared. Host-specific availability and actual correct resource use require independent verification; mock-host tests establish adapter behavior, not real-provider task success.

### Observable task artifacts

Unlocated contains, not-contains and regex checks search each actually shown readable decoded task source separately, never artifact paths, hashes, encoding labels, metadata or JSON transport escapes. Regex matches cannot bridge sources. A visible match decides positive pass or negative fail; no match with any omitted or unreadable selected source is inconclusive, never proof of absence. Use exists with an explicit file locator to assert file presence.

Required equals, not-equals, contains, not-contains and regex operands must be supplied before candidate execution or grader spend. Contains, not-contains and regex operands, and file/stdout equals or not-equals operands, must be strings: no null, boolean, number, array or object coercion is allowed. JSON equality through a JSON-pointer locator accepts explicit expected:null, false, 0 and empty string as values, not missing operands; expected takes precedence over checker.value. Both shorthand and structured regex patterns and flags compile during authoring preflight, across all scenarios before dispatch (including resume); invalid patterns, flags or text operand types fail without candidate or grader calls. Direct low-level checker invalid-regex fallback is inconclusive, not a host exception. JSON-pointer equality compares the selected JSON value; a missing member fails both equals and not-equals. Stdout equality compares literal final-response text, not parsed JSON. exists defaults to presence when its operand is omitted; an explicit operand is interpreted as a boolean (null means absence). File equality compares bytes and preservation compares observed pre/post hashes.

The final assistant response is retained verbatim, including JSON output fields, siblings, whitespace and nested objects. Task-authored self-grading fields remain untrusted text, never evaluator authority. For native Goose stream-json, final response means only the last completed, user-visible assistant message before the successful terminal boundary, not all assistant text in the session. Contiguous fragments sharing a message ID are actual deltas: append every text block exactly, including repeated or prefix-identical text; never deduplicate them as cumulative snapshots. A new message ID supersedes prior commentary. Tool requests invalidate their message, and tool/user boundaries require a later final assistant message. Tool responses, thinking, hidden/internal text and preliminary commentary never become final-response evidence.

Native response selection rejects missing final text, malformed or unsupported intervening events, reused identities across boundaries, truncation markers, and messages or duplicate completions after the terminal boundary. A single anonymous assistant message can be unambiguous; multiple anonymous fragments, or mixed anonymous/identified fragments without a boundary, fail explicitly rather than being guessed together. Notifications/progress do not contribute text. Existing explicit terminal-string command adapters retain their separate literal-string compatibility path, with terminal-boundary checks; this is not a native Goose completion payload. The same selector governs candidate output and both command-grader capabilities.

Paired runs preserve regular workspace files before temporary-workspace cleanup under `outputs/artifacts/<workspace-relative-path>`. `outputs/task-evidence.json` uses protocol `task-artifacts-v1` and binds final bytes and pre-run file hashes. Its historical field stdout is the final assistant response, not arbitrary task-command stdout; exit_code is the Goose host process status, not the exit status of commands executed by task tools. To test task commands, require a captured command/result artifact with a frozen file locator. Root .agents and .host are excluded. For agent-authoring evaluations, request a nested project output such as project/.agents/agents/ with matching assertions; root .agents is host discovery state and cannot prove delivery. Capture rejects symbolic links, special files, unsafe paths, more than 512 files or 2048 entries, depth over 32, any file over 4 MiB, and total file bytes over 16 MiB. Context validation checks canonical base64, SHA-256 consistency, paths, shape, and bounds; verifiers check exact captured artifact membership and the rendered projection. These are local integrity checks, not signatures or external authenticity. Pre-run hashes are evaluator observations, not independently authenticated external evidence.

`result.txt` is a deterministic grading projection, capped at 256 KiB including stdout and artifact descriptions. Exact binary bytes remain preserved but are labeled uninterpreted; oversized text bodies are omitted with an explicit notice, never silently treated as correct. Semantic graders must return inconclusive when omitted or uninterpreted content prevents judgment. Deterministic file locators inspect the captured bytes rather than this textual projection. Use synthetic, shareable fixtures: discovery isolation is not an OS sandbox or a secret detector, and task artifacts can contain candidate-written sensitive data.

Capture rejection is evidence-capture-rejected, distinct from host execution failure. Preserve outputs/capture-rejection.json, the bounded final response, sanitized transcript/events, timing, execution outcome and hashes, and any safely captured partial artifact bytes. Partial evidence remains inspectable but is not a complete task-evidence manifest, a semantic pass or reusable completed execution; do not erase it or silently rerun paid work.

Read `../agents/grader.md`. Assign one independent blinded grader to each output by default, not one call per assertion. Supply the task context, that output, and all frozen semantic criteria in one batch; hide variant identity, other outputs, and prior grades. `CommandGraderAdapter` invokes all semantic assertions once per run/grader. Delegated grading already groups per-assertion records by the same `(run, grader)` boundary. Separate assertion results and provenance remain retained.

A single valid decisive grader can produce pass or fail. Honest bound ambiguity is available but inconclusive; missing or invalid evidence is unavailable. Multiple requested graders must all supply valid agreeing decisive judgments to support a conclusive result.

Decisive semantic evidence requires an exact non-empty quote from the actually shown losslessly decoded artifact text or final assistant response, plus a non-empty rationale explaining the verdict. The serialized JSON projection, metadata, base64 fields and JSON escape spellings are not quote sources. Captured-but-omitted content, uninterpreted binary text, omitted stdout and unchanged non-output inputs cannot authenticate a semantic quote. With task context, the candidate projection must exactly match that context; internal `evidence_source {path, sha256}` binds the selected raw source. Import, retained reuse and independent provenance verification recheck context/projection, artifact membership and exact source bytes. Historical stdout-only fixtures without execution manifests remain explicitly readable, but that exception never grants decoded artifact context. A bound honest `inconclusive` judgment may instead have an empty quote and a substantive rationale; it is reviewable uncertainty, not decisive proof or a task failure. No lexical overlap test decides semantic correctness. Containment establishes where a quote came from, not whether it proves the requirement. Explicit self-awarded grading claims are rejected; ordinary terms such as tests or acceptance criteria are not themselves self-grading. Identity, blinding, assertion, variant, output, stale and replay checks remain in force. Current adapters do not accept arbitrary descriptions as `evidence_quote`.

The readable result uses:

```json
{
  "expectations": [
    {"text": "...", "passed": true, "evidence": "..."}
  ],
  "summary": {"pass_rate": 1}
}
```

### 6. Aggregate and analyze

```bash
skill-creator aggregate <workspace>/iteration-N --skill-name <name>
```

Read `../agents/analyzer.md` and identify weak assertions, variance, regressions, and time/token tradeoffs.

### 7. Generate the review artifact

Interactive:

```bash
skill-creator review <workspace>/iteration-N \
  --skill-name <name> \
  --benchmark <workspace>/iteration-N/benchmark.json
```

Headless:

```bash
skill-creator review <workspace>/iteration-N \
  --skill-name <name> \
  --benchmark <workspace>/iteration-N/benchmark.json \
  --static <workspace>/iteration-N/review.html
```

The viewer uses trusted manifest paths and hashes to preview nested text and offer exact binary downloads without interpreting binary content. Bounded or truncated previews are visibly partial, and a full download is unavailable when bytes were not embedded. Missing, invalid or mismatched manifests are reported as omissions/unavailability, not treated as complete evidence.

For later iterations, add `--previous-workspace`. The static and live modes render the same canonical decision IR; see [Decision-oriented evaluation review](review-viewer.md) for verdict, evidence, filtering, accessibility, and security semantics.

### 8. Validate evaluation completion

```bash
skill-creator full-eval <skill-directory> --workspace <workspace>/iteration-N --resume [options]
skill-creator verify <skill-directory> --profile evaluation --evaluation <workspace>/iteration-N [options]
```

A complete receipt describes artifact completeness, not a passing result. Honest bound inconclusive grades can complete aggregation, static review, receipt and pattern analysis and reach human review in either grading mode without inventing quality or a winner. The receipt records uncertainty and release_eligible: false; human approval cannot manufacture missing or statistically invalid quality. Missing or invalid evidence still blocks. Report `pass`, `fail`, `blocked`, and `na` exactly. Routine iteration does not require release finalization; retain the separate statistical and release requirements below for their own claims.

## Unavailable grading and grading-only recovery

Semantic ambiguity or a non-empty honest rationale with an empty evidence quote is available but inconclusive and can reach human review; missing, invalid, failed or budget-exhausted grader evidence is unavailable and blocks quality completion. Completed task execution is not a semantic pass. Unavailable grading contributes no quality, delta or winner claim and is not published as reusable complete cache evidence.

With unchanged current protocol and validated execution/output bindings, full-eval --resume retries only unavailable grader slots under the declared per-invocation grading-call cap. The current paired executor initializes that counter to zero on each invocation; it does not enforce a cumulative cross-resume call budget. It retains valid prior judgments and completed outputs, transcript, task-evidence manifest, timing and executor provenance; it does not rerun the candidate. Resume rereads task-evidence.json as bound evidence. Stale or tampered execution bindings fail closed instead of silently executing a replacement. Restore transport availability without changing frozen semantic identities; independently bound the number of recovery attempts if a cumulative campaign budget is required; otherwise preserve the workspace and start a new iteration. Delegated mode retains its separate export/import-grading boundary before resume.

## Grading compatibility

The current grading protocol is `semantic-evidence-v10-final-message-strict-native-boundary`, with the actual adapter capability bound as `output-batch`, `per-assertion`, or `delegated`. Separate legacy per-assertion calls receive distinct invocation IDs; a shared output batch records usage once. The runner identity is `paired-stream-json-v8-final-message-strict-native-boundary`. Sampling remains `skill-creator-adaptive-sampling-v3` inside the unchanged `2.0` envelope. These identities bind final-message selection by ID/deltas and strict native boundary rejection, together with stateful fatal UTF-8 decoding (including EOF flush) in candidate and grader streams, string-only text operands, regex preflight, original-text Unicode evidence spans and verified delegated deterministic-only finalization, preserving the earlier shown-source, exact assistant-text, capture, critical-flag and rederived-decision safeguards. Valid 2/3/4-byte characters survive arbitrary transport chunk boundaries; malformed or truncated stream bytes fail explicitly rather than creating replacement-character evidence. Decoder carry state is bounded to an incomplete sequence; existing output retention limits remain unchanged. Historical v9 (and earlier) grading, v7 (and earlier) runner and v2 sampling identities remain archival, not rewritten or accepted for current resume/cache. Preserve old artifacts and start a new iteration: corrupt historical captures cannot be repaired by rehashing or relabeling. Structural archival readability does not authorize current reuse. Protocol hashes establish consistency, not external authenticity.

### Native stream source provenance

This adapter policy was checked against the official `block/goose` tag **v1.55.0**, fetched 2026-10-25 (Git tree `2bcb8583a18a0623eb78c9ed845d597ed99fae48`), not inferred from model knowledge or an assumed current CLI version. This is a source-verified compatibility target, not evidence of a live provider run. Recorded SHA-256 snapshots:

- [session/mod.rs](https://github.com/block/goose/blob/v1.55.0/crates/goose-cli/src/session/mod.rs), lines 147–173, 1476 and 1619: message events and telemetry-only completion; `b37d88ab54a3c619e6889baa6b9d2489de6ffb2949556a6805911469f7d6e07d`.
- [reply_parts.rs](https://github.com/block/goose/blob/v1.55.0/crates/goose/src/agents/reply_parts.rs), lines 171–181 and 480–516: contiguous mergeable chunks receive one ID; `eac10f0f7f67802fb622d6722a510d13995b83e93f0ef7b4feab02adce2d9458`.
- [inference.rs](https://github.com/block/goose/blob/v1.55.0/crates/goose-agent/src/inference.rs), lines 344–348 and 476–504: individual chunks are emitted, not accumulated snapshots; `8c401eefa5c151116a8800e553d6283bc762bbb80174bbdc62a57e200a8fa3be`.

The strict rejection rules above are this evaluator adapter’s fail-closed policy, not a claim that Goose supplies a completion response field. Refresh official tagged sources before broadening native stream support.

## Iteration

After human review, read `feedback.json`, improve the Skill, rerun all paired cases in a new iteration, and compare against the previous workspace. Stop when the user accepts the result, feedback is empty, or further iterations produce no meaningful improvement.

For rigorous A/B comparison, read `../agents/comparator.md` and keep variant identity hidden from the judge.

### Repeated counterbalanced pairs

`full-eval --run-profile fast|standard|release` requests exactly 1, 3, or 5 paired repetitions per scenario. Standard and release plans must declare a validated root `aggregate_budget` with positive `max_runs`, `max_turns`, and `timeout_seconds` large enough for every current/baseline run. An insufficient budget fails before run scaffolding; an interrupted or failed schedule returns typed `incomplete-paired-runs` data rather than silently aggregating a prefix.

Each scenario receives deterministic per-pair seeds and alternating current-first/baseline-first order. Both members retain pair index, seed, order, order position, model, ordered tools, fixture snapshot hash, timeout, turns, and source provenance. Change any evaluation input or profile to invalidate and regenerate the schedule.

Fixed-suite quality inference uses complete suite repetitions as the sampling unit, with equally weighted scenario paired effects within each repetition. Different scenarios run once are not independent replications. Missing or inconclusive quality excludes the affected round from inference and must not establish a winner. Aggregation reports sample count and mean for available observations. Sample standard deviation is descriptive for two or more observations. A 95% Student-t confidence interval is emitted only for explicitly independent repetitions with at least two observations and positive empirical standard deviation; singleton and degenerate (zero-variance) observations have null intervals and statistically_valid=false. Sample count or identical observed effects never prove stochastic stability. Independent stable repetitions and approximate normality of round effects are conditional assumptions, not verified by the summary. Missing quality rounds invalidate fixed-suite inference. Stable improvement requires every planned round to be complete and the eligible paired-difference interval to be wholly above zero under those assumptions. Both evaluation and release behavior gates require complete fixed-suite method 2.0 evidence, at least two valid paired suite repetitions, stable improvement and an ordered wholly positive interval (or a verified adaptive winner). Singletons, degenerate effects and incomplete sampling remain blocked/inconclusive even after a human pass. Release evidence must never describe one stochastic pair as stable improvement. These Student-t summaries are fixed-sample descriptions; the existing `fast`, `standard`, and `release` profiles and their output remain unchanged.

Fixed paired duration and token summaries also use complete suite repetitions rather than scenario-pair pooling. Declared scenario membership and repetition counts are read from the frozen metadata, so entirely missing scenarios or rounds cannot manufacture stability. Efficiency percentiles remain descriptive and do not prove quality improvement. Adaptive preflight warns when no allowed look can cross the winner boundary even at the maximal paired effect; it does not weaken the bounds or guarantee useful power when crossing is possible.

For optional stopping, use the separately predeclared `finite-horizon-fixed-weight-hoeffding-cs-v2` policy implemented by `anytime_quality.js`. A look is a complete pair index across every declared scenario, and its bounded quality difference is aggregated with immutable scenario weights. The policy versions and hashes the quality bounds, minimum and maximum pairs, alpha/confidence, practical superiority delta, regression tolerance, winner/regression multiplicity fractions, and optional futility equivalence interval before data are observed. Per-look alpha uses the normalized finite-horizon schedule `((M+1)/M)/(t(t+1))`; one-sided Hoeffding bounds and a union bound provide simultaneous coverage under optional stopping. The fixed estimand is the predeclared fixed-weight mean paired quality effect under a stable round data-generating process with independent rounds; arbitrary dependence within a paired round is allowed. This does not support a source-population generalization under informative missingness. The policy predeclares a comparison family (family ID, global alpha, planned count and positive allocation weights, comparison ID/index); campaign alpha must not exceed that comparison allocation, and the default family contains exactly one comparison. Winner and regression require strict crossing after the minimum. Futility uses non-strict closed equivalence containment and the explicit `at_max` rule: `futility-if-contained` is checked before maximum-look inconclusive, while `inconclusive` makes futility early-only. Canonical scenario/pair ordering, a policy SHA-256, an observation-set SHA-256, and deterministic look traces make asynchronous completion order auditable without changing semantics. Persisted sequential artifacts embed the policy, canonical observations, and result; consumers must use the strict bounded regular-file, non-symlink reader, which recomputes and exactly compares every hash, look, bound, and decision before returning data. These SHA-256 values are integrity bindings, not proof of external authenticity; authenticity requires a trusted signature, MAC, or independently trusted digest/distribution channel. Numeric policy caps bound pairs, scenarios, observations, artifact bytes, quality magnitude/range, and alpha; integer fields must be safe integers and every derived weighted value, logarithm, radicand, and confidence bound must remain finite.

### Progress stream semantics

`--progress jsonl` writes newline-delimited JSON to stderr and keeps the same durable projection in `<workspace>/progress.jsonl`; stdout remains reserved for the final command result. Each complete line is one UTF-8 JSON object with a globally monotonic `sequence` and idempotent `event_id`. Writers lock and replay the shared log before append, ignore duplicate event IDs, fsync appends, and atomically replace `progress.json`, so concurrent processes cannot regress counters. A truncated trailing line is discarded during recovery; corruption in a completed line is an error.

Fixed verification and receipt validation independently recompute summaries and decisions from verified planned execution/grading runs, current declared scenario/configuration membership and exact source bindings. They compare statistical/resource summaries, raw projections, membership/counts, campaign authority and efficiency projections, then recheck evidence stability. Editable hashes or receipt booleans alone cannot authorize release. Historical unbound evidence remains archival; operator test/trigger/review declarations remain attestations, not authenticated external proof.

### Persisted adaptive uncertainty compatibility

Scheduler schema `1.0` and anytime artifact schema `2.0` retain an optional additive `campaign_stop` object with exactly `reason: inconclusive-grading`, the next admitted uncounted `round`, and sorted unique `uncertain_runs`. Marker-free historical bytes retain their original meaning and statistical trace; no migration or silent relabeling occurs. The marker participates in canonical state/artifact hashes and does not add an observation/look, impute zero quality, change Hoeffding bounds, skip an admitted round, or introduce a new public `stop_reason` value. All admitted cells must have available grading; honest inconclusive quality stops the campaign at human review with terminal inconclusive result, unchanged counted prefix and no winner/release eligibility. Unavailable grading remains awaiting-grading and grader-only retryable. Only untouched future tasks may be superseded. Workspace verification derives the marker independently from bound admitted grades and checks artifact agreement; rehashed invented markers fail. Delegated resume re-enters scheduling after import before admitting another round.

Compatibility registry surfaces `skill.adaptive-state.v1` and `skill.anytime-quality.v2` validate the actual persisted shapes and local integrity only; current workspace readers independently rederive policy, observations, looks, membership and decisions. Additive marker support does not change the statistical method or grant archival evidence current-protocol reuse.

## Historical fixed-workspace compatibility

Compatibility policy `fixed-workspace-compatibility-v1` supports only trusted schema `2.0` jobs created before decision fields existed. Trust requires complete absence of all decision-policy/binding fields and a recognizable historical phase plus metadata/evidence shape; adaptive intent is never inferred. Unknown versions, mixed/partial bindings, adaptive markers, identity drift, and ambiguous workspaces fail closed.

Preview with `skill-creator migrate-evaluation <workspace> --dry-run`, apply with the same command without `--dry-run`, or use `full-eval ... --resume` for an unambiguous legacy fixed job. Both preview and successful migration return `original_job_sha256` and an exact `rollback_command`; record the digest in an independently trusted channel outside the migrated workspace. Migration serializes operations with an owned durable lock, captures bounded no-follow snapshots, rejects symlinks and special files in every controlled path, and detects identity changes before publication. It publishes canonical local journal, backup, archive, and receipt files using unique exclusive temporary files. These local files provide consistency and recovery bindings only: an attacker able to rewrite and rehash the workspace can forge all of them, so they do not authenticate the original job. Migration populates fixed bindings only and does not rerun historical evidence. Current aggregation must use an explicit new output path/regeneration workflow rather than silently changing archival bytes.

Rollback is explicit only and requires the original digest from that external channel: `skill-creator migrate-evaluation <workspace> --rollback --expected-original-sha256 <sha256>`. Missing or malformed digests block before mutation. Rollback rereads the backup with no-follow semantics, requires its bytes to match the externally supplied digest, and checks the journal, receipt, target, source/plan, and archive consistency bindings before atomically restoring it. A wrong digest or any inconsistent local rehash fails without changing the current job. Reapplying after rollback likewise requires the external digest; `full-eval --resume` never implicitly rolls back and blocks rather than implicitly reapplying a rolled-back workspace. Preserve local migration files for recovery and audit, but never treat their presence or hashes as proof of authenticity.

`--progress-interval <ms>` throttles/coalesces published `progress.json` and stderr snapshots. The first completed run and every failure, blocked, cancelled, or evaluation-complete event bypass the interval. The durable JSONL event log is never throttled. `--progress none` suppresses stderr only. Successful finalization sets `status=complete`, `provisional=false`, and `final_receipt=true`; this terminal projection is absorbing across restarts, duplicate finalization, and late concurrent events. `review.html` is canonical and final. `partial-benchmark.json` and `partial-review.json` remain explicitly marked `canonical=false` and `historical=true` for audit history. Receipt validation remains compatible with legacy artifacts that omit optional finality fields, but rejects any explicit provisional, non-final, noncanonical, or historical designation in canonical benchmark, review, or progress metadata.

### Evidence-bounded instruction-efficiency review

An evaluation workspace may include `instruction-efficiency-evidence.json` to request additive analysis of observable instruction patterns. Each evidence locator is a structured `{artifact, selector, sha256}` value. `artifact` must exist under a current `eval-*/<configuration>/run-N/` directory and be one of the sanitized JSON artifacts; its digest must match both the file and `execution-evidence.json`. `selector` uses only bounded event indices (`events[start:end]`) or the documented closed fields for navigation, timing, grading, deterministic evidence, and execution evidence. Arbitrary fragments, missing artifacts, unknown fields, and unbounded indices are rejected.

Classification is derived from explicit predicates observed in those selected fields, never trusted from the requested label. The closed classes are `missing_instruction`, `ambiguous_instruction`, `overly_general_instruction`, `redundant_instruction`, and `poorly_routed_progressive_disclosure`; an unsupported requested label is rejected. Observation statements must equal the closed non-causal template for the derived class, so paraphrased private-state or causal stories such as “latent rationale”, “led to”, or “resulted in” cannot enter the artifact. The analyzer emits only the fixed non-causal hypothesis and bounded recommendation templates.

Instruction targets must resolve against headings parsed from the current `SKILL.md` or its current directly addressed `references/*.md`. An omission instead requires both a precise `missing_behavior` and an `insertion_location` that resolves to such a heading; vague free-text locations are invalid. Recommendations require available, non-regressed current quality and every affected observed metric to be taxonomy-eligible with a negative current paired mean. Non-improved or worsened efficiency produces no recommendation.

Recommendations from the current campaign are unconfirmed. Confirmation requires a distinct chronologically later compatible A/B campaign, the same metric ID, unit, and complete taxonomy, available non-regressed quality, and a paired mean that actually improves beyond the current campaign for every affected metric. The later campaign must exist at campaigns/<campaign-id>/ as a contained regular non-symlink directory. Confirmation snapshots its canonical final benchmark.json, terminal progress.json, passing receipt.json, execution manifests, and manifest-listed evidence with no-follow and bounded reads; receipt/source/plan/benchmark hashes, nonempty paired aggregate membership, and the recomputed execution-evidence digest must agree. Later metrics come only from that bound benchmark, never caller fields. Stable content-derived IDs deduplicate equivalent recommendations. Output order is deterministic: poorly routed progressive disclosure, missing, ambiguous, redundant, overly general; then normalized target and stable content ID.


## Fixed and adaptive decision policy modes

### Durable comparison families and retry-inclusive DGP

Adaptive releases derive one authoritative family registry from the registered repository root (`.evaluation-control/comparison-families/<family-id>`); caller-selected alternate roots are rejected. Its locked canonical manifest has an immutable configuration hash and a separate evolving state hash, so concurrent append-only claims do not invalidate campaign resume. Claims transition `claimed → prepared → verified-final`: preparation binds the statistical result, while finalization occurs only after canonical aggregation, receipt, and release verification and binds the verification receipt. Public family status is always freshly reread and hash-verified from this authority. A release may state a familywise conclusion only when every planned comparison is registered and verified-final; otherwise it must say **partial family — no familywide conclusion**.

The execution sampling protocol is constructed internally from concrete runtime options and adapters; callers cannot inject an arbitrary protocol object. Strict validation and hash recomputation apply at construction, resume, run identity, and evidence verification. The binding includes runner and grader executable argv digests, adapter/protocol versions, provider/model revision, all provider concurrency/rate/budget/reservation/accounting/lease settings, retry classification/Retry-After/backoff/jitter behavior, grader identities/configuration/budget/timeout, orchestrator concurrency, and every scenario timeout/turn budget. Each excluded field carries a reason and proof that it cannot affect selection or outcomes; credentials and endpoint strings are transport-only, and a behavior-changing endpoint requires a new provider/model revision.

The default semantic grader (`--grading-mode subprocess`, or the flag omitted) spawns one `goose run` subprocess per output/grader batch, with an explicit `--model` for each `--grader id=model` declared at plan time (`CommandGraderAdapter`). This is a legitimate default path, not a deprecated one: it needs no interactive session and its subprocess use is no more "nested" than candidate execution's own `goose run` invocation. [ADR 0001](adr/0001-host-delegated-semantic-grading.md) records the trust boundary, lifecycle states (including `awaiting-grading`), and non-goals for an **optional** alternative selected with `--grading-mode delegated` — a Goose parent session delegating grading to isolated subagents via its native delegation tool instead of a second subprocess — useful when a session is already running interactively and would rather avoid a second per-call `goose run` for a judgment task that should not require tools; this intent is not host-enforced tool absence. With either mode, `--execute` with semantic assertions and no `--grader` fails fast rather than resolving an implicit default model. When a run reports `awaiting-grading`, follow the [delegated semantic grading workflow](delegated-grading-workflow.md).


### Adaptive family release finalization

A normal fast or standard `full-eval` run uses the `evaluation` verification profile. Even when those gates pass, its family claim remains `prepared`; an inconclusive or otherwise non-release result also remains prepared, and the family conclusion stays `partial-family` / `none`. Use `full-eval ... --finalize-release --human-review pass --tests-status pass --triggering-status pass` to perform explicit release verification. The transition to `verified-final` requires `verify_skill_gates` to return `status: pass`, `profile: release`, and adaptive evidence with a terminal winner and its required sample. The command is lock-serialized and idempotently resumable.

Final publication uses this acyclic provenance order: execution evidence -> immutable release-verification receipt -> comparison-family authority -> canonical benchmark/review/public receipt. Canonical public artifacts cite the upstream hashes but are not inputs to those hashes. After authority mutation, the command fresh-reads the family manifest and republishes the benchmark, review, receipt, job response, and claim/conclusion projection.


A delegated scenario with no semantic assertions uses the existing evaluator-owned deterministic grading, verified against its original mode, source, task context, assertion/variant/output hashes and independently rederived outcomes. It requires no invented delegated grade, dummy grader or semantic call, whether explicit grader identities were declared or not. Prepare skips those runs; status/import recognize verified completion even with an empty judgment directory. Fixed/adaptive deterministic-only and mixed suites reach human review and resume without rerunning completed candidates or grading deterministic-only runs. Semantic scenarios still require their delegated evidence; an empty judgment directory is not a bypass for missing semantic judgments.

Provider transport is provider-agnostic: copied config.yaml retains provider parameters, with exact uppercase config-key environment overrides and common CLI provider/model overrides. Goose resolves required configuration and authentication; the evaluator performs no provider-specific endpoint/model preflight. System keyring access is not forcibly disabled: children retain the same OS user and explicit session-bus address (DBUS_SESSION_BUS_ADDRESS on Linux), without querying or exporting keyring secrets. An operator-supplied GOOSE_DISABLE_KEYRING setting is respected. A reachable/unlocked keyring service is still required; headless or unavailable services may fail. Do not restore real HOME or extract keyring keys to work around failures. Azure CLI auth caches outside copied Goose configuration are not transported. Failed stdout and stderr are inspected in bounded memory for closed safe diagnostic categories. Raw failed streams are never retained; unclassified errors remain unknown. Signal/timeout/exit status are preserved.
