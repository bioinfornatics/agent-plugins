---
name: hook-creator
description: Creates, audits, and tests lifecycle hooks inside Open Plugins. Use for hooks.json, event matchers, hook handlers, notifications, logging, tool-call policy, PreToolUse blocking, or Stop safety; not Skills, agents, MCP, or whole-plugin packaging.
---

# Hook Creator

Prefer native `hook-creator init`/`validate`. For a source copy use Node.js 22+ with `node <skill-root>/scripts/hook-creator.mjs`; native archives use the released executable. Report missing contained runtime/mapping as a packaging defect; do not use internal scripts as released commands.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement or evaluation. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

Route agents to `agent-plugins:agent-creator`; whole-plugin scaffold, validation, packaging, installation or release to `agent-plugins:plugin-creator`. For interactive tools use verified MCP/extension tooling; for repeatable orchestration use recipe tooling. Hooks are executable, host-specific plugin components, not portable core or standalone `.agents/hooks` assets.

## Select and execute

- Create/modify: read [hook source](references/hooks.md) and [target compatibility](references/goose-target-compatibility.md) before choosing events/layout; compatibility overrides stale snapshot layout. If the target has no valid `plugin.json`, obtain a minimal scaffold through plugin-creator before authoring. Work in that same workspace, not a second plugin root.
- Validate: run `hook-creator validate <plugin-dir>` and report component findings; do not scaffold or run unrelated audits.
- Test handler: execute supplied representative payloads in an isolated fixture and collect exit/stdout/stderr evidence.
- Blocking audit: inspect event, matcher, resolved command and executable path; test allow, deny, malformed input, missing dependencies and recovery. Configuration alone is not safety proof.
- Evaluate: use frozen fixture/payload paths, declared `target.execution`, observable assertions and sufficient authorized budget. Copy immutable fixtures before mutation; grade observed evidence, not hidden criteria or self-reports.

## Author and verify the component

1. Use native `<plugin>/hooks/hooks.json` and contained command scripts. Do not generate namespaced adapter documents without verified activation. Consult [snapshot refresh](references/UPSTREAM.md) only when updating the source contract.
2. Select supported events from the source and target contract. `PreToolUseResult` is observation-only on the recorded modern target and absent from v1.47.0. Only `PreToolUse` and `Stop` block; all other events observe.
3. Use an optional regular-expression matcher, not a glob. Anchor exact tool matches (for example `^developer__shell$`); omit for all events or intentionally use `.*`, never bare `*`. Explain intended event/tool population and the policy decision left inside the handler.
4. Use only documented `command` actions and `${PLUGIN_ROOT}` paths. Set timeout when the default 30 seconds is unsuitable. Read complete stdin JSON; tolerate optional event fields; reject unsafe input without shell interpolation. Document dependencies; make directly invoked handlers executable.
5. Keep blocking fast/deterministic, never telemetry or slow network calls. Signal denial with exit `2` and stderr reason, or stdout JSON beginning `{"decision":"block","reason":"..."}`. Ordinary failures/timeouts fail open; do not mistake arbitrary nonzero exits for denial. Give actionable reasons; never request a prohibited retry.
6. Use Stop sparingly: it can loop; the host caps consecutive blocks through `GOOSE_STOP_HOOK_BLOCK_CAP`.
7. Run `hook-creator validate <plugin-dir>` and `test -x <plugin-dir>/scripts/<handler>`. Check valid JSON/manifest, supported events, compiling matchers, nonempty command actions, valid timeouts, existing contained references, safe stdin/dependencies and no placeholders.
8. Test matching/nonmatching, allow/deny when blocking, missing optional fields, malformed payloads, absent dependencies and recovery. Return changed files, runtime prerequisites, matcher rationale, safety results and remaining limits to the caller/plugin-creator; do not duplicate whole-plugin validation.

For signed offline evidence apply [evidence attestation](references/evidence-attestation.md) at export/import.

## Paid evaluation gate

- Evaluate only on request or under an approved acceptance protocol. Before launch, freeze source/baseline, fixtures, criteria and permitted actions; state the decision, distinct risks, expected outcomes, cheapest valid oracles, total candidate/grader calls (including repetitions, criterion-level grading and repairs), time/cost bound and stopping rule. Disclose unknown prices; obtain authority for paid execution and expansions.
- Cover required safety checks; add cases/repetitions/graders only for uncovered risk or decision-changing uncertainty, not a count target or Cartesian campaign. Prefer deterministic checks for deterministic properties and independent blinded grading for contextual quality. Reject plausible wrong outcomes, mock echoes, self-reported success and circular calculations; do not let a conditional assertion accept both outcomes under the same preconditions.
- Reuse evidence only with matching source, fixtures, protocol and bindings; re-render report corrections without rerunning candidates. Preserve failures, missingness and disagreement; at the bound report blocked/inconclusive, not automatic escalation. A small set is not reliability proof.

## Execution limits

- Execute the requested branch with supplied context; ask only for a decision blocking its next action. Continue unaffected authorized work.
- Follow repository instructions, Beads policy and current authority. Preserve existing edits, fixtures and evidence. Authoring does not authorize installation, credential changes, publication or paid campaigns.
- Run the native command first; do not add readiness audits, generic diagnostics, custom harnesses or recursive reference loading. Read linked detail only at its applicable action; reuse available guidance.
- On an actual error, apply one concrete authorized correction and retry once, or report the exact blocker and stop. Do not weaken criteria or silently expand scope/budget.
- Report files, commands, observed outcomes, missing evidence and next action; stop at the requested deliverable. Static conformance is not behavioral effectiveness or host compatibility.
