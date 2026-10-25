# Adaptive bounded elicitation API 1.0.0

`planAdaptiveElicitation(request)` is a deterministic, side-effect-free planner built on `recommendArtifact`. It does not change recommendation routing or responses.

## Knowledge and evidence

Every field and evidence item has one explicit state: `known`, `assumed`, `unknown`, or `contradictory`. Fields identify the architecture, safety, and/or evaluation decisions they affect. Nested values, identifiers, versions, cardinalities, and unknown properties receive strict total runtime validation. Before validation, the planner takes a bounded data-property snapshot without invoking getters. Accessors, hostile proxies, symbol keys, cycles, and excessive depth or size fail with the same sanitized `TypeError`; attacker-controlled exception text is never exposed. Inputs are never mutated.

## Question selection

The planner emits at most three questions. Stable value is computed from ambiguity confirmation priority, knowledge state, and affected decision classes; ties use portable field identifiers. Answered fields and previously asked question IDs are excluded. Expert mode omits ordinary assumptions, while novice mode may ask about them.

Ambiguity involving destructive operations, security, production, or untestable behavior always requires confirmation. Such fields cannot have defaults and block preview readiness even if their question was already asked or deferred by the three-question bound.

Ordinary optional questions may declare a reversible default and its consequence. When omitted, the planner deterministically generates the conservative default and an explicit consequence from the validated field label. Thus every unresolved ordinary field has an explicit default in the model, question (when selected), and preview. Unanswered optional fields do not block preview, and applied preview defaults remain explicit. The response embeds the unchanged Artifact Recommendation API result.

The result schema is exported at `@agent-plugins/capability-contract/elicitation-schema/1.0.0`.
