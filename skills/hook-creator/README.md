# Hook Creator

Instruction-only authoring, audit and isolated handler testing for host-specific
hooks. Read [SKILL.md](SKILL.md), then only the selected host inventory linked below. For Goose component creation,
modification or audit, also read the [Goose workflow](references/goose-workflow.md).
Shared review, authorized verification and delivery remain in the entrypoint.
The retained [hook source](references/hooks.md) is historical Goose evidence.

For Goose, use native `hooks/hooks.json` with contained handlers and a valid root
`plugin.json`. Matchers are regular expressions. Only PreToolUse and Stop block;
failures default to allow; documented PreToolUse `on_failure: block` can select denial, while Stop remains fail-open. Direct handler tests, source review and
observed host activation are separate evidence levels.

No hook component validator or creator executable is supplied. The obsolete creator scripts/runtime have been removed. Retained manifests,
attestations and approval schemas are historical, not active command contracts. Current Skill/Plugin comparative
tooling belongs to skill-creator; standalone hooks are unsupported sources.

The active suite supplies task inputs and assertions; verify equivalent execution prerequisites in both arms. Real-host activation remains unverified.

## Supported host baseline

Active instructions target current stable host releases and current official documentation.
Do not teach historical version branches unless the user explicitly requests an older target.
Record agent-plugin version, host/version, feature, evidence and verification status in
compatibility matrices instead. A documented capability is not a tested integration;
unsupported or untested hosts remain explicitly unverified. Refresh upstream before
changing public contracts and keep exact runtime versions in execution provenance.

## Host-specific inventories

Hook Creator selects one host reference before authoring. Read [Goose](references/goose-hooks.md),
[Claude Code](references/claude-code-hooks.md), [Codex](references/codex-hooks.md) or
[OpenCode](references/opencode-hooks.md) only for that target. These dated official
documentation/source inventories are not tested integrations or a shared hooks schema.
