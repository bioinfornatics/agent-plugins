# Plugin Script Packaging Skill

Follow root instructions; keep this Skill and its references independently copyable.

- Active references govern separately requested external runtimes, not creator/native availability. Preserve `references/historical/` snapshots and `evals/historical/` suite bytes; these are outside active discovery and not current schema sources.
- Do not invent portable dependency fields or vendor schemas. Use a supplied contract or document missing decisions in prose.
- TypeScript, Rust and Python have different runtime closures; Node is not a universal launcher.
- Current shared launcher belongs to skill-creator: Node >=22.22.2, evaluation, history/inspect, standalone Skill validate, explicit grading/regrading/judgments and export. Consult that Skill for exact usage. Creator packaging/install CLIs and native executables remain retired.
- Route manual whole-plugin review and authorized release to plugin-creator. Evaluation is Skills/Plugins only; history/inspect remain read-only.
- New suites use supported fields only. Declare neutral inputs in `files`; preparation actions and independent proof belong in `evals/preparation.md` and `evals/coverage.md`, not task prompts. Never launch models or touch live installations to validate authoring.
- `evals/inputs/` contains inert task data and a tiny interpreted JavaScript fixture; `evals/verify-fixture.mjs` tests only disposable copies below this Skill. Neither is a distributed application runtime.
- English metadata/instructions; SKILL.md <=500 lines. No hand-edited generated application runtimes.
