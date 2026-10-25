# Artifact Recommendation API 1.0.0

This independently versioned, side-effect-free API recommends one of six authoring artifacts from a stated outcome. It does not extend or alter the four-type `CapabilityContractV1` enum.

## Request

`recommendArtifact({ version: "1.0.0", outcome, explicitType? })` accepts only these properties. Runtime validation rejects malformed versions, empty or oversized outcomes, invalid override values, and unknown properties. Input is never mutated and recommendation never creates files.

## Deterministic routing

| Intent | Artifact |
| --- | --- |
| Reusable procedure or instructions | skill |
| Delegated role or autonomous specialist | agent |
| Event-triggered enforcement | hook |
| Tool/resource protocol boundary | mcp |
| Multi-step orchestration | recipe |
| Distribution combining component types | plugin |

Low-signal or tied requests include at least two alternatives and a consequential question. A supported explicit choice is respected. Unsupported or safety-bypassing overrides are reported and not applied.

Portability is artifact-specific and does not imply that host manifests, hook lifecycles, recipes, or plugin packaging are cross-runtime standards. Creator bridges are exposed only for the four creators present in this distribution; MCP and recipe recommendations report an unavailable bridge.

The response schema is exported at `@agent-plugins/capability-contract/recommendation-schema/1.0.0`.
