---
name: agent-creator
description: Creates and manages Goose custom agent definitions for reusable roles and delegated personas, including reviewers, writers, planners, and specialists. Use when the request concerns a custom agent, persona, subagent, delegation role, or .agents/agents; exclude Skills, hooks, and plugin packaging.
---

# Agent Creator

## Evaluation value and cost boundary

- Evaluate only when requested or required by an approved acceptance protocol; authoring or packaging alone does not authorize a model campaign. Use the smallest set covering distinct plausible failures, user journeys and safety boundaries, not a scenario-count target.
- Before expensive execution, state the decision to inform, each scenario's distinct risk, observable expected outcome and cheapest valid oracle. An assertion must reject a plausible wrong result, not merely echo a mock, accept self-reported success, check file existence or reproduce the candidate's own calculation. Review conditional assertions that accept both success and failure; define the expected outcome for the declared preconditions.
- Declare the total candidate and grader call bound, time/cost budget and stopping rule before launch. Account for scenarios, variants, repetitions, graders, criterion-level calls and repair iterations; label unknown prices as unknown, never free. Use existing supported options or compact planning notes, not invented schema fields. User authorization must cover paid execution and any budget expansion.
- Add a scenario only for uncovered risk or a meaningful interaction. Add repetitions or graders only for a named uncertainty that can change the decision, with marginal calls/cost and a bound. A budget ceiling is not a spending target; no Cartesian campaign or per-component multiplication by default. Required samples and safety checks in an approved protocol remain required; a small set is not reliability proof.
- Prefer deterministic artifact checks for deterministic properties and blinded semantic grading for contextual quality. Reuse compatible frozen evidence only when source, fixtures, protocol and required bindings still match. Report corrections re-render evidence; they do not rerun candidates. Preserve failures and missingness; never retry or rewrite criteria until green. At the bound, report inconclusive or blocked and the next decision, not automatic escalation.

## Offline runtime

Use `node scripts/agent-creator.mjs` for a copied source Skill; it requires Node.js 22+ and resolves only this Skill’s generated runtime. Tagged native archives use the released executable and do not require Node.js. Report a missing runtime or mapping as a packaging defect.

## Scope boundary

Do not confuse these concepts:

- **Custom agent**: reusable role, behavior, expertise, and optional model preference.
- **Skill**: reusable procedural or domain knowledge loaded on demand; use the skill creator.
- **Plugin**: package containing components such as skills, hooks, or MCP declarations; use the plugin creator.
- **Recipe**: repeatable workflow with prompts, settings, parameters, extensions, or scheduling.
- **Ad-hoc subagent**: one isolated delegated task that does not need a persistent agent file.

A custom agent does not define extensions, MCP servers, scheduled jobs, recipe parameters, or a multi-step orchestration graph. Never add `mcpServers`, `mcp`, or `extensions` to agent frontmatter, and never put `mcp.json` or `.mcp.json` in an agent directory. Agents may use MCP extensions already enabled for their session; that availability is not declared by the agent file. Route MCP declaration, transport, environment, packaging, or migration work to `agent-plugins:plugin-creator` (fallback: standalone `plugin-creator`). Use recipe tooling when a repeatable workflow must select or enable a known extension set.

## Plugin Dependency

`agent-creator` works standalone for its normal case: an agent under `.agents/agents/` (project) or `~/.agents/agents/` (user). Current Goose custom agents are discovered from the documented project, user, and compatibility agent paths, not from inside a plugin. For the audited Goose revision, a plugin `agents/` marker does not install or auto-discover custom agents — most agent-only requests never need `plugin-creator` at all.

Depend on `agent-plugins:plugin-creator` (fallback: standalone `plugin-creator`) only when:

| When | Why | Success criteria before returning to plugin work |
|---|---|---|
| The user explicitly asks to bundle this agent definition as a plugin component | Bundled-agent support is host/format-specific and `plugin-creator` is the one that confirms the target format actually installs agents from inside a plugin — do not assume a plugin's `agents/` directory is auto-discovered | `plugin-creator` has confirmed the target host/format explicitly supports bundled agent components before this creator authors anything beyond a standard `.agents/agents/` file |
| The user asks to package or install the *whole plugin* the agent is part of | Manifest wiring, packaging, and installation are `plugin-creator`'s domain | Hand back an agent file that passes `validate_agent`; do not attempt plugin-level packaging here |

If `plugin-creator` is unavailable and one of these cases applies, state the limitation explicitly rather than guessing whether the target format supports bundled agents.

## Source of truth

Read `references/custom-agents.md` before creating or modifying an agent. It is a vendored snapshot of Goose's `guides/context-engineering/custom-agents` documentation and defines the supported format, paths, discovery behavior, and usage model.

When changing this creator, compare that reference with the current Goose documentation and implementation. Record the upstream revision or refresh date in `references/UPSTREAM.md` whenever the snapshot is updated.

## Unified CLI

Prefer the bundled **agent-creator** executable for automation. It provides init, validate, evaluate, grade, aggregate, install, and privacy commands. Legacy internal-script entrypoints are not part of the released interface. Common flags are --format text|json, --quiet, and --help; exit statuses are 0 success, 1 failure, 2 usage, and 3 blocked operation.

## Workflow

1. Determine the desired role from the request and existing context:
   - responsibilities and non-goals;
   - inputs and expected output style;
   - quality and safety constraints;
   - whether the role should be globally reusable or project-specific;
   - whether a model preference is genuinely needed.

2. Confirm that a custom agent is the right abstraction:
   - use an agent for role, expertise, behavior, tone, or delegated specialization;
   - use a skill for reusable procedures or knowledge;
   - use a recipe for repeatable steps, extensions, parameters, or scheduling;
   - use a plugin for packaged runtime components.

3. Inspect nearby agent definitions when adapting an existing repository. Preserve useful local conventions without introducing unsupported frontmatter. If MCP configuration is requested, stop agent authoring at this boundary and route it as described above; do not silently invent plugin configuration.

4. Create one Markdown file:
   - project: `<project>/.agents/agents/<name>.md`;
   - user: `~/.agents/agents/<name>.md`.

5. Use the supported frontmatter:

   ```markdown
   ---
   name: code-reviewer
   description: Reviews code for correctness, maintainability, and risk
   model: gpt-5.5
   ---

   You are a senior code reviewer...
   ```

   `name` is required. `description` and `model` are optional. The body should contain meaningful instructions.

6. Write the instructions:
   - state the role and objective first;
   - define priorities and decision criteria;
   - define important boundaries and escalation conditions;
   - specify the expected response structure only when useful;
   - keep task-specific input out of the reusable agent file;
   - avoid embedding workflows better represented as recipes;
   - do not claim unavailable tools, extensions, or permissions.

7. Validate with:

   ```bash
   agent-creator validate <path/to/agent.md>
   ```

8. When installing or copying an agent, use:

   ```bash
   agent-creator install <path/to/agent.md> --project <project-root>
   agent-creator install <path/to/agent.md> --global
   ```

   Refuse to overwrite an existing agent unless the user explicitly requests it and `--force` is provided.

9. Test discovery in a new Goose session when feasible. Ask Goose to list available sources or invoke the agent by name. Loading adds the instructions to the current context; delegation runs the agent in an isolated session.

10. For non-trivial agents, offer the evaluation loop in **Agent evaluation** below before declaring the agent ready.

11. Deliver the agent file, installation location, validation results, and a short usage example such as:

    ```text
    @code-reviewer review the current diff
    ```

## Request routing

- For creation or audit, use the creator validator before installation and report supported frontmatter explicitly. Its closed-field, kebab-case, length, non-empty-body, and unresolved-placeholder checks are strict authoring policy; Goose may deserialize some files more permissively, so do not misreport these policies as proof of upstream runtime rejection.
- For MCP requests, keep the agent file free of MCP fields and files, explain that session-enabled MCP remains usable, and route declaration/transport/environment/migration to `agent-plugins:plugin-creator`; route repeatable extension selection to recipe tooling.
- For evaluation or comparison, require paired current and baseline runs, grading for every run, aggregated benchmark JSON/Markdown, a review artifact, and a traceable conclusion. Static validation alone never proves behavioral improvement.

## Agent evaluation

Evaluate the custom agent as a reusable role, not as a skill trigger. The key question is whether delegating the same realistic task to the specialized agent produces better, more consistent results than a controlled baseline.

1. Select a compact set of risk-distinct realistic tasks covering the role's core responsibilities, boundaries, and likely failure modes. Ask the user to review them. Make each task autonomous: name the current and baseline agent files, declare whether it must explain or execute, list immutable fixture paths and preconditions, and give it enough turns and tools to finish. Freeze assertions before runs; graders must not add hidden deliverables afterward.
2. Save them in an eval JSON file:

   ```json
   {
     "agent_name": "code-reviewer",
     "evals": [
       {
         "id": 1,
         "name": "security-sensitive-review",
         "subject": "agent-behavioral-evaluation",
         "language": "en",
         "target": {
           "kind": "agent-pair",
           "execution": "execute",
           "current": "assets/evaluation-fixtures/role-comparison/current/security-reviewer.md",
           "baseline": "assets/evaluation-fixtures/role-comparison/baseline/security-reviewer.md"
         },
         "preconditions": [
           "Copy immutable fixtures into isolated temporary projects"
         ],
         "files": [
           "assets/evaluation-fixtures/role-comparison/current/security-reviewer.md",
           "assets/evaluation-fixtures/role-comparison/baseline/security-reviewer.md"
         ],
         "prompt": "Review this change and report correctness and security risks...",
         "assertions": [
           "Identifies the unsafe authorization bypass with specific evidence",
           "not-contains: looks good to me"
         ]
       }
     ]
   }
   ```

3. Run paired evaluations in isolated temporary projects:

   ```bash
   agent-creator evaluate \
     --agent <path/to/agent.md> \
     --eval-set <path/to/evals.json> \
     --workspace <agent-name>-workspace/iteration-1
   ```

   Each task runs twice in the same batch:
   - `with_agent`: the real custom-agent instructions;
   - `without_agent_instructions`: a neutral delegated baseline using the same model preference when possible.

   When improving an existing agent, pass `--baseline-agent <old-agent.md>` to compare against the old instructions instead.

4. Classify and version every assertion before running. Prefer objects with `id`, positive `version`, `classification` (`deterministic` or `semantic`), and `criterion`; deterministic assertions also declare a reproducible `checker` (`contains`, `not-contains`, or `regex`). Legacy prefixed strings remain supported. The current Agent Creator runtime requires at least two independently identified blinded graders per semantic assertion (unlike the output-batched Skill Creator path). Budget semantic assertions × declared variants/runs × graders before execution, plus any separately authorized retries; use the minimum supported grader count unless an additional grader answers a concrete uncertainty. Contained quotations support review but do not alone prove semantic correctness. Graders receive the published criterion and an opaque variant alias, never hidden criteria, true variant identity, or other grades. Disagreement or invalid/missing evidence remains inconclusive for human review; never average it into pass/fail:

   ```bash
   agent-creator grade \
     <workspace>/iteration-1 \
     --llm-grader \
     --grader reviewer-a=model-a \
     --grader reviewer-b=model-b \
     --max-grader-calls <authorized-call-bound>
   ```

5. Aggregate results:

   ```bash
   agent-creator aggregate \
     <workspace>/iteration-1 \
     --agent-name <name> \
     --agent-path <path/to/agent.md>
   ```

6. Review the generated evidence before revising the agent. The review-viewer helper is a source-only API and is not a released CLI; do not invoke an internal dist path. Use the benchmark and response artifacts directly in a release workflow.

7. Review qualitative output, assertion pass rates, time, token use, and variance. An agent may be better even when it costs more, but the trade-off must be visible.
8. Revise durable role instructions rather than overfitting to test prompts. Repeat in `iteration-2`, passing `--previous-workspace` to the viewer.
9. Stop when the user is satisfied, the specialized agent consistently beats the baseline on discriminating criteria, or further changes no longer improve the role.

### Evaluation principles

- Keep the controller and execution environment the same across paired runs.
- Compare isolated delegated executions; do not evaluate by merely loading instructions into the parent context.
- Use the same task inputs and assertions for specialized and baseline runs.
- Prefer deterministic checks for factual or structural requirements and human review for judgment quality.
- Test non-goals and restraint, not only successful task completion.
- Preserve timing so regressions can be explained; retain transcripts only under the explicit privacy policy because aggregate evidence can outlive transcript content.
- Treat the neutral baseline as a control, not as a claim that Goose has no general capabilities.
- Freeze current/baseline provenance, model, tools, inputs, and budget before paired runs.
- Copy declared fixtures into each isolated project; do not mutate packaged fixture sources.
- Match assertions to the declared execution level: explanation is not execution, and execution scenarios must receive enough budget to complete.
- Do not introduce hidden grading criteria. Add newly discovered criteria to the next iteration and rerun both configurations.

## Writing guidance

Prefer concise, durable instructions over a giant prompt. Explain why constraints matter. Make the description distinctive enough that Goose can identify when the role is appropriate.

A strong agent body usually covers:

1. role and objective;
2. priorities;
3. operating boundaries;
4. evidence or verification expectations;
5. output conventions.

Do not duplicate generic system behavior, repository instructions already supplied through `AGENTS.md`, or full skill content. Agents can use skills discoverable in their session.

## Migration guidance

When migrating from a legacy host-specific agent directory:

- place new shared definitions in `.agents/agents/`;
- preserve the semantic role and instructions;
- retain only `name`, `description`, and `model` frontmatter supported by Goose;
- move tool lists, permissions, hooks, MCP declarations, or workflow configuration to the appropriate Goose abstraction;
- preserve the original source unless the user explicitly requests removal;
- report anything that could not be mapped safely.

## Quality gate

An agent is ready only when:

- frontmatter is valid YAML;
- `name` is present, non-empty, and unique in the intended scope;
- the file uses a `.md` extension;
- `description` and `model`, when present, are strings;
- no unsupported frontmatter keys remain;
- the instruction body is non-empty and role-focused;
- no unresolved placeholders remain;
- the selected installation scope is explicit;
- validation succeeds.

## Bundled resources

- `references/custom-agents.md`: vendored Goose custom-agents documentation.
- `references/UPSTREAM.md`: source and refresh instructions for the reference snapshot.
- `references/manual-external-evidence.md`: secure host-neutral evidence export/import contract, schema, trust, and diagnostics.
- `references/privacy-retention.md`: versioned data classification, central redaction, transcript retention, protected references, deletion, and local/CI guidance.
- `scripts/agent-creator` (`scripts/agent-creator.exe` on Windows): native unified CLI injected only into release staging; it is not present in the portable source Skill.
- The TypeScript implementation and source-only modules live in `apps/agent-creator-cli/` in the repository, outside this independently installable Skill.
- `evals/evals.json`: autonomous, target-backed creation, validation, routing, and paired-role scenarios.
- `assets/evaluation-fixtures/`: immutable valid, invalid, current, baseline, and task fixtures used by those scenarios.