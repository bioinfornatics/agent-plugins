---
name: hook-creator
description: Creates, audits, and tests lifecycle hooks inside Open Plugins. Use for hooks.json, event matchers, hook handlers, notifications, logging, tool-call policy, PreToolUse blocking, or Stop safety; not Skills, agents, MCP, or whole-plugin packaging.
---

# Hook Creator

## Evaluation value and cost boundary

- Evaluate only when requested or required by an approved acceptance protocol; authoring or packaging alone does not authorize a model campaign. Use the smallest set covering distinct plausible failures, user journeys and safety boundaries, not a scenario-count target.
- Before expensive execution, state the decision to inform, each scenario's distinct risk, observable expected outcome and cheapest valid oracle. An assertion must reject a plausible wrong result, not merely echo a mock, accept self-reported success, check file existence or reproduce the candidate's own calculation. Review conditional assertions that accept both success and failure; define the expected outcome for the declared preconditions.
- Declare the total candidate and grader call bound, time/cost budget and stopping rule before launch. Account for scenarios, variants, repetitions, graders, criterion-level calls and repair iterations; label unknown prices as unknown, never free. Use existing supported options or compact planning notes, not invented schema fields. User authorization must cover paid execution and any budget expansion.
- Add a scenario only for uncovered risk or a meaningful interaction. Add repetitions or graders only for a named uncertainty that can change the decision, with marginal calls/cost and a bound. A budget ceiling is not a spending target; no Cartesian campaign or per-component multiplication by default. Required samples and safety checks in an approved protocol remain required; a small set is not reliability proof.
- Prefer deterministic artifact checks for deterministic properties and blinded semantic grading for contextual quality. Reuse compatible frozen evidence only when source, fixtures, protocol and required bindings still match. Report corrections re-render evidence; they do not rerun candidates. Preserve failures and missingness; never retry or rewrite criteria until green. At the bound, report inconclusive or blocked and the next decision, not automatic escalation.

## Offline runtime

Use `node scripts/hook-creator.mjs` for a copied source Skill; it requires Node.js 22+ and resolves only this Skill’s generated runtime. Tagged native archives use the released executable and do not require Node.js. Report a missing runtime or mapping as a packaging defect.

## Source of truth

Read `references/hooks.md` before creating or modifying hooks. It is a vendored snapshot of Goose's `guides/context-engineering/hooks` documentation and defines supported events, configuration fields, payloads, matchers, blocking behavior, and troubleshooting.

Read [Goose target compatibility](references/goose-target-compatibility.md) before selecting events or a layout. It overrides stale snapshot layout guidance. See `references/UPSTREAM.md` when refreshing the snapshot.

## Scope boundary

- Use this creator for native Goose hook documents at `hooks/hooks.json` and their command scripts. Namespaced adapter documents are not natively loaded by the recorded targets; do not generate or migrate to them without verified adapter activation.
- Use `agent-plugins:skill-creator` (or standalone `skill-creator`) for standalone or plugin-bundled Agent Skills.
- Use `agent-plugins:agent-creator` (or standalone `agent-creator`) for standalone `.agents/agents` definitions.

## Plugin Dependency

Unlike Skill Creator, Hook Creator requires an existing plugin with a valid plugin.json. Native Goose hooks live at hooks/hooks.json, not independently under .agents/hooks. Hooks are host-specific and outside portable Agent Plugins core. Author or fix the requested component in that same plugin workspace.

| When to depend on `agent-plugins:plugin-creator` (fallback: standalone `plugin-creator`) | Why | Success criteria before returning |
|---|---|---|
| No `plugin.json` exists yet at the target root | A hook cannot be added to a plugin that doesn't exist; `plugin-creator` owns scaffold creation | `plugin-creator` has created a minimal `plugin.json`; only then author the hook here |
| The user asks to validate, package, or install the *whole plugin*, not just this hook | Cross-component validation, packaging, and installation are `plugin-creator`'s domain, not this creator's | Hand back a hook component that passes this creator's own validator (`hook_format.ts`) — `plugin-creator` re-validates it as part of the full plugin, do not duplicate that step here |

When invoked from `plugin-creator`, return a validated hook component that can be assembled into the same plugin workspace. Do not create a second, unrelated plugin root.

## Workflow

1. Determine the desired behavior and whether a hook is the right mechanism:
   - choose a hook for event-driven local automation;
   - use a skill for procedural knowledge;
   - use an MCP server or extension for interactive tools;
   - use a recipe for repeatable orchestration.

2. Identify the event and matcher target from `references/hooks.md`. Supported events are:
   - `SessionStart`
   - `SessionEnd`
   - `Stop`
   - `UserPromptSubmit`
   - `PreToolUse`
   - `PreToolUseResult` only with the recorded modern target; observation-only, absent from tag v1.47.0
   - `PostToolUse`
   - `PostToolUseFailure`
   - `BeforeReadFile`
   - `AfterFileEdit`
   - `BeforeShellExecution`
   - `AfterShellExecution`

3. Decide whether blocking is required. Only `PreToolUse` and `Stop` can block. Other events are observation-only even if a script prints a block decision.

4. Create or update:

   ```text
   <plugin>/
   ├── plugin.json
   ├── hooks/
   │   └── hooks.json
   └── scripts/
       └── handler.sh
   ```

5. Configure each rule:
   - `matcher` is an optional regular expression, not a glob;
   - anchor a matcher intended for one exact tool name, for example `^developer__shell$`; an unanchored `developer__shell` also matches containing names;
   - omit it to match every event or use `.*` intentionally;
   - never use bare `*`;
   - use only the `command` action type currently supported by Goose;
   - use `${PLUGIN_ROOT}` for plugin-relative commands;
   - keep the timeout explicit when the default 30 seconds is unsuitable.

6. Write scripts defensively:
   - read the complete JSON payload from stdin;
   - treat event-specific fields as optional;
   - never interpolate untrusted payload values into shell commands unsafely;
   - document required commands such as `jq`;
   - prefer portable shell or Python;
   - make directly invoked scripts executable;
   - keep blocking hooks fast and deterministic.

7. For blocking hooks, use exactly one documented signal:
   - exit code `2` with the reason on stderr; or
   - JSON beginning with `{"decision":"block","reason":"..."}` on stdout.

   Unexpected failures and timeouts fail open. Do not rely on an ordinary non-zero exit to block.

8. Validate the plugin hook component with the official bundled validator, not a custom substitute, and preserve its output plus executable-file evidence:

   ```bash
   hook-creator validate <plugin-dir>
   test -x <plugin-dir>/scripts/<handler>
   ```

9. Test handlers with representative payloads. Check both matching and non-matching cases, allow and deny cases for blocking hooks, missing optional fields, malformed input, and absent external dependencies. Evaluation scenarios must name the plugin fixture and payload paths, declare `target.execution`, copy immutable fixtures to a sandbox before mutation, and freeze assertions before execution. A safety grader must use observed exit codes, stdout/stderr, matcher, and executable-path evidence; it must not invent hidden criteria after the run.

10. Return the changed hook files, event/matcher rationale, runtime prerequisites, safety notes, and test evidence to `plugin-creator` or the user.

## Audit and handoff contract

For every blocking-hook audit, inspect the concrete event and matcher, resolve the referenced command, verify that its handler exists and is executable, and test allow, block, malformed-input, missing-dependency, and recovery paths. Report observed safety evidence; never infer safety from configuration alone.

Route creation, validation, packaging, installation, or release of the whole plugin to `agent-plugins:plugin-creator`. This creator returns only validated hook files, handler tests, and safety evidence. The handoff must explain the matcher rationale, not merely repeat its value: state which event/tool population the regex filters, why that scope is neither broader nor narrower than intended, and which exact policy decision remains inside the handler.

## Blocking guidance

Use `PreToolUse` for policy enforcement before a tool executes. A denial should be specific and actionable. Do not ask the model to retry a prohibited action.

Use `Stop` sparingly. A blocking Stop hook keeps a turn running and can create loops; Goose enforces a consecutive block cap, configurable through `GOOSE_STOP_HOOK_BLOCK_CAP`.

Never use blocking hooks for telemetry or slow network calls.

## Quality gate

A hook component is ready only when:

- `hooks/hooks.json` is valid JSON, the plugin manifest exists, and the selected Goose contract supports its events;
- all event names are supported;
- every matcher compiles as a regular expression;
- each rule has at least one command action;
- command and timeout values are valid;
- every `${PLUGIN_ROOT}` file reference exists;
- scripts safely consume stdin and document dependencies;
- blocking behavior is used only with `PreToolUse` or `Stop`;
- representative smoke tests succeed;
- no unresolved placeholders remain.

## Bundled resources

- `references/hooks.md`: vendored Goose hooks documentation.
- `references/UPSTREAM.md`: source and refresh instructions.
- `hook-creator`: unified `init` and `validate` CLI; supports `--format text|json`, `--quiet`, and `--help`. Legacy internal-script entrypoints are not part of the released interface.
- `evals/evals.json`: autonomous creation, safety-audit, handler-behavior, and plugin-handoff scenarios.
- `assets/evaluation-fixtures/`: immutable plugin roots, hook configurations, executable handlers, and inert payloads.
- `references/evidence-attestation.md`: DSSE/in-toto evidence and offline trust policy.
