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
and, for hooks, [recorded target compatibility](references/goose-target-compatibility.md)
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

## Delivery branches

- [Author or migrate](references/authoring-workflow.md): separate destination,
  preserved originals, component inventory, manual findings and unmapped items.
- [Archive](references/archive-workflow.md): requested archive identity, contents,
  integrity and prerequisites, not implicit behavioral evaluation or publication.
- [Installation review](references/installation-diagnostics.md): verified current
  host/repository guidance and separate authorization, not obsolete doctor tooling.

## Scenarios and historical material

The [suite](evals/evals.json) uses short natural requests and supported fields.
[Coverage](evals/coverage.md) maps instruction source to question, criteria and
proof; [preparation](evals/preparation.md) defines neutral inputs and setup outside
prompts. Import/dry-run is static preparation, not behavioral evidence.

[Lossless originals](references/historical/pre-ap-9ato/INDEX.md) retain the rejected
suite and rewritten references. Other legacy research, receipts, CI orchestration
and full-eval references are explicitly historical, not current commands or gates.
No format snapshot or runtime/generated launcher is changed by these instruction
improvements. Installation, model calls, credentials and publication remain
separate permissions.
