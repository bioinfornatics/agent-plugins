# Plugin Script Packaging

[SKILL.md](SKILL.md) guides language-specific executable closure, launchers and explicitly requested external native packaging. TypeScript is the default branch only when no other language is supplied; Rust requires exact prebuilt targets, and Python requires a declared interpreter artifact or target-specific frozen build.

## Routing and boundaries

This Skill supplies instructions, not a creator executable; creator packaging/install
CLIs and native executables remain retired. For requested evaluation, grading,
export or report review, use the available `agent-plugins:skill-creator` Skill (or
standalone `skill-creator`) and its selected workflow/command reference. It owns
launcher, monitoring, defaults and output/identity mechanics; no sibling filesystem
installation or model run is implicit. Whole-plugin review, installation and
separately authorized release belong to plugin-creator.

Keep the intended target host, current authoring harness, actual host-installation
proof, evaluation candidate/judge selections and packaged language runtime/toolchain
separate. Use exact CLI defaults unless the user explicitly requests overrides;
do not substitute the harness or target host for evaluator defaults. Component
tests do not establish host discovery, release authority or native compatibility.

## Select references only for the requested branch

- For layout, launchers or closure, read [architecture](references/dual-runtime-architecture.md).
- Before testing or claiming a mode/platform, read [verification](references/verification-matrix.md).
- For the selected language, read [TypeScript](references/language-typescript.md),
  [Rust](references/language-rust.md) or [Python](references/language-python.md);
  read additional branches only for affected polyglot components or comparisons.

These references describe external-runtime principles, not new portable fields.
Only current linked references define authoring behavior.

For explicitly requested evaluation design/review, consult the available skill-creator
guidance and the local scenario data below; they are not packaging prerequisites.

The discovered [suite](evals/evals.json) covers six design/audit/handoff purposes plus actual interpreted launcher verification. The active suite supplies task inputs and assertions; verify equivalent execution prerequisites in both arms. The neutral fixture is test data, not this Skill's distributed runtime or a native executable.

## Supported host baseline

Active instructions target current stable host releases and current official documentation.
Do not teach historical version branches unless the user explicitly requests an older target.
Record agent-plugin version, host/version, feature, evidence and verification status in
compatibility matrices instead. A documented capability is not a tested integration;
unsupported or untested hosts remain explicitly unverified. Refresh upstream before
changing public contracts and keep exact runtime versions in execution provenance.
