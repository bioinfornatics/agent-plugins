# Hook scenario preparation

## Neutral task inputs

Evaluate the **hook-creator Skill** against its absence using identical task bytes,
paths, tools and model settings. Declared `files` are inert input capture in each
arm, not installed plugins. Do not activate hooks or install any fixture in Goose.
`target` is descriptive; there is no scenario setup hook or safety enforcement.

Cases 1/2 use immutable historical empty/unsafe fixtures as task inputs in fresh
workspaces. Case 1 may modify only its captured empty plugin copy, preserving
manifest bytes. Case 2 is audit-only and its missing handler must not be executed.
Cases 3/4/5/6 use new `evals/inputs` copies, not historical originals. Case 3 has a
reviewable Python handler and inert payloads; case 4's observer is deliberately
ineffective blocking code supplied for review, not a hook to activate or execute.
Case 5 asks about the older target; no binary receipt is supplied. Case 6 includes a
claim of prior testing without receipts; that claim is data, never proof.

`literal-guard` changes the **new fixture only**: anchored tool matcher and literal
command equality (whitespace is significant), plus JSON-shape handling. Historical
`assets/evaluation-fixtures/exact-rm-guard` retains its unanchored matcher and
`.strip()` behavior unchanged. Allow/block, padded, metacharacter, nonmatching,
unanchored-name, missing optional fields, wrong JSON shapes and malformed inputs
are distinct policy/input boundaries, not extra model cases.

## Execution gates

This correction authorizes static checks and suite dry-run only. No model campaign,
handler execution or live-host activation is performed as proof in this slice.
For future case 1/3 runs, obtain explicit local handler-test authority, inspect code,
then invoke only the contained handler with JSON redirected to stdin. **Never eval,
shell-interpolate or execute any payload command**, including safe-looking commands.
A controller, not the candidate's reply, must capture exit/stdout/stderr and effects.
All other cases require read-only inspection; unsafe/missing handlers stay unrun.

Before any future model/grading campaign freeze source/fixture identities, host/tool
availability, effective model/default/unknown identity, repetitions, turn/time limits,
stopping rule and independent reviewer. Obtain explicit authority; no monetary cap
or scenario-level action enforcement is supplied by the CLI. External controls must
exclude nested model/delegation/campaigns, automatic retries, Git, tracker, live
installation, credentials, network and publication in either arm. Fake HOME is not
an OS sandbox. Missing controls/capabilities leave execution gated.

## Proof and historical boundary

Independently parse JSON, compile matcher regex, inspect contained paths and executable
mode; compare pre/post hashes. Direct handler observations do not prove HookManager
match/dispatch, event availability, spawn/dependency/timeout fail-open, Stop block-cap
recovery or lifecycle activation. These require separately authorized version-bound
host evidence, currently **unverified**. Candidate claims and old receipts are not
current proof; preserve failures/inconclusive outcomes.

`evals.json` is the discovered supported subset. The rejected enriched original is
preserved verbatim in `historical/evals-pre-ap-9ato.json`. The existing
`run-contract.json` sidecar, attestation/approval schemas and retained runtime/scripts
remain historical, unchanged, and are not enforced by the current suite reader.
