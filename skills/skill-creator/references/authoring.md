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

Use the pattern catalog linked directly from SKILL.md. For each potentially relevant pattern, decide whether it applies, why, and where. Select the smallest useful set rather than copying every pattern.

## 5. Domain coverage decision

Ask whether correctness depends on a substantial deterministic rule space: specifications, versions, formats, directions, lifecycle states, constraints, or many classifiable edge cases. If yes, read the rule-rich domain coverage reference linked from SKILL.md and create a compact coverage matrix before implementing. Choose the smallest sufficient coverage, not merely the fewest files or lines. Work breadth-first: create the complete minimal artifact set and durable evals before deepening lower-priority automation. If no, keep the Skill lean and do not invent a matrix.

## 6. Progressive disclosure

Keep metadata for selection, `SKILL.md` for the common workflow and branch decisions, and bundled resources for conditional depth:

- `references/` — domain variants, specifications, long examples, conditional procedures;
- `scripts/` — deterministic, repeated, or fragile operations;
- `assets/` — templates and reusable output materials.

Place each reference once inside the workflow step that needs it, before the governed action. A conditional preamble or reference table still makes the agent reconstruct the action relationship; do not use it as a substitute for step-local links. Give the exact reading deadline:

- Operational requirements (scope, criteria, permissions, tracking, candidate identity, independence): read before defining or performing the action they govern. Beads guidance applies only in a Beads repository, before choosing work or changing its state. Candidate rules apply before freezing inputs or reusing evidence.
- Output-only contracts (headings, report structure, delivery content): read after investigation, immediately before writing the relevant report. Include blocked and no-change deliveries.
- Mixed references: separate operational requirements from output formatting when their deadlines differ; never defer a safeguard because its file is called an output contract.

Reuse loaded, unchanged guidance when its coverage and freshness still apply. Do not reread mechanically. Keep `SKILL.md` at or below 500 lines and add a Contents section to references over 300 lines.

## 7. Verification-first design

Create at least three representative scenarios before extensive documentation. Include a normal case, a difficult boundary or conditional case, and a failure or missing-capability case. Use the evaluation-design reference linked directly from SKILL.md.

## 8. Build one ordered progression

Organize the authored Skill as one numbered workflow/checklist, adapted to its responsibility, from investigation through verification, reporting, transmission and stop. Use conditional sublists for variants and parallel activities, with an explicit join before dependent work. Do not repeat the procedure in a separate delivery checklist or impose the same item count everywhere. Challenge the section boundaries when they obscure action order; merely harmonizing headings is insufficient.

Place safeguards before the relevant actions in this progression. Preserve permissions, required evidence, blocking conditions and stop boundaries for limited requests when merging sections. Later steps verify actual results, inspect delegated returns when present, identify unresolved gaps and prepare the next action/restart context. Reading output-only contracts and writing the report is the final reporting step, including blocked or unchanged work.

## 9. Validate and deliver the candidate

Run format validation and authoring audit; resolve error-level findings. Inspect scenario results, local reference existence/containment, portable paths, dependencies and the 500-line limit against the structure just authored, without rewriting the workflow as another checklist. Static checks do not establish behavioral gain. Verify any delegated artifacts against scope and evidence; failed returns remain unresolved.

Keep missing proof, permissions or capabilities explicit; identify the immediate action and restart point. Immediately before delivery, read applicable output-only contracts or reuse unchanged loaded guidance, then report observed results and stop within the authorized scope.
