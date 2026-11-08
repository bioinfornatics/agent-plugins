---
name: plugin-script-packaging
description: Designs and verifies executable closure for plugin runtimes. Use for language-specific dependencies, launchers or explicitly requested cross-platform packaging.
---

# Plugin Script Packaging

Design or verify executable packaging inside an Agent Plugin; do not invent portable dependency fields. Use only a supplied, documented vendor runtime contract; never invent fields or a schema merely to complete a layout.

## Current tooling boundary

These are authoring instructions, not a creator executable. The agent, hook and plugin creator CLIs are retired. Their creation, component-validation, packaging and installation APIs remain retired; no creator native executables are supplied.

The shared distributed CLI entrypoint is `skills/skill-creator/scripts/skill-creator.mjs`, requiring Node.js **22.22.2 or newer**. It exposes `agent-plugin evaluation`, `agent-plugin history`, `agent-plugin inspect`, standalone Skill `validate`, explicit `grading`/`regrading`/`judgments` and `export` through that launcher. Use the installed skill-creator root to resolve it; do not invoke application sources or retired launchers as a fallback. History and inspect are read-only; they do not grade results or generate review reports.

For evaluation, ask the user to choose supported Skill and/or Plugin source paths. Route evaluation, grading, export and HTML review to the available skill-creator instructions for the exact invocation and authorization; its contained `scripts/generate-report.mjs` reads an explicit export without model calls. Standalone agents and hooks are not evaluation sources. Evaluating a Plugin is not a separate hook/agent benchmark, release approval or host-compatibility proof. Do not run a model campaign merely to finish authoring.

When launching the shared evaluation/resume/grading/regrading commands, leave
heartbeat enabled by default. Observe stderr with an available streaming/wait
capability, separate from stdout JSON. Recognize
`[agent-plugin] <operation>: active; elapsed <seconds>s` (first tick after 10 seconds,
then every 10 seconds). It indicates only a pending command, not model progress
or quality. `-q`/`--quiet` suppress heartbeat only. If output is buffered, disclose
that live monitoring is unavailable. Missing ticks alone never justify a kill,
retry or second paid launch; wait on the same process and verify final exit status
and results. Read-only/help/dry-run commands have no heartbeat. Follow the available
skill-creator evaluation workflow for detailed monitoring; do not assume a sibling
Skill is installed or invent a process-monitoring API.

## Reference applicability

The active references describe principles for separately requested external runtimes, not this distribution's native capabilities. Establish the external runtime's actual command, metadata contract and promised modes before using them. Only current linked references define authoring behavior.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement, evaluation or report review. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

Route whole-plugin manifest, conformance, installation or release to `agent-plugins:plugin-creator`. Keep instruction-quality work with skill-creator; do not audit Skills before executing a packaging request.

## Select only the needed context

- Runtime layout, launchers, dependency closure or projection: read [dual-runtime architecture](references/dual-runtime-architecture.md) before changing them.
- Installation-mode/platform claim: read [verification matrix](references/verification-matrix.md) before testing or reporting it.
- Select the language branch for the affected runtime; do not preload every language or assume one universal `.mjs` layout.

| Language signal | Read before designing commands/files |
|---|---|
| Unspecified, TypeScript, JavaScript, Node.js, Bun, npm | [TypeScript packaging](references/language-typescript.md); default to TypeScript only without another signal |
| Rust/Cargo | [Rust packaging](references/language-rust.md) |
| Python/uv/pip/PyPI/zipapp/PyInstaller/Nuitka | [Python packaging](references/language-python.md) |
| Other | State no bundled specialist; derive a named branch from locked graph, source artifact, interpreter/runtime, native targets and reproducible tools |

For polyglot entrypoints choose a primary language and read additional branches only for their runtime components or an explicit comparison.

## Execute the requested branch

1. Define the logical command: arguments, exit statuses, inputs/outputs, side effects, minimum runtime, supported platforms and packaged callers. Use supplied decisions; ask only for blockers.
2. Identify selected host and promised Git/source and/or native modes. Do not infer host installation from the portable format.
3. Keep editable implementation/tests/lockfiles in repository source areas; keep each installed Skill self-contained. Declare one unambiguous entrypoint per language/profile. Invoke only the runtime entrypoint declared for the requested plugin profile; this distribution has no native profile.
4. For design/build requests, record the supplied runtime contract and source/artifact mapping, pinned toolchain/compiler/freezer/targets/lockfile and entrypoint patterns; if metadata is absent, describe needed information in prose rather than inventing a schema. For design-only work, propose these outputs and checks without claiming to build. For authorized builds, generate projections, dependency closure, licenses/notices and checksums/inventory; never hand-edit generated runtime material.
5. Apply selected-language rules for build/install scripts, native extensions, shared libraries, interpreters and target selection. Do not ship editable application trees as installation-time build inputs. Emitted JavaScript and packaged Python interpreter artifacts are valid runtime material; Rust needs prebuilt target artifacts. Keep each declared profile unambiguous; coexistence is not automatically invalid if its supplied contract explicitly governs it.
6. Resolve installed paths relative to the Skill; reject absolute/traversal mappings and symlink escapes. Forward argument arrays without shell interpolation; propagate exit codes/signals; never package credentials or reach into repository/application paths or undeclared system packages.
7. For invocation/verification, run only the declared entrypoint. Missing entrypoints or incompatible mixed artifacts mean incomplete/mixed packaging; do not search for fallbacks, rebuild or install dependencies without authorization.
8. Validate source projections in isolated copied Skills without repository fallback; clear language search paths, user packages and build-tool environment. Test native artifacts without their source interpreter/build tool. Request manual whole-plugin source-format review through plugin-creator.
9. Install/smoke-test only when requested. For Goose Git installation confirm revision, declared profile and exact contained entrypoint; for native archives verify checksum/release manifest and invoke the target binary. Restart the host only if discovery requires session startup. Never run end-user npm/Cargo/uv/pip installers.
10. Report command contract, requested layout/manifest/generation commands, executed smoke tests, exit codes/hashes and status for each promised mode/platform. A source run does not prove a native target; static layout is not execution; native binaries are not portable across OS/CPU. Hand manual whole-plugin source-format review and separately authorized release work back to plugin-creator; stop at the requested action.

## Execution limits

- Execute the requested branch with supplied context; ask only for a decision blocking its next action. Continue unaffected authorized work.
- Follow repository instructions, Beads policy and current authority. Preserve existing edits, fixtures and evidence. Authoring does not authorize installation, credential changes, publication or paid campaigns.
- Use only the requested plugin's declared entrypoint; do not invoke retired creator/native commands or add unrelated readiness audits, generic diagnostics or recursive reference loading. Use focused deterministic tests when requested verification needs an observable oracle. Read linked detail only at its applicable action; reuse available guidance.
- On an actual error, apply one concrete authorized correction and retry once, or report the exact blocker and stop. Do not weaken criteria or silently expand scope/budget.
- Report files, commands, observed outcomes, missing evidence and next action; stop at the requested deliverable. Static conformance is not behavioral effectiveness or host compatibility.

## Current host baseline

Use current stable host releases and official documentation for ordinary requests.
Historical targets are handled only when explicitly requested; version-specific evidence
belongs in compatibility matrices, not alternate everyday workflows. Record the running
host version as provenance and do not claim untested host support.
