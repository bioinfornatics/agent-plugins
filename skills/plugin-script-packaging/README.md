# Plugin Script Packaging

[SKILL.md](SKILL.md) guides language-specific executable closure, launchers and explicitly requested external native packaging. TypeScript is the default branch only when no other language is supplied; Rust requires exact prebuilt targets, and Python requires a declared interpreter artifact or target-specific frozen build.

## Current tooling boundary

This Skill is instructions, not a creator executable. Agent, hook and whole-plugin creator command families, packaging/install CLIs and creator native executables are retired. The separate contained `skills/skill-creator/scripts/skill-creator.mjs` launcher requires Node.js >=22.22.2. Its current commands include evaluation, read-only history/inspect, standalone Skill validate, explicit grading/regrading/judgments and export. Its contained report helper reads an explicit export. Consult available skill-creator instructions for exact contracts and authority; do not invoke application sources or retired launchers as fallback.

Evaluation accepts selected Skills and/or Plugins, not standalone agents/hooks; no model run is implicit in authoring or packaging. Whole-plugin manual manifest/conformance review, host installation and separately authorized publication belong to plugin-creator. Component tests do not establish host discovery, release authority or native compatibility.

## References and evaluation

Active [architecture](references/dual-runtime-architecture.md), [verification](references/verification-matrix.md), [TypeScript](references/language-typescript.md), [Rust](references/language-rust.md) and [Python](references/language-python.md) references give external-runtime principles without proposing portable fields. Only current linked references define authoring behavior.

The discovered [suite](evals/evals.json) covers six design/audit/handoff purposes plus actual interpreted launcher verification. The active suite supplies task inputs and assertions; verify equivalent execution prerequisites in both arms. The neutral fixture is test data, not this Skill's distributed runtime or a native executable.

## Supported host baseline

Active instructions target current stable host releases and current official documentation.
Do not teach historical version branches unless the user explicitly requests an older target.
Record agent-plugin version, host/version, feature, evidence and verification status in
compatibility matrices instead. A documented capability is not a tested integration;
unsupported or untested hosts remain explicitly unverified. Refresh upstream before
changing public contracts and keep exact runtime versions in execution provenance.
