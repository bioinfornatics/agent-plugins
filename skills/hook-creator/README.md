# Hook Creator

Instruction-only authoring, audit and isolated handler testing for host-specific
plugin hooks. Read [SKILL.md](SKILL.md), [hook source](references/hooks.md) and
[recorded target compatibility](references/goose-target-compatibility.md).

Use native `hooks/hooks.json` with contained handlers and a valid root
`plugin.json`. Matchers are regular expressions. Only PreToolUse and Stop block;
ordinary failures/timeouts fail open. Direct handler tests, source review and
observed host activation are separate evidence levels.

No hook component validator or creator executable is supplied. Retained runtime,
scripts, manifests, attestations, approval schemas and `evals/run-contract.json`
are historical, not active command contracts. Current Skill/Plugin comparative
tooling belongs to skill-creator; standalone hooks are unsupported sources.

[Coverage](evals/coverage.md) maps instructions to user requests and independent
proof. [Preparation](evals/preparation.md) defines neutral fixtures and execution
gates. Real-host activation remains unverified.
