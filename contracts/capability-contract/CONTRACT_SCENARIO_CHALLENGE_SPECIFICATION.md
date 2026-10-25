# Contract/scenario challenge API 1.0.0

This pure API isolates domain, UX, safety, and evaluation challenges against one immutable capability-contract revision and a content-addressed scenario set. `challengeContractScenarios` performs no I/O and never mutates caller data.

## Input and bounds

Requests carry version `1.0.0`, a positive base revision, a valid Capability Contract, no more than 100 scenarios, and their canonical SHA-256. Reviews contain each of the four roles at most once, at most 25 findings per role and 100 overall. Every finding cites exactly one existing scenario or bounded JSON Pointer into the contract. Unknown properties, sparse arrays, accessors, symbols, cycles, dangerous pointer segments, stale hashes, and excessive structures are rejected. Proposed values are recursively bounded JSON only: null, booleans, strings, finite numbers, dense arrays, and plain objects; undefined, functions, symbols, bigint, non-finite numbers, sparse arrays, accessors, and exotic objects are rejected.

## Consolidation and disagreement

Only byte-equivalent canonical findings (trimmed summary, risk, citation, and proposed change) consolidate. Their roles and source IDs remain visible. Different claims or changes concerning the same citation are preserved and cross-referenced by `disagreementWith`. Conflicting decisions on a consolidated duplicate leave it unresolved. Duplicate representatives are always the lexically lowest stable finding ID, and consolidation output is invariant to review and finding permutations. Accepted proposed changes that target the same or ancestor/descendant JSON Pointer with different values are not applied: every conflicting finding becomes an explicit blocker and unknown until exactly one proposal remains accepted.

## Risk and revision semantics

Unresolved low-risk findings are advisory and nonblocking. Every unresolved high-risk finding is both an explicit unknown and blocker. Accepted findings with proposed changes are applied to a detached copy in deterministic pointer order and revalidated as a Capability Contract. At least one accepted change creates exactly the next immutable revision and sets the prior scenario hash to `null` with `invalidated: true`; otherwise revision and hash remain unchanged. Callers must regenerate and hash scenarios for the new revision.
