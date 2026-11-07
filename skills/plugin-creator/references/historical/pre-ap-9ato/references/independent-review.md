# Independent builder and challenge review

`independent-review` runs a builder, domain challenger, UX challenger, evaluation challenger, and verifier as isolated host calls. It is a local portable orchestration contract and has no sibling creator runtime dependency.

```bash
plugin-creator independent-review --config review.json --host ./branch-host --format json
```

The JSON config freezes `approvedContext` (`evidence`, `contracts`, and `scenarios`) and non-empty `criteria` before execution. Its matrix sets role counts, maximum concurrency, per-branch milliseconds, and a run-wide budget. Both deadlines are enforced by the orchestrator with `Promise.race`; correctness does not depend on host cancellation cooperation. A response settling after either deadline is quarantined and cannot alter branch records or convergence.

Builder and challenger requests never receive peer outputs. Verifiers receive only successful branches' validated `publicOutput`; raw output and private reasoning are retained in provenance but never forwarded. The recursively closed public-output projection copies only documented fields, including nested claim, change, and risk fields. Every invocation gets a separately frozen copy.

A public output has `summary`, `claims`, `proposedChanges`, and optional `risks`. Claims and risks can cite only approved evidence, and claims can cite only frozen criteria. Risk IDs and statements are required. Claim, change, and risk IDs are unique within a branch and across accepted branches. Every `contradicts` reference must resolve to exactly one existing claim. Every proposed change must cite approved evidence and at least one approved contract or scenario. Invalid, failed, and timed-out branches are recorded without cancelling successful siblings.

Convergence is deterministic and descriptive: exact normalized agreements, opposed or explicitly linked contradictions, unsupported claims, risks, and proposed changes. It always reports `autoResolved: false`; a human or later governed process must decide conflicts.
