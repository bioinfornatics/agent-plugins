---
name: plugin-creator
description: Orchestrates plugin authoring, manual format review and component routing. Use for plugin.json, whole-plugin migration, evaluation or packaging guidance.
---

# Plugin Creator

Scope generated packages to plugins installed under `.agents/plugins`; do not generate standalone Skill/agent assets. Own complete package architecture, `plugin.json`, MCP/Goose integration, validation and requested packaging/release. Route component content; do not replay unrelated phases.

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. The current distribution has no creator native executables and no creation, validation, packaging, grading or installation CLI.

The only distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history` and `agent-plugin inspect` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route to the available skill-creator instructions for the exact invocation and authorization. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement or evaluation. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

| Requested component | Specialist | Required handoff |
|---|---|---|
| Skill authoring/audit/improvement/evaluation | `agent-plugins:skill-creator` | Manual source-format findings or explicitly requested supported-source evaluation |
| Hook rule/handler | `agent-plugins:hook-creator` | Manual component review and observed handler/blocking-safety evidence |
| Explicit separately supported custom agent | `agent-plugins:agent-creator` | Valid role and verified project/user installation scope |
| Executable/runtime/native packaging | `agent-plugins:plugin-script-packaging` | Command contract, contained dependency closure, mode-specific proof |

Delegate only disjoint files. Do not claim plugin `agents/` is portable or auto-installed by Goose; custom agents use `.agents/agents`. Missing specialists do not authorize guessed schemas or simulated handoffs.

## Select and execute

| Request | Next action | Stop condition |
|---|---|---|
| Create | Read format baseline; author `plugin.json` and route only required components | Deliver package files and manual source-format findings |
| Modify/migrate | Read applicable format/host contract; classify inputs portable/adapt/replace/unsupported | Preserve originals unless deletion authorized; identify unmapped items |
| Format audit | Manually compare manifests/resources with the published source; distinguish tolerant loading from strict authoring requirements | Document findings, not automated profile results |
| Packaging design | Review source format; route executable closure/layout to plugin-script-packaging | Deliver requested design or authorized files; no creator package CLI |
| Plugin evaluation | Ask the user to choose Skill/Plugin sources; use the current shared evaluation entrypoint through skill-creator guidance | Retain observed evidence and limitations; no full-eval orchestration or grading/report promise |
| Installation/release | Use verified current host/repository instructions only under separate authorization | No creator install, doctor or release-verification CLI; do not infer approval from static review |

## Format and host guards

Before changing a package contract, read [Goose plugin format](references/goose-plugin-format.md) and [portable conformance](references/portable-conformance.md).

- Emit published Agent Plugins **1.0.0** canonical schema identifiers, root `plugin.json`, optional `skills/` and root `mcp.json`. Treat 1.1.0 as inactive Working Draft, not supported by similarity.
- Keep only required resources; never package secrets. Document prerequisites/credentials without their values. Keep references and `${PLUGIN_ROOT}` paths contained and scripts executable.
- For newly authored/migrated packages manually review tolerant portable loading and strict authoring requirements separately. Apply relevant specialist source-format review to changed components, not an unrelated readiness audit.
- For portable MCP use canonical root `mcp.json`, `mcpServers`, and closed stdio/streamable-http/sse variants; do not package env/header secrets.
- For Goose MCP distinguish host configuration: default root `.mcp.json` or inline/path `plugin.json.mcpServers`. Root `mcp.json` is not auto-discovered. Explicit `./mcp.json` works only for selected stdio entries with `command`; unknown `type`/`$schema` fields are ignored, but remote entries lack required `command` and transport mapping.
- Allow co-shipped portable/Goose documents only with one governed activation path: default `.mcp.json` or approved `exclusive: true` path. Block ambiguous duplication, including non-exclusive `./mcp.json` beside `.mcp.json`. Obtain approval before changing selected paths; migrate only safely mapped closed variants.
- For hooks read [Goose target compatibility](references/goose-target-compatibility.md). Keep native `hooks/hooks.json`, not distributor namespaces. v1.47.0 rejects PreToolUseResult; main-2b17adc accepts observation only. Source profiles do not identify the running binary.
- Treat adapter structural checks as activation warnings, not host proof. Fail closed on multiple hook layouts; preserve native hooks and block adapter-only migration without reviewed activation evidence. Review blocking and command side effects separately.

## Execution limits

- Execute only the requested branch; ask only for decisions blocking it. Preserve existing work and evidence.
- Review source format manually; identify the inspected files, findings and unverified behavior. Do not claim an automated validator, grading result, report generator or production approval.
- Read linked detail only for the applicable action. Historical command workflows are not current tools; do not revive their commands or imply they are pending features.
- Authoring does not authorize installation, credential changes, publication or paid campaigns. Any requested host operation needs current source-backed instructions and separate authority.
- On an error, report the exact blocker; do not weaken criteria or silently expand scope. Static conformance is not behavioral effectiveness or host compatibility.
