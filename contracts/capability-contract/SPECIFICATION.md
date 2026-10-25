# Capability Contract 1.0.0

The capability contract is the host-neutral input shared by creator selection, generation, and later evaluation planning. It describes the intended outcome; it does not collect requirements, generate artifacts, define evaluation execution, encode workflow verdicts, or invoke a host. The separately versioned result-state contract is specified in [RESULT_SPECIFICATION.md](RESULT_SPECIFICATION.md).

## Required decisions

Every document declares schemaVersion 1.0.0; an explicit compatibility.unknownFields policy of reject or preserve; a non-empty objective; an artifactRecommendation candidateType of skill, agent, hook, or plugin; sideEffects.applicable, with enumerated effects when applicable; at least one measurable success signal with a finite numeric target; and an explicit productionBoundary level and statement. Production use also requires one or more conditions.

Users, target tasks, inputs, outputs, constraints, assumptions, risks, target hosts, and optional boundary lists are arrays. They may be omitted by an idea-derived input and normalize to empty arrays. Omission means “not yet specified,” not approval or evidence.

## Normalization

Validation always precedes normalization. Invalid fields are never repaired or discarded silently. Normalization trims the objective and string-list values, materializes optional arrays and nested optional arrays, and preserves declaration order. It does not infer an objective, success threshold, side-effect applicability, or production scope.

## Compatibility

Version 1 applies the unknown-field policy to the contract root. Nested objects are closed in both modes so misspelled safety fields fail. Reject policy rejects every unknown root field with CAPABILITY_UNKNOWN_FIELD. Preserve policy accepts and round-trips unknown root fields without interpreting them.

A consumer must reject unsupported schemaVersion values. Adding optional fields is compatible for preserve consumers; adding required fields or changing meanings requires a new schema version. The JSON Schema and TypeScript validator are normative together: the schema defines document shape, while stable validator diagnostics provide actionable remediation.

## Diagnostics

Diagnostics are deterministic and ordered by contract field, with stable code, JSON Pointer path, message, and remediation. Callers should branch on code, not prose. normalizeCapabilityContract throws CapabilityContractValidationError carrying the same diagnostics when validation fails.
