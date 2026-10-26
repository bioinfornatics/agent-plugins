# Agent Skill authoring pattern catalog

Source: [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), reviewed 2026-08-23.

Read this catalog at two mandatory moments:

1. **Creation:** before drafting the structure, decide which patterns the task needs.
2. **Improvement:** after evaluation or observed usage, map each failure to a pattern decision before adding instructions.

For every pattern, ask: **Is it relevant here? Why? Where should it be applied?** Record the consequential choices; do not add patterns mechanically.

## Contents

- [Core authoring decisions](#core-authoring-decisions)
- [Discovery and structure](#discovery-and-structure)
- [Progressive disclosure patterns](#progressive-disclosure-patterns)
- [Rule-rich domain coverage](#rule-rich-domain-coverage)
- [Workflow and quality patterns](#workflow-and-quality-patterns)
- [Content patterns](#content-patterns)
- [Evaluation and iteration patterns](#evaluation-and-iteration-patterns)
- [Executable Skill patterns](#executable-skill-patterns)
- [Runtime and tool patterns](#runtime-and-tool-patterns)
- [Anti-patterns](#anti-patterns)
- [Pattern review](#pattern-review)

## Core authoring decisions

### Concise is key

**Use when:** always. Metadata is globally loaded and the activated `SKILL.md` competes with conversation context.

**Apply by:** removing explanations the model already knows, retaining only task-specific knowledge, decisions, constraints, and verification.

### Appropriate degree of freedom

Choose instruction precision from task risk:

- **High freedom — heuristic text:** use when several approaches are valid and context determines the choice.
- **Medium freedom — pseudocode or parameterized scripts:** use when a preferred pattern exists but controlled variation is useful.
- **Low freedom — exact scripts and sequence:** use when operations are fragile, destructive, compliance-sensitive, or consistency-critical.

Do not force low freedom onto exploratory work or high freedom onto a narrow, failure-prone operation.

### Test with all intended models

**Use when:** the Skill targets more than one model class or deployment.

**Apply by:** checking that smaller models receive enough guidance and stronger models are not over-instructed. Record unsupported model coverage instead of assuming transfer.

## Discovery and structure

### Consistent naming

**Use when:** always. Choose a specific gerund, noun phrase, or action-oriented name; avoid vague names such as `helper`, `tools`, or `data`.

### Effective description

**Use when:** always. Write English third-person discovery metadata that answers what the Skill does and when it activates. Include distinctive user intent and concrete domain terms, not implementation detail.

### Frontmatter contract

**Use when:** always. Require valid `name` and `description`; respect the 64-character name and 1,024-character description hard limits and avoid XML tags.

## Progressive disclosure patterns

Progressive disclosure loads metadata first, the common entrypoint after activation, and detailed resources only when their condition applies.

### Pattern 1: High-level guide with references

**Use when:** the common workflow is short but advanced rules, APIs, examples, or variants are substantial.

**Apply by:** keeping the overview and one direct link per reference in `SKILL.md`, at the action that requires it. State both the condition and reading deadline. Read operational safeguards before governed actions; read output-only formatting after investigation, immediately before reporting, including blocked and no-change outcomes. Split mixed-purpose references when deadlines differ. Reuse loaded unchanged guidance rather than rereading it mechanically.

### Pattern 2: Domain-specific organization

**Use when:** one Skill spans independent domains, providers, frameworks, datasets, or product areas.

**Apply by:** creating one descriptively named reference per domain and loading only the selected domain. Keep shared rules in `SKILL.md`.

### Pattern 3: Conditional details

**Use when:** the task branches by operation, input type, environment, or state.

**Apply by:** put the decision point in `SKILL.md`, then link each substantial branch to its own reference. Keep small branches inline.

### Avoid deeply nested references

**Use when:** always. Link selected workflows directly from `SKILL.md`. A workflow reference may link its specialized resources at the exact consuming step, with a condition and reading deadline; this is controlled disclosure, not permission to recursively preload. Avoid chains that make the agent search to discover the next action.

### Table of contents for long references

**Use when:** a reference exceeds about 100 lines; require it above 300 lines. A table of contents exposes scope without forcing a full sequential read.

### 500-line entrypoint budget

**Use when:** always. Keep `SKILL.md` at or below 500 lines. This is a ceiling, not a target or justification to keep irrelevant procedures inline. When distinct user intents lead to independent workflows, keep selection and indispensable common limits in `SKILL.md` and move each detailed workflow to a conditionally loaded reference, even far below 500 lines. Ask: for this request, which loaded instructions would never be used? Move substantial unused branches behind explicit routing.

## Rule-rich domain coverage

### Coverage matrix pattern

**Use when:** correctness depends on many deterministic rules, formats, versions, directions, lifecycle states, or classifiable edge cases.

**Apply by:** inventory the main rule space before implementation. Mark each cell as automated, semantic, unsupported, or not applicable. Create scenarios that cover every important in-scope cell. Automate reliable verdicts and reserve semantic review for genuinely contextual ambiguity. Read the rule-rich domain coverage reference linked directly from SKILL.md for the full checklist.

**Avoid:** equating minimality with the fewest files, implementing only one representative case, hiding deterministic gaps behind a generic semantic-review instruction, or exhausting the action budget on extended rules before the eval set and final validation exist. The target is breadth-first delivery of the smallest sufficient domain coverage.

## Workflow and quality patterns

### Sequential workflow

**Use when:** the task has dependencies, multiple stages, or steps that agents may skip.

**Apply by:** use one numbered execution sequence per distinct responsibility, from its first useful action through verification, reporting, handoff and stop. Independent workflows belong behind conditional routing, not in one mandatory sequence. Do not narrate the same work again in a delivery checklist. Put conditional branches and legitimate parallel work in sublists with a verification join. Place each reference inside its consuming step; a conditional preload catalog is insufficient. Preserve permissions, evidence, blockers and bounded-scope stops while simplifying sections. Read output-only contracts immediately before reporting, never defer operational safeguards. Adapt the sequence and item count to the responsibility.

### Feedback loop

**Use when:** output can be checked and corrected.

**Apply by:** run validator or rubric, inspect errors, fix, and repeat until the acceptance condition passes. Do not validate only at the end when earlier checks are cheaper.

### Conditional workflow

**Use when:** creation/editing, provider, format, state, or other branches require different procedures.

**Apply by:** make the branch decision first. Use conditional-detail references when branches become long.

### Plan-validate-execute with verifiable intermediate output

**Use when:** batch, destructive, complex, or high-stakes changes can be validated before mutation.

**Apply by:** create a structured plan artifact, validate it deterministically, execute only after it passes, then verify the result.

## Content patterns

### Avoid time-sensitive information

**Use when:** always. State the current method without date gates. Put necessary deprecated behavior in a clearly marked legacy section.

### Consistent terminology

**Use when:** always. Choose one term for each concept and use it throughout instructions, references, scripts, and outputs.

### Template pattern

**Use when:** output structure matters.

**Apply by:** provide an exact template for strict schemas or a labeled default for flexible reports. Match strictness to the real requirement.

### Examples pattern

**Use when:** format, tone, edge-case handling, or quality is easier to demonstrate than describe.

**Apply by:** provide concrete input/output pairs. Avoid redundant examples and move large example sets to a reference.

### Avoid too many options

**Use when:** always. Give one reliable default and only the escape hatches justified by materially different conditions.

## Evaluation and iteration patterns

### Evaluation-driven development

**Use when:** creating or materially changing a Skill.

**Apply by:** identify baseline gaps, define representative evaluations, measure the baseline, write minimal instructions, and iterate against evidence.

### Expert-author / fresh-user loop

**Use when:** improving instruction quality.

**Apply by:** use one agent/context to author and a fresh isolated agent to execute. Feed observed failures back into the authoring pass.

### Observe navigation behavior

**Use when:** evaluations or real usage show missed references, unexpected file order, ignored resources, or repeated reads.

**Apply by:** improve link wording and information placement. Move repeatedly required content toward `SKILL.md`; remove or better signal ignored resources.

### Team feedback

**Use when:** the Skill has multiple users or operational contexts. Capture activation misses, confusing instructions, missing cases, and divergent terminology.

## Executable Skill patterns

Apply this section only when the Skill bundles executable code.

### Solve, do not defer

**Use when:** scripts can handle expected errors or decisions deterministically.

**Apply by:** implement explicit, actionable error handling rather than failing and asking the agent to improvise. Explain constants and retry/timeout choices.

### Utility scripts

**Use when:** a repeated operation is deterministic, fragile, expensive to regenerate, or benefits from consistency.

**Apply by:** bundle the script and say whether the agent should **run** it or **read** it. Prefer execution for utilities; document inputs, outputs, and verification.

### Visual analysis

**Use when:** layout, spatial structure, rendering, or image-visible state matters.

**Apply by:** render the input or output to images and inspect those images rather than relying only on source structure.

### Verifiable intermediate outputs

**Use when:** an open-ended plan can be checked before execution. Prefer structured JSON or another machine-verifiable artifact and produce specific validation errors.

### Package dependencies

**Use when:** scripts require non-standard packages.

**Apply by:** list requirements, verify runtime availability, and account for offline environments. Do not assume installation or network access.

## Runtime and tool patterns

### Filesystem-oriented discovery

**Use when:** always. Use descriptive forward-slash paths and organize files by domain or feature. References consume no context until read.

### Fully qualified MCP tools

**Use when:** the Skill calls MCP tools. Use `ServerName:tool_name` to avoid ambiguity and tool lookup failures.

### Do not assume tools are installed

**Use when:** external packages, CLIs, MCP servers, or capabilities are required. Check availability, document prerequisites, and provide only valid fallbacks.

### Clear script intent

**Use when:** scripts exist. Distinguish “run this script” from “read this script as reference.”

## Anti-patterns

Reject or revise these patterns:

- Windows-style backslash paths instead of portable forward slashes.
- Too many equivalent approaches without a default.
- Deep reference chains.
- Vague names or descriptions.
- Time-sensitive branches in the common workflow.
- Inconsistent terminology.
- Magic constants and unhandled script errors.
- Assuming dependencies or tools exist.
- Generating deterministic utility code repeatedly instead of bundling it.
- Large conditional branches or example collections left in `SKILL.md`.
- Documentation written before representative evaluations reveal a real gap.
- A rule-rich script that implements one illustrative case while delegating automatable core rules to an unspecified semantic pass.
- Adding exhaustive machinery to a simple or subjective Skill with no evidence that the domain requires it.

## Pattern review

At creation and after every material evaluation, record a compact decision table for relevant patterns:

| Pattern | Relevant? | Evidence or reason | Apply where? |
|---|---|---|---|
| Appropriate degree of freedom | Yes/No | Task variability and risk | Section or script |
| Rule-rich domain coverage | Yes/No | Number of deterministic dimensions, formats, versions, directions, states, and edge cases | Rule matrix / scripts / evals |
| Progressive disclosure variant | Yes/No | Domain or branch complexity | `SKILL.md` / reference |
| Sequential or conditional workflow | Yes/No | Dependencies and decisions | Workflow section |
| Feedback loop | Yes/No | Available validator or rubric | Verification step |
| Template or examples | Yes/No | Output-shape ambiguity | Body / reference / asset |
| Utility script | Yes/No | Repeated deterministic work | `scripts/` |
| Visual analysis | Yes/No | Spatial or rendered fidelity | Workflow step |
| Plan-validate-execute | Yes/No | Mutation risk and verifiability | Workflow + script |
| Dependency or MCP guidance | Yes/No | External runtime requirement | Compatibility / body |

Do not copy every pattern into the Skill. The review exists to select the smallest set that addresses observed needs.
