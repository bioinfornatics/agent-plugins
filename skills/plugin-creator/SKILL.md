---
name: plugin-creator
description: Orchestrates complete Open Plugin packages. Use when plugin.json or the whole plugin is the target for creation, validation, migration, evaluation, packaging, or release.
---

# Plugin Creator

Create production-ready Agent Plugins for Goose. Own package architecture, root `plugin.json`, portable MCP declarations, Goose extension integration, whole-package validation, installation, and packaging. Route component content to its specialist.

## Offline runtime

Use `node scripts/plugin-creator.mjs` for a copied source Skill; it requires Node.js 22+ and resolves only this Skill’s generated runtime. Tagged native archives use the released executable and do not require Node.js. Report a missing runtime or mapping as a packaging defect.

## Installation diagnostics

For an explicitly selected installed plugin, read [installation diagnostics](references/installation-diagnostics.md) and use the read-only doctor command. Keep integrity separate from validation, behavioral evidence and publisher authenticity; native checks remain incomplete.

## Format baseline

Read [goose-plugin-format.md](references/goose-plugin-format.md) and [portable-conformance.md](references/portable-conformance.md) before changing a package contract.

- Target published **Agent Plugins 1.0.0**: root `plugin.json`, optional `skills/`, and optional root `mcp.json`.
- Emit canonical 1.0.0 schema identifiers in `plugin.json` and `mcp.json`.
- Treat vendored **1.1.0 as an inactive Working Draft**. Do not generate or validate it as supported based on schema similarity.
- Put new Goose hooks under `plugin.json.extensions["io.github.bioinfornatics.agent-plugins.goose"]`, pointing to `extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json`.
- Keep portable and host contracts separate. Portable Agent Plugins 1.0.0 uses root `mcp.json`. Current Goose defaults its plugin MCP loader to root `.mcp.json`, or accepts inline/path-based `plugin.json.mcpServers`; it can explicitly point that path configuration to `./mcp.json`. Do not claim Goose auto-discovers `mcp.json`.

## Specialist routing

| Specialist | Invoke when | Required result |
|---|---|---|
| `agent-plugins:skill-creator` (fallback `skill-creator`) | Any bundled Skill is new or modified | Valid frontmatter, name/path consistency, focused instructions, and requested evaluation evidence |
| `agent-plugins:hook-creator` (fallback `hook-creator`) | Any Goose hook rule or command changes | Hook validation, executable checks, and blocking-behavior review |
| `agent-plugins:agent-creator` (fallback `agent-creator`) | Only for an explicit, separately supported custom-agent target | Valid agent and confirmed project/user installation path |
| `agent-plugins:plugin-script-packaging` (fallback `plugin-script-packaging`) | A plugin command needs a contained source runtime, a native release projection, or both | Command contract, dual-layout design, dependency closure, and mode-specific verification evidence |

Current Goose custom agents live under `.agents/agents/`; do not claim a plugin `agents/` directory is portable or auto-installed. Load specialist instructions in the current context when possible. Delegate only disjoint files. If a specialist is unavailable, state the limitation and follow its recorded source rather than inventing a schema.

## Request modes

- **Portable-load audit:** report what a conformant 1.0.0 loader accepts, ignores, or isolates. This is not authoring approval.
- **Strict authoring:** apply schema, semantic, Goose operational, safety, and migration checks. This is the default.
- **Package-only:** run strict validation, create the archive, and verify identity; do not force behavioral evaluation.
- **Whole-plugin evaluation:** evaluate changed components and integration behavior, then aggregate, review, and gate release.
- **Release:** require strict authoring plus applicable tests, receipts, archive checks, and human review.

## Workflow

1. Derive behavior from concrete inputs, outputs, side effects, tools, credentials, and target hosts. Do not repeat questions answered by context.
2. Classify the package as skills-only, MCP, Goose-extension, hybrid, or ported.
3. Inventory portable components separately from Goose-specific and legacy inputs.
4. Route each changed Skill or hook to its specialist before authoring it. For evaluation, do not stop after describing that route: execute or consume the specialist's complete paired evidence and receipt before declaring the plugin evaluation complete.
5. For a new package run:

   ```bash
   plugin-creator init <plugin-directory>
   ```

6. Keep only required resources: root `plugin.json`; `skills/<name>/SKILL.md`; root `mcp.json`; and, only when needed, `extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json` plus command scripts.
7. Document runtime prerequisites and credentials, but never package secrets.
8. For ports, classify each item as `portable`, `adapt`, `replace`, or `unsupported`. Preserve behavior before deleting source metadata.
9. Run both profiles:

   ```bash
   plugin-creator validate <plugin-directory> --mode portable-load --format json
   plugin-creator validate <plugin-directory> --mode strict-authoring --format json
   ```

10. Run specialist validation for changed Skills and hooks. Check paths, environment declarations, `${PLUGIN_ROOT}` references, and executable scripts.
11. Package when requested:

   ```bash
   plugin-creator package <plugin-directory> [output.zip]
   ```

12. Deliver the artifact, architecture, prerequisites, both validation results, migration notes, and install command.

## Portable MCP rules

For the portable artifact, use only root `mcp.json`, with the canonical 1.0.0 MCP schema and an `mcpServers` object. Portable entries use the schema's closed `stdio`, `streamable-http`, or `sse` variants. Keep paths contained and do not package credentials in `env` or `headers`.

For current Goose host execution, the default filename is root `.mcp.json`; root `mcp.json` is not auto-discovered. `plugin.json.mcpServers` may instead be inline or a path declaration. An explicit `./mcp.json` selection can load a portable stdio-only document: Goose serde ignores unknown fields such as server `type` and top-level `$schema`, while `command` remains required. Portable `streamable-http` and `sse` entries therefore fail this loader because they omit `command` and Goose has no remote transport mapping—not because `type` or `$schema` is present.

When `.mcp.json` or inline/path-based `plugin.json.mcpServers` exists:

1. identify it as Goose host configuration rather than the portable artifact;
2. permit one canonical `mcp.json` to serve both contracts only when Goose explicitly selects it and every selected entry is stdio with `command`;
3. permit a separate `.mcp.json` compatibility artifact to coexist with portable `mcp.json` only when Goose has one governed activation path: its default `.mcp.json`, or an approved `exclusive: true` path;
4. block ambiguous duplicate activation, including a non-exclusive `./mcp.json` selection beside `.mcp.json`, rather than unconditionally blocking co-shipping;
5. propose portable migration only when it maps safely to closed portable variants and require approval before changing the selected path.

## Goose hook rules

Hooks are client behavior, not portable core. New output uses:

```json
{
  "extensions": {
    "io.github.bioinfornatics.agent-plugins.goose": {
      "version": 1,
      "hooks": "extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json"
    }
  }
}
```

This namespace is the distribution's Goose adapter contract, not an upstream-ratified identifier. Validate hooks against the selected Goose source. Use `${PLUGIN_ROOT}` in package-relative command paths. Treat commands as executable code; review blocking events and fail closed on unsupported semantics. Root `hooks/hooks.json` is an input-only migration alias. If both forms exist, stop as ambiguous.

## Behavioral Evaluation Contract

When asked to evaluate, test, benchmark, compare, or prove improvement, execute the official workflow. Freeze baseline provenance and fixtures. Require a complete evaluation receipt for each behaviorally changed Skill and plugin-level integration scenarios. Aggregate the resulting evidence into a combined benchmark and generate a review viewer. Require:

1. paired `with_skill` and `old_skill`/`without_skill` outputs;
2. `grading.json` with `text`, `passed`, and `evidence` for every run;
3. `timing.json`, using null plus a reason when unavailable;
4. typed Skill, agent, hook, and MCP receipts with applicability, current component hashes, and explicit per-component aggregation (see [Typed Component Evidence](references/component-evidence.md));
5. plugin integration scenarios with complete component coverage and evidenced cross-component handoffs;
6. official `benchmark.json` and `benchmark.md`;
7. live or static review output;
8. a final receipt with artifact hashes and human-review status.

Never grade hidden deliverables; add criteria to the next iteration and rerun both variants. If a capability is missing, preserve artifacts and report `evaluation: blocked`. Never substitute an ad-hoc two-agent comparison.

Start with:

```bash
plugin-creator full-eval <plugin-directory> --workspace <plugin-directory>/evaluations/full-eval --dry-run --format json
```

For unattended clean-checkout runs, use the config-driven `ci-eval` contract in [non-interactive CI evaluation](references/ci-evaluation.md). Follow returned commands and receipt paths, then rerun with `--resume`. Before a release claim, run `plugin-creator verify ...` with workflow-provided arguments. Ordered `next_actions` in a blocked result are authoritative. Non-dry runs append a sanitized durable history to `full-eval-events.jsonl`. Use `--progress quiet|normal|verbose` for terminal detail, or `--format jsonl|ci|review` for pure machine records, CI groups, or accessible historical replay; see [the event stream contract](references/execution-event-stream.md) and [execution reliability contract](references/execution-reliability.md).

## Independent challenge review

For independent builder/challenger review, use the local matrix runner documented in [independent-review.md](references/independent-review.md). Freeze approved context and criteria, expose only public branch output to the verifier, preserve raw provenance, and do not auto-resolve convergence findings.

## Quality bar

A deliverable is ready only when the 1.0.0 manifest is valid; portable components use fixed locations; Skills are useful and valid; referenced files exist and remain contained; Goose behavior is namespaced and host-validated; legacy conflicts are resolved; prerequisites are documented; no secrets are packaged; strict validation succeeds; and requested evaluation, packaging, and release gates pass.

## Golden end-to-end acceptance

For offline factory acceptance from a natural-language idea, run `plugin-creator golden-e2e`. Prefer novice defaults unless bounded expert overrides are requested. The deterministic adapter executes local generation, shipped validators, and fixture assertions (`executed: true`) but explicitly records that no LLM ran (`llm_executed: false`). Verify archive provenance and record-derived metrics. Passing thresholds still leaves production approval pending and must never activate an artifact. See [Golden end-to-end journeys](references/golden-e2e-journeys.md).

## Decision-comprehension research

When testing whether developers and nonexperts understand validation, evaluation, blocked, and approval-required reports, use the offline `decision-research` analyzer. Enforce anonymous consented sessions, neutral facilitation, retention limits, both cohorts, all three tasks, and the blocking thresholds. Never treat synthetic fixtures as evidence. See [Decision-comprehension research kit](references/decision-comprehension-research.md).

## Utilities

- `plugin-creator`: unified `init`, `validate`, `verify`, `package`, `full-eval`, `independent-review`, and `decision-research` interface.
- `references/goose-plugin-format.md`: layouts, schemas, Goose namespace, and migrations.
- `references/portable-conformance.md`: load, authoring, and release semantics.
- `references/goose-hooks.md`: recorded Goose hook behavior.
- `evals/evals.json` and `assets/evaluation-fixtures/`: official scenarios and fixtures.
