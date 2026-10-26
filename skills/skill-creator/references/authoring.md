# Skill creation checklist

Read this reference when creating a new Skill or materially redesigning one.

## 1. Discovery intent

- What does the Skill do?
- What observable outcome does it produce?
- When should the agent activate it?
- Which user intents, artifacts, or domain terms identify those situations?
- Which neighboring Skills are realistic competitors?
- Which near-miss requests should not trigger it?

Write English, third-person metadata. Keep `description` to one or two concise sentences containing responsibility and activation context, not implementation steps or a list of obligations. The agent selects from this metadata before loading the body: test whether it can choose between realistic siblings without knowing the procedure.

Derive activation scope from the target responsibility, not from the workflow that supplied the feedback. Selection does not grant execution authority. Keep prerequisites and conditions for reusing prior work in the body, rather than turning them into metadata obligations.

## 2. Abstraction choice

Confirm that reusable procedural knowledge is the right abstraction. Use an agent for a role, a hook for event-driven execution, a plugin for a distribution boundary, and a recipe for runtime workflow configuration.

## 3. Instruction design

Before drafting, answer: What instructions must the Skill give? In what order must they run? Are all instructions mandatory? Which instructions are conditional? Does `SKILL.md` exceed or approach 500 lines?

- Include only knowledge, constraints, and procedures the model cannot reliably infer.
- Order prerequisites before actions and verification after execution.
- Separate mandatory common steps from conditional branches.
- Match freedom to risk: heuristics for open tasks, parameterized patterns for preferred approaches, exact scripts for fragile operations.
- State why a non-obvious constraint matters.
- Provide one reliable default; add an escape hatch only for a materially different condition.

## 4. Pattern selection

Use the pattern catalog linked at the consuming authoring step in SKILL.md or its selected workflow reference. For each potentially relevant pattern, decide whether it applies, why, and where. Select the smallest useful set rather than copying every pattern.

## 5. Domain coverage decision

Ask whether correctness depends on a substantial deterministic rule space: specifications, versions, formats, directions, lifecycle states, constraints, or many classifiable edge cases. If yes, read the rule-rich domain coverage reference linked from SKILL.md and create a compact coverage matrix before implementing. Choose the smallest sufficient coverage, not merely the fewest files or lines. Work breadth-first: create the complete minimal artifact set and durable evals before deepening lower-priority automation. If no, keep the Skill lean and do not invent a matrix.

## 6. Progressive disclosure

Keep metadata for selection, `SKILL.md` for intent routing and indispensable common limits, and bundled resources for conditional depth. When distinct user intents lead to independent workflows, put each detailed procedure in a conditionally loaded reference; do this even when the entrypoint is far below 500 lines. The line limit is a ceiling, not a target. Ask which instructions would be loaded but unused for a given request; extract substantial unused branches. Keep a short single-purpose workflow inline when extraction would add no useful selectivity:

- `references/` — domain variants, specifications, long examples, conditional procedures;
- `scripts/` — deterministic, repeated, or fragile operations;
- `assets/` — templates and reusable output materials.

Link each independent workflow directly from SKILL.md at its intent-selection branch, before execution. Within that workflow, link specialized references once at the consuming step, with an explicit condition and deadline. This intentional two-level structure is allowed; avoid deeper discovery chains and recursive preloading. Place each reference at the action that needs it. A conditional preamble or reference table still makes the agent reconstruct the action relationship; do not use it as a substitute for step-local links. Give the exact reading deadline:

- Operational requirements (scope, criteria, permissions, tracking, candidate identity, independence): read before defining or performing the action they govern. Beads guidance applies only in a Beads repository, before choosing work or changing its state. Candidate rules apply before freezing inputs or reusing evidence.
- Output-only contracts (headings, report structure, delivery content): read after investigation, immediately before writing the relevant report. Include blocked and no-change deliveries.
- Mixed references: separate operational requirements from output formatting when their deadlines differ; never defer a safeguard because its file is called an output contract.

Reuse loaded, unchanged guidance when its coverage and freshness still apply. Do not reread mechanically. Keep `SKILL.md` at or below 500 lines and add a Contents section to references over 300 lines.

## 7. Verification-first design

Supply representative scenarios with the authored candidate before extensive documentation. Cover applicable normal, boundary/conditional and failure/missing-capability risks; optimize distinct risk coverage rather than a fixed count of costly runs. Providing scenarios does not automatically authorize executing them. Use the evaluation-design reference linked at scenario authoring in SKILL.md or its selected workflow reference.

## 8. Build one ordered progression

Organize each distinct user-requested responsibility as its own numbered execution workflow, from its first useful action through verification, reporting, handoff and stop. A Skill with two independent responsibilities may have two explicitly routed workflows; do not force evaluation through creation or creation through evaluation. Within one responsibility, keep one sequence rather than duplicating it as several checklists. Use conditional sublists for variants and parallel activities, with an explicit join before dependent work. Do not repeat the procedure in a separate delivery checklist or impose the same item count everywhere. Challenge the section boundaries when they obscure action order; merely harmonizing headings is insufficient.

Place safeguards before the relevant actions in this progression. Preserve permissions, required evidence, blocking conditions and stop boundaries for limited requests when merging sections. Later steps verify actual results, inspect delegated returns when present, identify unresolved gaps and prepare the next action/restart context. Reading output-only contracts and writing the report is the final reporting step, including blocked or unchanged work.

## 9. Validate and deliver the candidate

Run format validation on the produced candidate and an authoring audit when requested; resolve observed error-level findings within scope. Inspect scenario definitions, local reference existence/containment, portable paths and the 500-line limit against the structure just authored. Inspect execution results only if evaluation was also requested and actually run. Do not turn dependency inspection into generic environment diagnostics or repeat the workflow as another checklist. Static checks do not establish behavioral gain. Verify any delegated artifacts against scope and evidence; failed returns remain unresolved.

Keep missing proof, permissions or capabilities explicit; identify the immediate action and restart point. Immediately before delivery, read applicable output-only contracts or reuse unchanged loaded guidance, then report observed results and stop within the authorized scope.
