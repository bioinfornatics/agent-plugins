# Typed Component Evidence

Use typed receipts for whole-plugin evaluation. The plugin verifier discovers every supported component and aggregates evidence explicitly; a generic `--tests-status pass` is regression evidence only and never substitutes for a missing component receipt.

## Common envelope

Every receipt uses this envelope:

```json
{
  "schema_version": "1.0",
  "artifact": "skill",
  "name": "writer",
  "status": "pass",
  "source_sha256": "<64 lowercase hex characters>",
  "generated_at": "2026-09-17T18:00:00Z",
  "applicability": { "status": "applicable" },
  "checks": [
    { "id": "behavior", "status": "pass", "evidence": ["runs/1/grading.json"] }
  ],
  "payload": { "evaluated_behaviors": ["writes a verified report"] }
}
```

`artifact` is `skill`, `agent`, `hook`, `mcp`, or `integration`. Status is `pass`, `fail`, `blocked`, or `na`. Each check has an ID, status, evidence paths or stable references, and a reason for any non-pass status. An N/A receipt must use both `status: "na"` and `applicability: { "status": "na", "reason": "..." }`. N/A without a concrete reason blocks verification.

`source_sha256` is a deterministic, component-keyed hash over the complete shipped plugin boundary. This deliberately invalidates component evidence when shared runtime dependencies change, including hook executables, agent resources, bundled libraries, and local MCP server files referenced by `mcp.json`. The verifier computes it independently and blocks stale receipts. VCS metadata, caches, non-vendored `node_modules`, and `evaluations/` are excluded because they are not shipped runtime inputs; excluding `evaluations/` also prevents the generated evidence workspace from hashing itself. Integration receipts use the current packaged plugin source hash with the same package exclusions.

## Typed payloads

| Artifact | Required payload |
|---|---|
| Skill | `evaluated_behaviors: string[]` |
| Agent | `evaluated_tasks: string[]` |
| Hook | `events: string[]`, `safety_cases: string[]` |
| MCP | `servers: string[]`, `capabilities: string[]` |
| Integration | `covered_components: string[]`, `scenarios: IntegrationScenario[]`, `handoffs: IntegrationHandoff[]` |

Required arrays are non-empty except `handoffs`, which may be empty only for a single-component plugin. Each scenario contains a unique `id`, non-empty `covered_components`, and its `handoffs` as `{ from, to }` pairs. Top-level handoffs contain `from`, `to`, the declared scenario ID, and a non-empty `evidence` list; the scenario and top-level declarations must agree. Every discovered component must be covered by at least one scenario. Unknown component keys, unknown receipt keys, undeclared scenarios, and undeclared handoff pairs are rejected. Component references use typed keys such as `skill:writer`, `agent:reviewer`, `hook:goose-hooks`, and `mcp:mcp`.

## Discovery and aggregation

The verifier discovers:

- immediate `skills/*/SKILL.md` directories;
- immediate supported files in `agents/`;
- the canonical Goose hooks document, falling back to the legacy root document;
- portable root `mcp.json`.

For every discovered component, the plugin receipt reports kind, name, evidence status, applicability, computed and receipt source hashes, freshness, typed-envelope status, and checks. `component_summary` counts pass, fail, blocked, and N/A outcomes. Missing, malformed, or stale applicable evidence blocks the component gate. Check outcomes are aggregated conservatively: any failed check makes the component fail and any blocked check blocks it, regardless of a claimed top-level pass. Explicit valid N/A evidence is neutral.

A full plugin (one containing any agent, hook, or MCP component) requires typed receipts. Legacy minimal Skill receipts remain accepted for Skills-only plugins for compatibility. Evaluation and release profiles additionally require a typed integration receipt that covers every discovered component and supplies cross-component handoff evidence.

## Full-eval handoff

`full-eval --dry-run` lists each discovered component, expected typed receipt path, source hash, and specialist handoff command. Skill evaluation remains routed to skill-creator. Agent, hook, and MCP evidence is supplied by their specialized creators. For full plugins, integration evidence is written to `integration/receipt.json`. Resume only advances once those receipts exist; final verification validates their contents and freshness.

## Proportionate integration coverage

Complete component coverage does not mean one new model campaign per component or
repeating every unit-level assertion in integration. Use compatible unchanged
component receipts when all required current hashes and bindings match. Select a
compact set of real integration journeys for distinct interaction/handoff failures;
a journey may cover multiple components with explicit declared and observed evidence.
Do not claim coverage from names alone or omit required receipts to meet a budget.
Before execution, account for nested specialist campaigns, variants, repetitions and
criterion-level versus batched grader calls. Justify each additional campaign by its
new risk or uncertainty; preserve unavailable/stale evidence as blocked or inconclusive.
