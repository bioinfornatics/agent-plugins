# Plugin Creator

Orchestrates whole-plugin authoring, manual format review, MCP integration and
component routing. See [SKILL.md](SKILL.md) for intent selection.

## Scope and formats

Author packages for `.agents/plugins` with published Agent Plugins **1.0.0**
canonical identifiers. Portable core is root `plugin.json`, optional immediate
`skills/*/SKILL.md` and optional root `mcp.json`. The 1.1.0 Working Draft remains
inactive. Standalone custom agents are not portable Plugin components; route them
separately to agent-creator. Bundled Skills route to skill-creator, native hooks
to hook-creator and executable closure to plugin-script-packaging.

Read [format](references/goose-plugin-format.md), [tolerant versus strict review](references/portable-conformance.md)
and, for hooks, [current host contract and compatibility evidence](references/goose-target-compatibility.md)
before governed actions. Native Goose hooks remain `hooks/hooks.json`, not an
unloaded distributor adapter namespace. Portable MCP and Goose activation are
separate: the recorded Goose loader defaults to `.mcp.json`, supports explicit
stdio-only selection of `mcp.json`, and has no portable remote transport mapping.
Co-shipping requires one governed activation path, never guessed precedence.

## Tooling and evidence

This is an instruction Skill, not a creator executable. Old plugin creator
init/validate/package/install/doctor/verify/full-eval command families and native
executables are retired. Do not execute retained old scripts or invent replacements.

The shared contained `skills/skill-creator/scripts/skill-creator.mjs` launcher
requires Node.js >=22.22.2. Route evaluation, standalone Skill format validation,
explicit grading/regrading/judgments/export and static HTML review to available
skill-creator instructions. History/inspect are read-only; the HTML helper reads
an explicit export without model calls. Its commands do not validate whole-plugin
format or prove MCP/hook activation. Evaluation accepts Skills and/or Plugins;
it does not benchmark standalone agents/hooks or compare old/current revisions.
Do not run models merely to finish authoring or package review.

Preserve defaults when delegating or invoking evaluation/grading: omit optional
options unless explicitly requested by the user. Evaluation defaults are Goose,
configured model (no `--model`), repetitions 3, parallelism 3, max turns 50,
timeout 0 and heartbeat enabled. Grading/regrading retain separate defaults of
Goose, configured model, 20 turns and 600 seconds, with heartbeat enabled.
Omit evaluation `--registry`/`--output`; durable data uses the shared XDG registry
(`$XDG_DATA_HOME/agent-plugin/evaluations.sqlite` for an absolute XDG_DATA_HOME,
otherwise `$HOME/.local/share/agent-plugin/evaluations.sqlite`) and sibling
`campaigns/profile=<id>/model=configured-<digest>/campaign=<uuid>`.
Do not infer overrides from cwd/session provider or select `.artifacts`
autonomously for durable evidence. Reuse known nondefault registries for retained
campaign access; resume preserves the exact frozen plan and evidence path. Required
selectors/IDs, export/report `--output` and helper `--workspace` remain explicit,
with authorized new destinations. Honor requested dry-run and partial stages.

## Delivery branches

- [Author or migrate](references/authoring-workflow.md): separate destination,
  preserved originals, component inventory, manual findings and unmapped items.
- [Archive](references/archive-workflow.md): requested archive identity, contents,
  integrity and prerequisites, not implicit behavioral evaluation or publication.
- [Installation review](references/installation-diagnostics.md): verified current
  host/repository guidance and separate authorization, not obsolete doctor tooling.

## Scenarios and historical material

The [suite](evals/evals.json) uses short natural requests and supported fields.
The active suite supplies task inputs and assertions; verify equivalent execution prerequisites in both arms. Import/dry-run is static preparation, not behavioral evidence.

Retired creator workflows and obsolete fixture corpora were removed. Installation, model calls, credentials and publication remain separate permissions.

## Supported host baseline

Active instructions target current stable host releases and current official documentation.
Do not teach historical version branches unless the user explicitly requests an older target.
Record agent-plugin version, host/version, feature, evidence and verification status in
compatibility matrices instead. A documented capability is not a tested integration;
unsupported or untested hosts remain explicitly unverified. Refresh upstream before
changing public contracts and keep exact runtime versions in execution provenance.

### Configured candidate identity

New campaigns freeze the configured provider/model per host before execution; omit
optional `--agent`/`--model` unless the user requests them. Internal runtime pinning
is not a user override. Reports show configured identity and selected session metadata,
not proof of the actual backend. Historical missing identities remain unknown; never
resolve them from current settings or rewrite old grades/reports. Only provider/model
identity is retained, not whole provider parameters or credentials.
