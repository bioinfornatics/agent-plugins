# Create or improve a Skill

Read only for a creation/improvement request, then execute this workflow. Do not load the evaluation workflow unless execution was also requested.

1. **Start from the requested outcome.** Use the supplied context and make reversible authoring choices autonomously within scope. Ask only when a concrete user decision blocks the next action; continue unaffected work. Do not run a readiness assessment or seek routine confirmation.
   - Only for a requested early-idea conversation, read [idea-to-candidate guidance](idea-to-candidate.md) before elicitation/generation. Its conversational adapter requires contract/scenario confirmation in a durable workspace; simulated generation is not validation or evaluation proof. Do not impose that adapter on a direct creation request.
   - Create one standalone or bundled Skill. Whole-plugin work belongs to agent-plugins:plugin-creator, hooks to agent-plugins:hook-creator, and agents to agent-plugins:agent-creator. Repository instructions belong in AGENTS.md, not the Skill.

2. **Write the instructions and resources.** Before drafting a new or materially redesigned Skill, read [authoring guidance](authoring.md), [prompt engineering](prompt-engineering.md) and the relevant [authoring patterns](skill-authoring-best-practices.md). Select useful patterns, not every pattern.
   - Write English metadata and instructions. Before changing discovery metadata, read [description optimization](description-optimization.md): concise third-person responsibility and activation context, not a procedure or obligation list.
   - Keep SKILL.md at most 500 lines: a ceiling, not a target. Keep intent selection and indispensable common limits in the entrypoint; place independent detailed workflows in conditionally loaded references even well below that ceiling. Give each selected workflow its own ordered execution sequence, with conditional branches inside it. Do not make one responsibility traverse another workflow or duplicate a sequence as a delivery checklist.
   - Put operational limits before governed actions, conditional detail at its point of use, and report formatting immediately before reporting. Link each reference directly once at the relevant step; add Contents to references over 300 lines. Include only resources the target Skill needs.
   - For rule-rich deterministic domains, read [domain coverage](domain-coverage.md) before designing the rule space; deliver breadth-first with explicit unsupported areas.
   - For revisions based on usage/evaluation findings, read [evidence-driven improvement](improvement.md) before changing the candidate; preserve working behavior and required approval boundaries.

3. **Supply evaluation scenarios with the candidate.** Before creating/changing scenarios, read [evaluation design](evaluation-design.md); read the applicable [schemas](schemas.md) when writing machine artifacts. Maximize coverage of distinct risks, not test count. Load only the schema sections needed for the artifacts being written.
   - Supply evals/evals.json with realistic behavioral prompts, observable expected outcomes and atomic criteria. Supply eval.json activation cases when discovery/selection is relevant; do not add cases merely to pad the suite.
   - Map material risks to the cheapest valid oracle: deterministic checks for formats, links, calculations and observed state; contextual criteria for independent blinded grading. Keep a few operational journeys and justify costly repetitions by a confidence question, budget and stop rule.
   - Preserve applicable permission, stale-evidence, missing-context, work-preservation and correction-stop boundaries. Keep criteria/expected answers out of candidate task prompts. Use non-secret reusable fixtures; never mutate packaged source fixtures during a run.
   - Deliver this target layout, omitting optional resource directories with no purpose:

     ~~~text
     <skill-name>/
     ├── SKILL.md
     ├── references/           # conditional instructions and domain detail
     ├── scripts/              # deterministic/repeated/fragile operations
     ├── assets/               # templates and reusable materials
     ├── evals/
     │   ├── evals.json        # behavioral scenarios
     │   └── files/            # optional scenario fixtures
     └── eval.json             # activation scenarios when applicable
     ~~~

4. **Validate what was authored and deliver.** Run format validation on the produced Skill, inspect local link containment and the target tree, and check that evaluation cases match the requested outcome. Before a requested authoring audit, read [audit guidance](audit.md); audit does not authorize a rewrite. Fix observed findings within scope and the agreed correction budget.
   - Deliver the candidate path, instruction/resource structure, eval paths, actual checks and unresolved limits. Scenarios supplied is not scenarios executed; static conformance is not behavioral gain.
   - Stop after creation unless evaluation was also requested. For audit-only requests, perform the scoped audit, report findings and stop; do not run creation first. Packaging/release is a separate explicitly requested action.


## Commands for this workflow

Use the available launcher; source copies use Node.js 22+ through node scripts/skill-creator.mjs, native archives use the released executable. These are invocation options, not environment diagnostic steps.

~~~bash
skill-creator validate <skill-directory>
skill-creator audit <skill-directory> --format json
skill-creator design-evals <evals.json> --skill-path <skill-directory> --format json
~~~
