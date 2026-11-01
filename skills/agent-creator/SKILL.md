---
name: agent-creator
description: Creates and manages Goose custom agent definitions for reusable roles and delegated personas, including reviewers, writers, planners, and specialists. Use when the request concerns a custom agent, persona, subagent, delegation role, or .agents/agents; exclude Skills, hooks, and plugin packaging.
---

# Agent Creator

Prefer native `agent-creator` commands. For a source copy use Node.js 22+ with `node <skill-root>/scripts/agent-creator.mjs`; native archives use the released executable. Report a missing contained runtime/mapping as a packaging defect. Use `--help` only for needed command syntax; do not invoke internal dist APIs.

## Route only the requested work

On Goose, load an available specialist with `load_skill(name: "agent-plugins:skill-creator")` for Skill authoring, audit, improvement or evaluation. For a standalone installation, use `load_skill(name: "skill-creator")` only if available. Apply the same installed-name rule to other specialists below. These are host tool calls, not shell commands or portable metadata. Reuse available guidance; never reload this Skill recursively. On other hosts use a verified loading mechanism. If loading is unavailable, read available instructions directly and disclose that limitation; if instructions or execution capability are missing, report the affected blocker. Never guess a tool or force candidate activation in natural-activation tests.

Use this Skill for reusable roles, expertise, behavior and optional model preference. Route whole-plugin/MCP declaration, transport, environment or migration to `agent-plugins:plugin-creator`; repeatable steps, extension selection, parameters or scheduling to verified recipe tooling. Do not persist an agent for one ad-hoc delegated task unless requested.

## Select and execute

| Request | Next action | Stop condition |
|---|---|---|
| Create/modify agent | Read [custom-agent source](references/custom-agents.md); write the requested role and validate | Deliver agent, validation and usage; offer evaluation without running it |
| Validate/audit | Run `agent-creator validate <agent.md>`; inspect requested policy boundaries | Report findings; do not author or install first |
| Evaluate/compare | Execute paired evaluation below with supplied frozen tasks | Deliver graded benchmark and traceable conclusion |
| Install | Validate; use `agent-creator install <agent.md> --project <root>` or `--global` only when requested | Report location and observed discovery, or untested discovery |
| Migrate | Read custom-agent source; map only supported role metadata | Preserve original unless removal authorized; report unmapped configuration |

## Authoring and installation guards

- Create project `<project>/.agents/agents/<name>.md` or explicitly requested user `~/.agents/agents/<name>.md`. Keep generated definitions in `.agents/agents`, not Skills, plugins or recipes.
- Support only `name` (required), `description` and `model` (optional strings). Use a meaningful role-focused body: objective, priorities, boundaries, evidence and useful output conventions. Keep task-specific inputs and full workflows out; do not duplicate AGENTS.md or Skill content.
- Never add MCP/tool/permission/extension/hook fields or `mcp.json`/`.mcp.json` to an agent directory. Session-enabled MCP can be used but is not declared by the agent file.
- Validate YAML, unique non-empty name, `.md` extension, optional string types, non-empty body and absence of placeholders/unsupported keys. Closed-field, kebab-case and length checks are creator policy, not proof Goose rejects every violation.
- Refuse overwrites unless explicitly requested with `--force`. Test discovery in a new Goose session when feasible; loading adds context, delegation executes in isolation. Do not claim discovery from validation.
- For explicit bundled-agent requests, route to plugin-creator and require verified host/format installation support before generating a bundled component. Recorded Goose discovers project/user/compatibility paths, not plugin `agents/`; normal agent work needs no plugin scaffold.
- Before changing the public format contract, compare the vendored source with current Goose documentation/implementation; follow [snapshot refresh](references/UPSTREAM.md). Do not guess unsupported fields.

## Paired agent evaluation

1. Use supplied tasks or author only requested missing cases. Freeze autonomous tasks, explain/execute level, immutable fixture paths/preconditions, assertions, current/baseline provenance, model/tools and budget. Copy fixtures to isolated temporary projects; keep both arms' inputs/controller/environment equivalent and allow enough execution budget.
2. Run `agent-creator evaluate --agent <agent.md> --eval-set <evals.json> --workspace <workspace>/iteration-1`. Default arms are `with_agent` and `without_agent_instructions`; use `--baseline-agent <old.md>` for improvement comparisons. Compare delegated executions, not parent-context loading or Skill triggers.
3. Classify/version assertions before launch: `id`, positive `version`, deterministic/semantic `classification`, `criterion`; deterministic checks use supported contains/not-contains/regex checkers. Keep criteria out of candidate prompts; graders cannot add hidden deliverables.
4. Grade every run. For semantic assertions the runtime requires at least two independently identified blinded graders per assertion: `agent-creator grade <workspace>/iteration-1 --llm-grader --grader reviewer-a=model-a --grader reviewer-b=model-b --max-grader-calls <authorized-bound>`. Budget criteria × variants/runs × graders plus authorized retries. Give graders only published criteria and opaque variants, not identities or other grades; missing/invalid grades or disagreement remain inconclusive for human review.
5. Run `agent-creator aggregate <workspace>/iteration-1 --agent-name <name> --agent-path <agent.md>`. Inspect benchmark JSON/Markdown and response artifacts directly; the source-only viewer helper is not a released CLI. Return a review artifact and traceable conclusion, with timing/tokens/variance when observed, not invented telemetry.
6. Revise only when requested and within repair bounds; freeze new criteria in the next iteration and rerun both arms. Stop at satisfaction, discriminating improvement, no progress or budget bound. One paired observation is not reliability proof.

Apply [privacy/retention](references/privacy-retention.md) before transcript capture or deletion; aggregate evidence may outlive transcripts. For external evidence use [manual evidence](references/manual-external-evidence.md). Preserve failures and provenance.

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
