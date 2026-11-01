---
name: plugin-script-packaging
description: Designs and verifies language-aware executable packaging for Agent Plugins across source installs and native releases. Use when adding TypeScript, Rust, Python, or other CLI runtimes, dependencies, launchers, or cross-platform binaries to a plugin.
---

# Plugin Script Packaging

Design or verify executable packaging inside an Agent Plugin; do not invent portable dependency fields. Put vendor runtime metadata under a reverse-domain `plugin.json.extensions` key and label it vendor-specific.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement or evaluation. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

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
3. Keep editable implementation/tests/lockfiles in repository source areas; keep each installed Skill self-contained. Declare one unambiguous entrypoint per language/profile. Use native commands first for verification; invoke source launchers only for the declared source profile.
4. For design/build requests, declare versioned namespaced runtime metadata, source/runtime mapping, pinned toolchain/compiler/freezer/targets/lockfile and entrypoint patterns. Generate projections, dependency closure, licenses/notices, checksums/inventory; never hand-edit generated runtime material.
5. Apply selected-language rules for build/install scripts, native extensions, shared libraries, interpreters and target selection. Never ship editable `.ts`/`.rs`/`.py` implementation in installed runtime profiles; never mix source-profile material with native executables in one profile.
6. Resolve installed paths relative to the Skill; reject absolute/traversal mappings and symlink escapes. Forward argument arrays without shell interpolation; propagate exit codes/signals; never package credentials or reach into repository/application paths or undeclared system packages.
7. For invocation/verification, run only the declared entrypoint. Missing entrypoints or incompatible mixed artifacts mean incomplete/mixed packaging; do not search for fallbacks, rebuild or install dependencies without authorization.
8. Validate source projections in isolated copied Skills without repository fallback; clear language search paths, user packages and build-tool environment. Test native artifacts without their source interpreter/build tool. Run applicable whole-plugin validation through plugin-creator.
9. Install/smoke-test only when requested. For Goose Git installation confirm revision, declared profile and exact contained entrypoint; for native archives verify checksum/release manifest and invoke the target binary. Restart the host only if discovery requires session startup. Never run end-user npm/Cargo/uv/pip installers.
10. Report command contract, requested layout/manifest/generation commands, executed smoke tests, exit codes/hashes and status for each promised mode/platform. A source run does not prove a native target; static layout is not execution; native binaries are not portable across OS/CPU. Hand whole-plugin validation/release back to plugin-creator; stop at the requested action.

## Execution limits

- Execute the requested branch with supplied context; ask only for a decision blocking its next action. Continue unaffected authorized work.
- Follow repository instructions, Beads policy and current authority. Preserve existing edits, fixtures and evidence. Authoring does not authorize installation, credential changes, publication or paid campaigns.
- Run the native command first; do not add readiness audits, generic diagnostics, custom harnesses or recursive reference loading. Read linked detail only at its applicable action; reuse available guidance.
- On an actual error, apply one concrete authorized correction and retry once, or report the exact blocker and stop. Do not weaken criteria or silently expand scope/budget.
- Report files, commands, observed outcomes, missing evidence and next action; stop at the requested deliverable. Static conformance is not behavioral effectiveness or host compatibility.
