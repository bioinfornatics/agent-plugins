---
name: plugin-creator
description: Orchestrates complete Open Plugin packages. Use when plugin.json or the whole plugin is the target for creation, validation, migration, evaluation, packaging, or release.
---

# Plugin Creator

Scope generated packages to plugins installed under `.agents/plugins`; do not generate standalone Skill/agent assets. Own complete package architecture, `plugin.json`, MCP/Goose integration, validation and requested packaging/release. Route component content; do not replay unrelated phases.

Prefer native `plugin-creator` commands. For a source copy use Node.js 22+ with `node <skill-root>/scripts/plugin-creator.mjs`; native archives use the released executable. Report missing contained runtime/mapping as a packaging defect.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement or evaluation. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

| Requested component | Specialist | Required handoff |
|---|---|---|
| Skill authoring/audit/improvement/evaluation | `agent-plugins:skill-creator` | Scoped validation or requested paired evidence |
| Hook rule/handler | `agent-plugins:hook-creator` | Validated component, executable and blocking-safety evidence |
| Explicit separately supported custom agent | `agent-plugins:agent-creator` | Valid role and verified project/user installation scope |
| Executable/runtime/native packaging | `agent-plugins:plugin-script-packaging` | Command contract, contained dependency closure, mode-specific proof |

Delegate only disjoint files. Do not claim plugin `agents/` is portable or auto-installed by Goose; custom agents use `.agents/agents`. Missing specialists do not authorize guessed schemas or simulated handoffs.

## Select and execute

| Request | Native next action | Stop condition |
|---|---|---|
| Create | Read format baseline; `plugin-creator init <dir>`; route only required components | Validate and deliver scoped package |
| Modify/migrate | Read applicable format/host contract; classify inputs portable/adapt/replace/unsupported | Preserve originals unless deletion authorized; report unmapped items |
| Portable-load audit | `plugin-creator validate <dir> --mode portable-load --format json` | Report accepted/ignored/isolated inputs, not authoring approval |
| Strict validation | `plugin-creator validate <dir> --mode strict-authoring --format json` | Report findings; do not author or evaluate first |
| Package only | Strict validation; `plugin-creator package <dir> [output.zip]`; verify archive identity | Deliver archive without forced behavioral campaign |
| Whole-plugin evaluation | Execute native full-eval branch below | Deliver complete receipts/review or explicit blocked result |
| Installation diagnostics | Read [installation diagnostics](references/installation-diagnostics.md); use read-only doctor for the selected installation | Separate integrity from validation, authenticity and behavior; native checks remain incomplete |
| Release | Apply strict validation and workflow verification, tests, receipts, archive checks and human review | Publish only with separate current authority |

## Format and host guards

Before changing a package contract, read [Goose plugin format](references/goose-plugin-format.md) and [portable conformance](references/portable-conformance.md).

- Emit published Agent Plugins **1.0.0** canonical schema identifiers, root `plugin.json`, optional `skills/` and root `mcp.json`. Treat 1.1.0 as inactive Working Draft, not supported by similarity.
- Keep only required resources; never package secrets. Document prerequisites/credentials without their values. Keep references and `${PLUGIN_ROOT}` paths contained and scripts executable.
- For newly authored/migrated packages run portable-load and strict-authoring profiles; report them separately. Run relevant specialist checks for changed components, not an unrelated readiness audit.
- For portable MCP use canonical root `mcp.json`, `mcpServers`, and closed stdio/streamable-http/sse variants; do not package env/header secrets.
- For Goose MCP distinguish host configuration: default root `.mcp.json` or inline/path `plugin.json.mcpServers`. Root `mcp.json` is not auto-discovered. Explicit `./mcp.json` works only for selected stdio entries with `command`; unknown `type`/`$schema` fields are ignored, but remote entries lack required `command` and transport mapping.
- Allow co-shipped portable/Goose documents only with one governed activation path: default `.mcp.json` or approved `exclusive: true` path. Block ambiguous duplication, including non-exclusive `./mcp.json` beside `.mcp.json`. Obtain approval before changing selected paths; migrate only safely mapped closed variants.
- For hooks read [Goose target compatibility](references/goose-target-compatibility.md). Keep native `hooks/hooks.json`, not distributor namespaces. v1.47.0 rejects PreToolUseResult; main-2b17adc accepts observation only. Source profiles do not identify the running binary.
- Treat adapter structural checks as activation warnings, not host proof. Fail closed on multiple hook layouts; preserve native hooks and block adapter-only migration without reviewed activation evidence. Review blocking and command side effects separately.

## Whole-plugin evaluation

1. Use supplied frozen scope/baseline/fixtures; do not author, audit or redesign before evaluation. Start `plugin-creator full-eval <dir> --workspace <dir>/evaluations/full-eval --dry-run --format json`. For unattended runs read [CI evaluation](references/ci-evaluation.md); use `ci-eval`, not a custom harness.
2. Follow returned commands, receipt paths and ordered `next_actions`; resume with `--resume`. Route changed components to their specialists and execute/consume complete paired evidence, not a routing explanation. Apply [typed component evidence](references/component-evidence.md) when assembling receipts.
3. Require paired with-skill and old/without outputs; every run's grading text/pass/evidence and timing (null with reason when unavailable); typed Skill/agent/hook/MCP receipts with applicability, current hashes and per-component aggregation; distinct integration scenarios with component coverage and observed handoffs; benchmark JSON/Markdown; live/static review; final hashed receipt and human-review status.
4. Reuse unchanged complete receipts only with current matching hashes/bindings/protocol; mark stale/uncovered components. Do not repeat every component assertion in integration scenarios; representative journeys must satisfy typed coverage and handoff obligations.
5. Never add hidden grading deliverables or substitute an ad-hoc two-agent comparison. Missing capability means `evaluation: blocked`; preserve artifacts. New criteria belong to the next frozen iteration with both variants rerun.
6. Non-dry runs append sanitized `full-eval-events.jsonl`. For requested progress/replay use supported progress/format options; read [event stream](references/execution-event-stream.md) and [execution reliability](references/execution-reliability.md) only at that action.
7. Before claiming release readiness, run `plugin-creator verify` with workflow-provided arguments. Validation, behavioral evidence and approval are separate; no static success activates or authorizes publication.

## Other explicitly requested workflows

- Independent builder/challenger review: read [independent review](references/independent-review.md); freeze approved context/criteria, expose public output only, preserve provenance and unresolved findings.
- Offline idea-to-package factory acceptance: read [golden journeys](references/golden-e2e-journeys.md); run `plugin-creator golden-e2e`. Verify archive provenance/record-derived metrics. Report deterministic `executed: true` separately from `llm_executed: false`; passing is not production approval.
- Decision-comprehension study: read [research kit](references/decision-comprehension-research.md); use `decision-research`. Require consented anonymous sessions, neutral facilitation, retention limits, both cohorts, all three tasks and blocking thresholds; synthetic fixtures are not research evidence.

## Paid evaluation gate

- Evaluate only on request or under an approved acceptance protocol. Before launch, freeze source/baseline, fixtures, criteria and permitted actions; state the decision, distinct risks, expected outcomes, cheapest valid oracles, total candidate/grader calls (including repetitions, criterion-level grading and repairs), time/cost bound and stopping rule. Disclose unknown prices; obtain authority for paid execution and expansions.
- Cover required safety checks; add cases/repetitions/graders only for uncovered risk or decision-changing uncertainty, not a count target or Cartesian campaign. Prefer deterministic checks for deterministic properties and independent blinded grading for contextual quality. Reject plausible wrong outcomes, mock echoes, self-reported success and circular calculations; do not let a conditional assertion accept both outcomes under the same preconditions.
- Reuse evidence only with matching source, fixtures, protocol and bindings; re-render report corrections without rerunning candidates. Preserve failures, missingness and disagreement; at the bound report blocked/inconclusive, not automatic escalation. A small set is not reliability proof.

## Execution limits

- Execute the requested branch with supplied context; ask only for a decision blocking its next action. Continue unaffected authorized work.
- Follow repository instructions, Beads policy and current authority. Preserve existing edits, fixtures and evidence. Authoring does not authorize installation, credential changes, publication or paid campaigns.
- Run the native command first; do not add readiness audits, generic diagnostics, custom harnesses or recursive reference loading. Read linked detail only at its applicable action; reuse available guidance.
- On an actual error, apply one concrete authorized correction and retry once, or report the exact blocker and stop. Do not weaken criteria or silently expand scope/budget.
- Report files, commands, observed outcomes, missing evidence and next action; stop at the requested deliverable. Static conformance is not behavioral effectiveness or host compatibility.
