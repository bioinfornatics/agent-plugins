# Hook Creator

Instructions for authoring and manually reviewing Goose/Open Plugins lifecycle hooks. The Skill is usable as instructions without a dedicated executable.

## Source and scope

Read [hook source](references/hooks.md), [Goose target compatibility](references/goose-target-compatibility.md) and [SKILL.md](SKILL.md) before selecting events or layout. Target compatibility overrides stale snapshot layout. Hooks are executable, security-sensitive plugin components, not standalone `.agents/hooks` assets.

Use `<plugin>/hooks/hooks.json` with contained handlers and a valid root `plugin.json`. Route a missing plugin scaffold and whole-package review to plugin-creator; Skills to skill-creator; custom agents to agent-creator. These names identify instruction Skills, not creator shell commands.

## Manual authoring review and handler tests

Review JSON, supported events, regular-expression matchers, command actions, timeouts, contained paths, dependencies and executable permissions. Only PreToolUse and Stop block; read the target contract before claiming support. Configuration review alone is not blocking-safety evidence.

When authorized, test handlers against isolated representative payloads and retain observed exit/stdout/stderr. Cover matching/nonmatching, allow/deny, malformed input, missing optional fields/dependencies and recovery. Do not mutate live host installations. Explain failure modes and remaining host-activation gaps.

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. The current distribution has no creator native executables and no creation, validation, packaging, grading or installation CLI.

The only distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history` and `agent-plugin inspect` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route to the available skill-creator instructions for the exact invocation and authorization. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

## Historical material

Retained evaluation manifests, attestation and production-approval references/schemas describe retired workflows. They are historical evidence, not current signing, verification, approval or evaluation commands. No automated review confers deployment authority.
