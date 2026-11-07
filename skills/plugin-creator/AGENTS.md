# Plugin Creator authoring boundary

Read repository instructions before edits. Keep metadata/instructions English,
descriptions concise and third-person, and SKILL.md <=500 lines. Write only the
approved files and preserve pre-existing work.

- Plugin Creator owns package manifests, MCP integration and whole-package routing.
  Bundled Skills are in scope; standalone Skills/agents route to their specialists.
- Portable Agent Plugins 1.0.0 includes Skills and MCP, not agents or hooks. Keep
  recorded canonical schemas unchanged unless upstream refresh and approval exist.
- Native Goose hooks use `hooks/hooks.json`. Distributor adapter structure does
  not establish activation; preserve native sources and block ambiguous layouts.
- Creation, plugin/component validation, packaging, installation and full-eval
  creator CLIs/native executables are retired. Do not invoke old scripts.
- Shared skill-creator guidance owns supported standalone Skill `validate`,
  evaluation/history/inspect, explicit grading/regrading/judgments/export and its
  contained static HTML helper. History/inspect are read-only. None validates a
  plugin manifest, proves host activation or supplies production approval.
- Evaluation sources are selected Skills and/or Plugins, never standalone hooks,
  agents or MCP-only benchmarks. Authoring does not authorize model execution.
- Active references must not prescribe retired tooling. Preserve rewritten originals
  in `references/historical/` outside suite discovery; label remaining legacy
  references historical and retain their evidence.
- Scenario prompts are short user questions, not supplied solutions. Only supported
  suite fields; neutral inert fixture bytes go to both arms. Put setup and execution
  governance in evals/preparation.md and source/criteria/proof in evals/coverage.md,
  not constraint extensions or a parallel tracker.
- Distinguish static format review, archive checks, behavior, host compatibility and
  publication authority. Report exact commands/results and missing proof.
