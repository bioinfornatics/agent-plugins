# Delegated semantic grading workflow (optional path)

This is an **optional** grading path, not the default. The default path is the subprocess grader (`--grader id=model`, `CommandGraderAdapter`) documented in [evaluation-workflow.md](evaluation-workflow.md); it spawns its own `goose run` invocation per grader call with an explicit `--model`, exactly like candidate execution already does, and needs no interactive session. Use this delegation-based path instead when a Goose session is already running `full-eval` interactively and you would rather avoid spawning a second `goose run` process per grader call for a task (grading a fixed text) that needs no tools, filesystem, or isolated cwd — only a model call.

Read this reference when a `full-eval --grading-mode delegated` run reports `awaiting-grading` (see [ADR 0001](adr/0001-host-delegated-semantic-grading.md)) and you have chosen to grade the pending requests via delegation rather than the subprocess grader. `--grading-mode delegated` must be passed explicitly on every invocation (scaffold and resume); the default (`--grading-mode subprocess`, or the flag omitted) never produces an `awaiting-grading` checkpoint.

```bash
skill-creator full-eval <skill-directory> --workspace <workspace> --execute \
  --grading-mode delegated --grader grader-a=<model-a> --grader grader-b=<model-b>
```

## What this path avoids, and what it does not avoid

This workflow requires **no ACP transport** and **no MCP sampling capability** — Skill Creator's CLI is a plain process with no sampling capability of its own, so it cannot borrow a parent session's model implicitly; the delegation call is made explicitly by the session, not by the CLI. It also avoids spawning a **second** `goose run` subprocess for grading, reusing the parent session's own model invocation instead.

It does **not** avoid subprocess invocation of Goose in general: candidate execution already spawns `goose run` per paired run today, and that is unaffected by this document. The subprocess grader is not "nested" in any deeper sense than candidate execution already is — nesting depth is not the reason to prefer this path. Prefer it only when you want to avoid a second parallel model-invocation mechanism for a tool-free judgment task, or when the session's own budget/cost accounting should include grading calls directly instead of capturing them from a subprocess's usage report.

## The loop

### 1. Prepare pending requests (deterministic, no model access)

```bash
skill-creator prepare-grading <workspace>
```

This reads the workspace's already-produced candidate outputs and deterministic evidence, and writes one blinded `GradingRequest` per grader declared in each scenario's `grading_plan` (from `--grader id=model` at plan time) into `<workspace>/grading-requests/`. It never invents a grader identity and never substitutes the candidate's own model — each request already carries the exact `grader.model` and `grader.provider` a human declared at plan time.

### 2. Check status

```bash
skill-creator grading-status <workspace>
```

Reports `pending`, `completed`, and `stale` counts and the exact next command. If `pending` is 0 and `completed` > 0, skip to step 4.

### 3. Delegate every pending request to an isolated subagent

A scenario with several semantic assertions produces one request per (run, assertion, grader) — dogfooding on plugin-script-packaging (ap-8di.11) produced 112 individual requests for only 12 runs. Delegating one request at a time works but means one delegate call per request. **Prefer batching by (run, grader)** to cut that down to roughly (runs × distinct graders) delegate calls instead, with no change to blinding, verification, or the judgment schema.

#### Recommended: batch by (run, grader)

```bash
skill-creator group-grading-batches <workspace>
```

Groups every currently-pending request by `(run_directory, grader_id)` into `<workspace>/grading-batches/<batch-id>.json`. Each batch carries the shared `candidate_output` **once**, plus a `requests` array (one `{invocation_id, assertion_id, assertion_version, criterion}` entry per assertion for that run/grader) — no request field is invented; every value is copied verbatim from its already-prepared `GradingRequest`.

For each batch:

1. Read the batch JSON. It contains `grader_model`/`grader_provider`, `candidate_output`, `instructions`, and the `requests` array of criteria to judge.
2. Delegate the **entire batch** to one independent subagent, passing the batch's own `grader_model` as the subagent's model. Give the subagent only the batch's `prompt`/`candidate_output`/`instructions` and the list of criteria — nothing else from the workspace, and no other batch's requests.
3. Instruct the subagent to return **only** a JSON array, one object per request in the batch, each shaped `{"invocation_id": "<copied from the request entry>", "verdict": "pass"|"fail"|"inconclusive", "evidence_quote": "<exact substring of candidate_output>", "rationale": "<short text>"}`.
4. Apply the batch's results:

```bash
skill-creator apply-grading-batch <workspace> <batch-id> <results.json>
```

This builds one canonical judgment file per array entry (via the same `buildGradingJudgment` a single-request judgment would use) and writes them into `grading-judgments/`. An entry whose `invocation_id` is not part of the named batch is rejected (not silently accepted); a request missing from the results array simply stays pending, exactly like a failed single-request delegation. Re-running `group-grading-batches` after applying results only re-groups what is still pending.

#### Alternative: one request at a time

For each file in `<workspace>/grading-requests/*.json` that has no matching file yet in `<workspace>/grading-judgments/<same-name>.json`:

1. Read the request JSON. It contains `prompt`, `candidate.alias`/`candidate.output`, `assertion.criterion`, `instructions`, and `grader.model`/`grader.provider` — never another variant's output, another grader's identity, or a prior verdict.
2. Delegate the request to an independent subagent, passing **the request's own `grader.model`** as the subagent's model (never the parent session's active model, never a value not present in the request). Give the subagent only the request's `prompt`, `candidate.output`, `assertion.criterion`, and `instructions` as its task — nothing else from the workspace.
3. Instruct the subagent to return **only** a JSON object shaped `{"verdict": "pass"|"fail"|"inconclusive", "evidence_quote": "<exact substring of candidate.output>", "rationale": "<short text>"}`. No file writes, no tool calls beyond returning this JSON.
4. Take the subagent's raw JSON response and build a judgment file at `<workspace>/grading-judgments/<same-name-as-request>.json` with this exact shape:

```json
{
  "schema_version": "1.0",
  "kind": "skill-creator-delegated-grading-judgment",
  "invocation_id": "<copy from the request>",
  "request_sha256": "<copy request_sha256 from the request>",
  "bindings": { "<copy bindings verbatim from the request>": "..." },
  "grader": { "id": "<copy grader id from prepare-grading's manifest — see below>", "model": "<copy grader.model from the request>", "provider": "<copy grader.provider from the request>" },
  "verdict": "pass",
  "evidence_quote": "<subagent's evidence_quote>",
  "rationale": "<subagent's rationale>",
  "usage": null
}
```

The grader `id` is not in the request file itself (the request is blinded to avoid leaking grader identity into the candidate-facing prompt); read it from `<workspace>/grading-requests/manifest.json`, keyed by the request's own filename (`invocation_id`), field `grader_id`. Copying any other value than the manifest's `grader_id`/`grader_model`/`grader_provider` for that exact `invocation_id` will be rejected on import — a subagent's judgment must match the identity `prepare-grading` planned for that slot, not any other grader's identity.

Bound parallel delegation: delegate no more than a small fixed number of pending requests or batches at once (a handful, not the entire backlog in one burst) to keep cost and failure blast-radius bounded — a typical host limits concurrent background delegations to a small fixed number. If a delegated subagent fails, times out, or returns malformed JSON, leave that invocation_id's (or, in a batch, that entry's) judgment file unwritten — it remains `pending` in `grading-status` with no fabricated verdict, and can be retried independently on the next pass. A subagent's own final-turn report can fail (e.g. an empty response) even after it has already written a correct results file; check the file on disk before assuming a delegation failed.

### 4. Import and verify (deterministic, no model access)

```bash
skill-creator import-grading <workspace>
```

Every judgment is re-validated end to end: schema, request binding, planned-grader-identity match, exact-quote containment, substantive overlap with the criterion, anti-self-reference, and re-derivation of the current output/variant hash (a judgment answering stale evidence from a re-executed run is rejected, not silently accepted). A judgment file being present is never itself sufficient — only `import-grading`'s own re-validation determines what becomes trusted evidence.

### 5. Resume

```bash
skill-creator full-eval <skill-directory> --workspace <workspace> --execute \
  --grading-mode delegated --grader grader-a=<model-a> --grader grader-b=<model-b> --resume
```

`--resume` must repeat the same `--grading-mode delegated` and `--grader` values used at scaffold time; these are hashed into the phase's input binding, so a resume with different values is rejected rather than silently mixed. Once `import-grading` reports `ready_to_resume: true`, this call regenerates canonical `grading.json`/`execution-evidence.json` from the imported evidence (skipping any candidate re-execution — completed runs are never repeated) and continues aggregation, static review, receipt, pattern review, and verification exactly as it would after any other phase completes.

## Grader plan shapes

- **Development** (fast iteration): a single grader (e.g. `--grader dev=<model>`). `aggregateJudgments` resolves a lone grader's evidence to `inconclusive` rather than a trusted pass/fail — this is expected for iteration, not release evidence.
- **Standard/release** (independent evidence): two or more graders with distinct `id`s and, ideally, distinct models/providers so their judgments are not correlated by shared model failure modes (e.g. one grader on `gpt-5.6-sol`, one on `claude-sonnet-5`, both reachable through a single configured Model-as-a-Service provider such as Azure AI Foundry — a shared provider across distinct models is expected and does not weaken independence; what matters is distinct model identity and separate, blinded invocation).

## No delegation tool available

If the current host has no subagent delegation capability (a non-interactive CI runner, for example), use the default subprocess grading path instead of this workflow — omit `--grading-mode` (or pass `--grading-mode subprocess` explicitly) and declare `--grader id=model` as usual. That path needs no interactive session and is equally supported; it is not deprecated by the existence of this optional delegated path.

## Migrating an existing workspace

An evaluation workspace scaffolded before this optional path existed (or scaffolded with `--grading-mode subprocess`/no flag) already has `evidence_mode.planned` fixed to `goose-evaluator` for its runs; that binding is immutable once scaffolded (`grading_plan_sha256` and `evidence_mode_sha256` are hashed into `execution_binding`). To use delegated grading for a scenario, scaffold a fresh workspace with `--grading-mode delegated` rather than trying to convert an in-place `goose-evaluator` workspace — `full-eval` will reject a resume whose grading mode drifted from what the scaffold phase originally recorded (see `phaseInput`'s `paired-runs-and-grading` hash), rather than silently mixing subprocess-graded and delegated-graded evidence in the same run.

There is no separate `SKILL_CREATOR_GRADER_COMMAND`-to-delegated migration step: that environment variable only ever configured the subprocess path's `goose` binary/argv (still honored by `--grading-mode subprocess`, the default) and has no equivalent in delegated mode, which never spawns a grader process at all.

## Profile semantics

`--run-profile fast|standard|release` governs the number of counterbalanced pairs and statistical rigor of the *comparison*, independent of grading mode. Delegated grading does not relax or strengthen `fast`/`standard`/`release` semantics: a run with a single development grader still resolves semantic evidence to `inconclusive` (per `aggregateJudgments`/`finalizeDelegatedRun`'s unanimous-verdict rule) exactly as a subprocess run with one grader would, regardless of profile — a lone grader never on its own produces a trusted pass/fail, in either grading mode.
