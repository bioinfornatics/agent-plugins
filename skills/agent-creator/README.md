# Agent Creator

Instruction-only authoring, audit, modification and migration of Goose custom
roles. Read [SKILL.md](SKILL.md) for the workflow and
[custom-agent source](references/custom-agents.md) for the recorded format.

Custom roles live in project/user `.agents/agents/` directories with required
`name`, optional `description`/`model`, and a meaningful Markdown body. A role can
use session-enabled MCP but cannot declare extensions or scheduled workflows.
Portable plugin agents are a different boundary; this guide does not prove their
installation or discovery.

No agent component validator or creator executable is supplied. Retained runtimes,
scripts and privacy/external-evidence references are historical, not active APIs.
Current Skill/Plugin comparative tooling belongs to skill-creator; standalone
agents are not its evaluation sources.

The active [suite](evals/evals.json) is the criterion source; execution prerequisites must be verified separately. JSON import and source review do not prove real-host behavior.

## Supported host baseline

Active instructions target current stable host releases and current official documentation.
Do not teach historical version branches unless the user explicitly requests an older target.
Record agent-plugin version, host/version, feature, evidence and verification status in
compatibility matrices instead. A documented capability is not a tested integration;
unsupported or untested hosts remain explicitly unverified. Refresh upstream before
changing public contracts and keep exact runtime versions in execution provenance.
