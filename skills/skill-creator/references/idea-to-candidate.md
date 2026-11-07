> **Historical reference — not a current execution workflow.** Retained for provenance.
> Its commands, schemas and acceptance claims are not supported by the current CLI.
> Use [current evaluation](evaluate-workflow.md), [scenario design](evaluation-design.md),
> [authoring](create-workflow.md) or [report review](review-viewer.md) instead.

# Idea-to-candidate conversation

Use this flow when the user has an idea but not yet a reviewable Skill candidate. The common path is conversational and summary-first.

## Common path

1. Route the idea to a standalone Skill without exposing internal creator names.
2. Ask at most three focused questions per turn. Render questions before recording them as asked, and revisit unanswered questions within the bound.
3. Preview the candidate contract and require its exact hash.
4. Derive the configured number of discriminating scenarios, show the frozen preview, and require its exact hash.
5. Launch only in the isolated workspace. The fake adapter simulates generation; it does not run validation or evaluation.
6. Report files, honest states, assumptions, risks, and the next human decision.

Resume in a later session with the same workspace. A read-only resume does not rewrite state. Mutations use a lock, unique temporary file, and revision comparison. Loaded state is validated and hashes are recomputed before use.

## Expert path

Use expert mode and path-based overrides for supported fields. Scenario count changes generated scenario count. Overrides unsupported by the bundled adapter are rejected explicitly. An override invalidates confirmation and returns to preview. Detail mode reveals the complete contract and evidence state.

## Safety

The bundled fake adapter is deterministic and writes only below the canonical conversation workspace. Existing symlinks at generated path boundaries are rejected. YAML frontmatter uses a structured serializer. It proves orchestration, not behavioral quality: generation is `simulated`, while validation and evaluation are `not-run`. A real adapter must preserve preview and confirmation boundaries and use only portable bundled logic or explicitly supplied versioned documentation. Production promotion is a separate human decision.
