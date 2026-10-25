# Transitive Evidence Graph 1.0.0

This contract proves release conclusions through an immutable, versioned DAG. It supports every required evidence kind: `artifact`, `scenario`, `fixture`, `plan`, `output`, `grade`, `benchmark`, `test`, `archive`, and terminal `approval`.

## Integrity and authenticity

`envelopeHash` is SHA-256 over canonical JSON containing the entire node envelope: `id`, `kind`, `schemaVersion`, `identity` (`issuer` and `subject`), `issuedAt`, optional `expiresAt`, and `content`. It deliberately excludes only `envelopeHash` and `authenticity`. Therefore metadata or content substitution invalidates the node.

Every node must additionally prove issuer authenticity by one of two explicit methods:

- `ed25519`: a signature over the UTF-8 bytes of the complete `sha256:<hex>` envelope hash, verified by a policy trust key selected by `keyId`.
- `trusted-anchor`: an externally supplied immutable digest that must equal `envelopeHash` and appear in that issuer's policy trust anchors.

Recomputing a hash after substitution cannot restore validity without the private signing key or a newly trusted external anchor. Approval nodes have an extra independent control: SHA-256 of the approval subject must appear in `trustedApprovalSubjectDigests`. This anchors terminal human approval to a trusted external subject without disclosing it.

## Dependency binding

Every edge fixes `from`, `to`, relation `depends-on`, `sourceEnvelopeHash`, and `targetEnvelopeHash`. `dependencyHash` is canonical SHA-256 over all five fields. Thus source, target, relationship, and either endpoint envelope cannot be substituted independently.

Allowed progression is artifact → scenario/fixture/plan → output/grade/benchmark/test/archive → approval. The `(identity.issuer, identity.subject)` tuple is a graph-wide unique identity and may occur on exactly one node. At least one intrinsically valid approval must be terminal (zero outgoing edges), and every node—including each root and side branch—must have a directed path made only of valid dependencies to such an approval. Consequently disconnected and orphan branches reject. Every non-artifact node requires an incoming edge. Missing endpoints, duplicate IDs/dependencies, and cycles reject.

## Time and trust

The caller supplies a strict RFC 3339 UTC `now`, issuer trust intervals, schema allowlists, revocations, authenticity material, and approval subject anchors. `issuedAt > now` is always invalid. Issuance outside trust, issuance at/after revocation, expiry before issuance or before `now`, and a conclusion predating a dependency all reject. For approvals, temporal inversion is reported as stale approval.

## Determinism and diagnostics

Verification is pure and fail-closed. Nodes and edges are evaluated in lexical ID order for security decisions. Every reason found for a node appears in `nodeInvalid`; reasons are sorted. `firstInvalidEdge` is the lexical edge ID/code minimum across all invalid edges. `affectedConclusions` is the sorted union of conclusions reachable from **every** invalid node and invalid edge, rather than only the first failure.

Diagnostics never expose evidence content or raw subjects. Subject diagnostics use one-way fingerprints. Snapshot-strict canonicalization permits inert JSON only: key-sorted objects and ordered dense arrays. Every object/array own key is inspected, including non-enumerable and symbol keys. Symbols, functions, bigints, undefined, non-finite numbers, accessors/getters, non-enumerable or nonstandard data descriptors, extra array properties, proxies that throw, exotic prototypes, dangerous keys, cycles, sparse arrays, and excessive depth fail closed without executing getters.

The conformance fixtures include all node kinds, per-kind mutations, replay, substitution, downgrade, stale approval, missing nodes, duplicate dependencies, and cycles. The tests also cover recomputed hashes, Ed25519 signature substitution, future issuance, approval anchors, multi-root affected unions, and hostile proxy/getter values.

Compatibility: this is an independent `1.0.0` surface. Unknown fields reject. Future incompatible versions require a new schema/API version.
