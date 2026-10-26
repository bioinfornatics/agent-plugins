---
name: skill-creator
description: Creates, audits and improves one Agent Skill. Use when authoring or reviewing SKILL.md, tuning activation, evaluating behavior, or preparing standalone Skill packaging.
---

# Skill Creator

Create and improve portable Agent Skills. Execute the ordered workflow for the requested responsibility only; conditional substeps are not permission to expand the task.

## Ordered workflow

1. **Confirm scope, authority and capabilities.** Identify the target Skill, requested outcome and preserved user work before mutation. Use this creator for one standalone or bundled Skill. Route whole-plugin work to agent-plugins:plugin-creator, hooks to agent-plugins:hook-creator, and custom agents to agent-plugins:agent-creator. Plugin integration and installation remain separate responsibilities. Use AGENTS.md exclusively for repository instructions.
   - Verify filesystem, tools, credentials and runtime before using them. A copied source Skill uses Node.js 22+ and its contained runtime through node scripts/skill-creator.mjs; native archives use the released executable. Missing runtime/mapping is a packaging defect, not permission to install dependencies.
   - If the repository uses durable tracking, follow its applicable rules before choosing work or changing issue state. Check permissions before consequential actions; selection, evaluation completion and task closure do not grant publication authority.
   - Reuse loaded unchanged guidance after checking applicability and freshness. Missing capabilities remain explicit: unsupported runners fail, sequential cases disclose reduced independence, and static HTML does not establish browser behavior.

2. **Clarify an early idea only when needed.** Before eliciting or generating from an early idea, read [idea-to-candidate guidance](references/idea-to-candidate.md). Use a summary-first conversation, at most three questions per turn; preview the contract and confirm scenarios before launch inside its durable workspace.
   - Novices see plain language rather than JSON or internal creator names; experts may inspect supported fields. Reject unsupported budgets. The fake adapter reports simulated generation and not-run validation/evaluation. Mutation stays isolated; promotion is separate.
   - For a confirmed request, continue directly to its applicable action below rather than repeating elicitation.

3. **Design the requested change or inspect existing quality.** Load applicable guidance here before its action, not all branches in advance.
   - Before creation or structural improvement, read the [pattern catalog](references/skill-authoring-best-practices.md). Decide relevance, reason and application site; challenge the section layout instead of merely harmonizing it. Select the smallest sufficient correction, not every pattern.
   - Before creating or materially redesigning, read [authoring guidance](references/authoring.md) and [prompt engineering](references/prompt-engineering.md). Before rule-rich coverage design, read [domain coverage](references/domain-coverage.md) when correctness depends on substantial deterministic rules; deliver breadth-first rather than automating one illustrative rule.
   - Before auditing an existing Skill, read [audit guidance](references/audit.md). Audit without silently changing behavior.
   - Before editing discovery metadata, read [description optimization](references/description-optimization.md). Metadata is English, third person and concise: responsibility plus activation context, not procedures or obligation lists. Selection is not execution authority.
   - Before revising from real usage or evaluation findings, read [evidence-driven improvement](references/improvement.md). Classify the failure, preserve working behavior and use approval-gated isolated revisions where required.
   - Write all metadata and instructions in English. Keep SKILL.md at most 500 lines; directly link each reference once at the step requiring it, with its condition and reading deadline. Add Contents to references over 300 lines.
   - Organize instructions temporally: operational safeguards before governed actions; specialized procedures at the relevant branch; output-only contracts after investigation, immediately before writing. Split mixed-purpose references when deadlines differ; never defer safeguards because of a filename.
   - Use one numbered progression from investigation through verification, reporting, handoff and stop. Put conditions and legitimate parallel work in sublists; do not duplicate the workflow in a second delivery checklist. Preserve permissions, evidence, blocking and bounded-scope stop rules when merging sections.

4. **Design and execute only the requested evaluation or study.** Before creating/changing scenarios, read [evaluation design](references/evaluation-design.md). Freeze realistic cases and atomic assertions with the baseline before execution.
   - Before reading/writing machine evaluation artifacts, read [schemas](references/schemas.md).
   - Before freezing task formats or requesting grading, read the operational sections of the [evaluation output contract](references/evaluation-output-contract.md). Task artifacts, grader responses and campaign receipts are distinct; this mixed reference must not be deferred entirely to reporting. Its human-report section applies at step 7.
   - Before testing activation, read [trigger evaluation](references/trigger-evaluation.md). For current-session orchestration, use `run-evaluation --skill-path <dir>` with an Anthropic-compatible `eval.json`; delegate only pending queries, keep `should_trigger` private, and import actual host observations. The command never launches a model. Use step 3 for description changes.
   - Before behavioral evaluation/comparison, read [evaluation workflow](references/evaluation-workflow.md). When asked to test, benchmark, compare or prove improvement, execute rather than merely plan, within capabilities and permission. Use equivalent paired runs, grade every output with an independent blinded grader batching semantic criteria, aggregate, generate the viewer, validate completeness and analyze failures. Additional graders are optional for ambiguity/higher stakes; disagreements remain inconclusive.
   - For current-session behavioral runs, use `run-evaluation --mode behavioral --skill-path <dir>` with Anthropic `evals/evals.json`. The session delegates paired candidates and independent blinded graders, records canonical task/grading/timing files, then resumes the command for aggregation and static review. `prepare-execution` is optional advanced preparation, not required for either simple contract.
   - When an advanced `full-eval` run reports awaiting-grading, read [delegated grading](references/delegated-grading-workflow.md) before its import commands. For simple `run-evaluation --mode behavioral`, delegate only each `grading_requests[].request_path` packet, collect judgments, then use `--grading-results <file>` on resume. Never send coordinator status or variant paths to graders, and never substitute self-grading.
   - Before preparing/analyzing governed intake sessions, read [usability study guidance](references/usability-study-kit.md). Before manual screen-reader acceptance, read [screen-reader guidance](references/screen-reader-acceptance-kit.md); synthetic records are not acceptance evidence.

5. **Verify actual work and delegated results.** Inspect target artifacts and actual command results, not completion claims. For authored Skills, verify concise discovery metadata, step-local reference deadlines and one responsibility-specific ordered workflow. Run applicable validation/audit and scenario checks; fix within scope or retain findings as unresolved.
   - When evaluation was requested, preserve completed artifacts and resume at the first incomplete phase. Simple modes return `review` even while data are unavailable: open and inspect the HTML, report missing observations/grades/telemetry, and do not claim acceptance from report completion. Native activation needs actual load-tool telemetry; if delegation exposes no such events, record unsupported-telemetry. Native token usage may be unavailable: never estimate it. Full-eval uses the evaluation profile for routine fast/standard iteration; inspect receipt completeness and analyze the workspace before reporting. Complete is not pass or release acceptance.
   - When work was delegated, inspect returned artifacts and raw evidence against assigned scope. Missing/failed returns are unresolved, not approval. Parallel work requires disjoint write ownership and a verification join before dependent steps.
   - Only for a requested packaging/release decision, read [packaging guidance](references/packaging-and-release.md) and [verification gates](references/verification-gates.md) before assessing or packaging. Use the release profile and keep separate publication authority; human review is never self-approved.

6. **Resolve the delivery boundary.** Keep missing evidence, permissions, capabilities and untested claims visible. Identify the smallest immediate next action; preserve the first incomplete step and needed restart context. Hand off only when scope and authority cover it; otherwise stop after reporting. Do not execute unrelated responsibilities just because their substeps exist.

7. **Read output-only guidance, report, and stop.** After investigation and verification, immediately before writing, read the applicable report/template sections. For evaluation reporting, use the human-report section of the contract linked in step 4; reuse unchanged content already loaded. Apply this step even for blocked or no-change work.
   - Report actual scope, artifacts, results, limitations and next action in the user's language. Distinguish static conformance, artifact completeness, behavior and release acceptance; preserve pass, fail, blocked, complete and na without weakening them. Do not fabricate provider usage, evidence or approval.
   - Deliver the requested handoff if authorized, then stop at the agreed boundary.

## Command lookup

Consult only commands needed by the current step. Use --help for details. JSON automation uses stable envelopes; exit codes are 0 success, 1 failure, 2 invalid usage and 3 blocked execution.

```bash
# Agent Skills format conformance
skill-creator validate <skill-directory>

# Authoring quality and pattern relevance
skill-creator audit <skill-directory> --format json

# Scenario quality and normalized eval set
skill-creator design-evals <evals.json> --skill-path <skill-directory> --format json

# Derive elicitation shells, then freeze a provenance-bound scenario plan
skill-creator freeze-evals <elicitation.json> --draft -o <draft.json>
skill-creator freeze-evals <completed-draft.json> -o <frozen-plan.json>

# Current-session activation evaluation (no model launch)
skill-creator run-evaluation --skill-path <skill-directory> --format json
skill-creator run-evaluation --skill-path <skill-directory> --output <run-directory> --resume --observations <observations.json> --format json

# Optional subprocess trigger-description evaluation
skill-creator trigger-eval --eval-set <trigger-eval.json> --skill-path <skill-directory>

# Current-session Anthropic behavioral evaluation (no model launch)
skill-creator run-evaluation --mode behavioral --skill-path <skill-directory> --format json
skill-creator run-evaluation --mode behavioral --skill-path <skill-directory> --output <iteration-directory> --resume --format json

# Optional advanced resumable paired behavioral evaluation
skill-creator full-eval <skill-directory> --workspace <iteration-directory> --format json

# Map evaluation failures to authoring patterns
skill-creator analyze <iteration-directory> --skill-path <skill-directory> --format json

# Govern evidence-linked, challenged, approval-gated isolated revisions
skill-creator evidence-loop <iteration-directory> --skill-path <skill-directory> --loop <separate-ledger> --format json

# Governed anonymous usability study validation and analysis
skill-creator usability-study --validate <session.json> --format json
skill-creator usability-study <sessions-directory> --format json

# Manual screen-reader acceptance (protocol and real records; synthetic data is non-evidence)
skill-creator screen-reader-acceptance --validate <record.json> --format json
skill-creator screen-reader-acceptance <records-directory> --format json

# Release gates and packaging
skill-creator verify <skill-directory> [options]
skill-creator package <skill-directory> [output-directory]
```
