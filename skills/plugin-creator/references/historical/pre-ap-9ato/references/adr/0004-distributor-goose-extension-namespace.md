# ADR 0004: Use a distributor-owned namespace for the Goose adapter

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision story:** ap-tzd
- **Supersedes:** ADR 0001 for newly generated artifacts

## Context

ADR 0001 selected `io.github.block.goose` from the historical `block/goose` repository and `block.github.io` documentation location. Goose is now an Agentic AI Foundation project, and its canonical repository resolves to `aaif-goose/goose`. Neither this distribution nor its maintainers control `block.github.io` or `aaif.io`, so this project must not allocate an apparently upstream-owned namespace on their behalf.

Agent Plugins 1.0.0 allows client-specific data under a reverse-domain namespace. The namespace should identify the party that defines and maintains the extension contract. This repository is published at `github.com/bioinfornatics/agent-plugins`, so it can truthfully own a GitHub-derived distributor namespace.

## Decision

New output uses:

`io.github.bioinfornatics.agent-plugins.goose`

The matching package path is:

`extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json`

This identifier means “the Goose adapter contract maintained by bioinfornatics/agent-plugins.” It does not claim to be an official Goose or AAIF namespace.

The historical `io.github.block.goose` key and directory become input-only migration aliases. Root `hooks/hooks.json` remains another legacy input. New output never emits either form. If canonical and any legacy form coexist, validation and migration fail closed instead of selecting precedence or merging executable hooks.

If Goose/AAIF later ratifies an upstream-owned namespace, adoption requires another explicit ADR and migration. Candidate names such as `io.aaif.goose` are not emitted before upstream approval.

## Consequences

- Namespace ownership is accurate and auditable.
- The young project accepts an early breaking layout correction before a large installed base develops.
- v0.5.0 packages using `io.github.block.goose` require explicit migration, but remain detectable.
- Portable Agent Plugins content remains unaffected because hook semantics are client-specific.
- Documentation and diagnostics must call this a distributor-owned Goose adapter, not an upstream Goose standard.

## Migration

1. Detect `extensions/io.github.block.goose/hooks.json` and its manifest key.
2. Validate the historical hook document before proposing changes.
3. Move it to `extensions/io.github.bioinfornatics.agent-plugins.goose/hooks.json`.
4. Replace the manifest key and hook path atomically.
5. Reject mixed historical, root-legacy, and canonical layouts.
