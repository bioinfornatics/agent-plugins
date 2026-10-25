# Read-only installation diagnostics

For an explicitly selected installation, run from a trusted complete copied Skill:

    node scripts/plugin-creator.mjs doctor /absolute/plugin-root --format json

The diagnostic never executes inspected launchers, hooks, binaries or MCP servers.
Repair, install, network access, HOME discovery and activation are outside its scope.
Do not launch a suspected damaged installation merely to diagnose itself.

## Choose the command

- doctor: local installation self-consistency against supplied manifests.
- validate: portable-format and strict authoring checks, not runtime integrity.
- verify: evaluation/release evidence gates, not installation repair.

The initial scope supports the existing namespaced node-bundled runtime declaration,
per-Skill runtime inventories and optional distribution inventory. Checks cover
launcher presence, runtime sizes and SHA-256, distribution executable-mode
classification, mixed native/source layouts and Node minimum. Launcher contents are
hash-checked only when a distribution manifest covers them. Standalone Skills
without a plugin root are outside this first scope. No portable fields are added.

## Results

| Status | Exit | Meaning |
|---|---|---|
| ok | 0 | Supported checks completed without detected faults |
| error | 1 | Missing, modified, unsafe, malformed or incompatible resources |
| invalid usage | 2 | Missing root, extra arguments or unsupported format |
| incomplete | 3 | Unsupported runtime or defensive limit reached |

Only text and JSON are supported. --quiet suppresses normal output without changing
the exit result. Findings have stable codes and generic remediation. Missing
distribution provenance is an explicit warning, not an authenticated pass.
Native-bun remains incomplete: native manifest, architecture and binary verification
are not implemented; resources are never executed.

## Trust and limits

Local integrity only means bytes agree with supplied manifests. Manifests can be
replaced; source commit/tree strings are unauthenticated claims, not publisher
identity or verified repository provenance. An ok report is not a malware scan,
behavioral evaluation, signature check or release approval.

Static symlinks, hardlinks, special entries, traversal and noncanonical inventory
paths are rejected. Reads use no-follow descriptors and file identity checks.
Limits: 10,000 cumulative visited entries, 4 MiB per JSON document, 512 MiB total
hashed bytes and 128 nested directories. Manifests declaring over 10,000 inventory
rows are invalid; this is distinct from exceeding the traversal inspection limit.
Directory listing is materialized before counted traversal; no directory-allocation
memory or latency ceiling is promised. Exhaustion is incomplete unless another
fault makes the report error. Reads may affect access times; installation bytes,
modes and mtimes are not written. There is no snapshot or guarantee against
concurrent hostile ancestor replacement. Inspect a quiescent offline tree.

For faults, obtain a complete trusted distribution or report sanitized findings.
Do not run npm install, execute suspect resources or auto-repair the tree.
