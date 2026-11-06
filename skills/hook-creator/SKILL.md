---
name: hook-creator
description: Creates and reviews plugin lifecycle hooks and handler tests. Use for hooks.json, matchers, tool-call policy or blocking safety, not standalone agents or whole plugins.
---

# Hook Creator

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. Their creation, component-validation, packaging and installation APIs remain retired; no creator native executables are supplied.

The shared distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history`, `agent-plugin inspect`, standalone Skill `validate`, explicit `grading`/`regrading`/`judgments` and `export` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route evaluation, grading, export and HTML review to the available skill-creator instructions for the exact invocation and authorization; its contained `scripts/generate-report.mjs` reads an explicit export without model calls. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement, evaluation or report review. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

Route agents to `agent-plugins:agent-creator`; whole-plugin scaffold, validation, packaging, installation or release to `agent-plugins:plugin-creator`. For interactive tools use verified MCP/extension tooling; for repeatable orchestration use recipe tooling. Hooks are executable, host-specific plugin components, not portable core or standalone `.agents/hooks` assets.

## Select and execute

- Create/modify: read [hook source](references/hooks.md) and [target compatibility](references/goose-target-compatibility.md) before choosing events/layout; compatibility overrides stale snapshot layout. If the target has no valid `plugin.json`, obtain a minimal scaffold through plugin-creator before authoring. Work in that same workspace, not a second plugin root.
- Validate/audit: manually compare the hook document and referenced handlers with the source and target contract; document component findings; do not scaffold or run unrelated audits.
- Test handler: execute supplied representative payloads in an isolated fixture and collect exit/stdout/stderr evidence.
- Blocking audit: inspect event, matcher, resolved command and executable path; test allow, deny, malformed input, missing dependencies and recovery. Configuration alone is not safety proof.
- Evaluation requests: standalone hooks are unsupported CLI sources. Ask whether the user wants a supported Skill/Plugin evaluated; do not substitute handler tests for comparative evaluation.

## Author and verify the component

1. Use native `<plugin>/hooks/hooks.json` and contained command scripts. Do not generate namespaced adapter documents without verified activation. Consult [snapshot refresh](references/UPSTREAM.md) only when updating the source contract.
2. Select supported events from the source and target contract. `PreToolUseResult` is observation-only on the recorded modern target and absent from v1.47.0. Only `PreToolUse` and `Stop` block; all other events observe.
3. Use an optional regular-expression matcher, not a glob. Anchor exact tool matches (for example `^developer__shell$`); omit for all events or intentionally use `.*`, never bare `*`. Explain intended event/tool population and the policy decision left inside the handler.
4. Use only documented `command` actions and `${PLUGIN_ROOT}` paths. Set timeout when the default 30 seconds is unsuitable. Read complete stdin JSON; tolerate optional event fields; reject unsafe input without shell interpolation. Document dependencies; make directly invoked handlers executable.
5. Keep blocking fast/deterministic, never telemetry or slow network calls. Signal denial with exit `2` and stderr reason, or stdout JSON beginning `{"decision":"block","reason":"..."}`. Ordinary failures/timeouts fail open; do not mistake arbitrary nonzero exits for denial. Give actionable reasons; never request a prohibited retry.
6. Use Stop sparingly: it can loop; the host caps consecutive blocks through `GOOSE_STOP_HOOK_BLOCK_CAP`.
7. Manually review the component format and handler executability. Check valid JSON/manifest, supported events, compiling matchers, nonempty command actions, valid timeouts, existing contained references, safe stdin/dependencies and no placeholders.
8. Test matching/nonmatching, allow/deny when blocking, missing optional fields, malformed payloads, absent dependencies and recovery. Return changed files, runtime prerequisites, matcher rationale, safety results and remaining limits to the caller/plugin-creator; do not duplicate whole-plugin validation.

## Execution limits

- Execute only the requested branch; ask only for decisions blocking it. Preserve existing work and evidence.
- Do not claim an automated validator for hook components; shared Skill validation checks only Skill frontmatter. Review source format manually; identify the inspected files, findings and unverified behavior. Do not claim component validation, grading results, generated reports or production approval without the corresponding observed checks; shared evaluation/report tooling does not validate this component format.
- Read linked detail only for the applicable action. Historical command workflows are not current tools; do not revive their commands or imply they are pending features.
- Authoring does not authorize installation, credential changes, publication or paid campaigns. Any requested host operation needs current source-backed instructions and separate authority.
- On an error, report the exact blocker; do not weaken criteria or silently expand scope. Static conformance is not behavioral effectiveness or host compatibility.
