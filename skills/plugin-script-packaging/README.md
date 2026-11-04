# Plugin Script Packaging

Guidance for designing and verifying executable closure in a requested Agent Plugin. TypeScript is the default language branch; Rust and Python guidance applies only when the requested plugin actually uses them. See [SKILL.md](SKILL.md).

Use the available plugin-script-packaging Skill for language-specific layout, dependencies and launchers. Route whole-plugin manual source-format review and separately authorized release work to plugin-creator. Neither name denotes a current creator executable.

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. The current distribution has no creator native executables and no creation, validation, packaging, grading or installation CLI.

The only distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history` and `agent-plugin inspect` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route to the available skill-creator instructions for the exact invocation and authorization. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

## Historical references versus requested plugin runtimes

Retained dual-runtime, language and verification references contain historical creator examples. Their native archives, creator commands and platform evidence do not describe the current distribution. Native packaging guidance can inform a separately requested external plugin runtime only after its own declared modes, toolchain and verification are established. No native executable, package/validate/install CLI, grading pipeline or release approval is supplied here.
