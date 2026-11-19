# Agent Plugins 1.1.0 working-draft snapshot

This directory vendors an exact, immutable snapshot of the official Agent Plugins 1.1.0 working draft and its JSON Schemas. It is for offline analysis and future version-registry work; it does **not** activate 1.1.0. Published 1.0.0 remains the default.

## Provenance

- Official upstream: https://github.com/agentplugins/agent-plugins-spec
- Upstream commit: ff8ab5e392cc87bd88d87c060815a87490e51003
- Immutable commit page: https://github.com/agentplugins/agent-plugins-spec/commit/ff8ab5e392cc87bd88d87c060815a87490e51003
- Commit date: 2026-08-19T16:34:23Z
- Retrieval date: 2026-08-23
- Status stated by the specification: **Working Draft**
- Draft-introduction commit: a2afd7ec7edb916da638fc5c94640d4a7ba4480f (“Start the 1.1.0 working draft”)

The pinned commit was the official repository's main head at retrieval. Each source link below contains that immutable commit identifier.

| Local file | Immutable upstream source | Git blob ID | SHA-256 |
|---|---|---|---|
| spec.md | https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/spec/1.1.0.md | a3c710349565b8e58f32df2a154b7a5c65b32d02 | 735df8c8fe4f77510bd33410d6901d5325e6ed38aa7dc2ba385a0f174cc6b074 |
| plugin.schema.json | https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/schemas/1.1.0/plugin.schema.json | 499cb1d6cf6d2b8fbe5e4964a7d4e438cb7041ce | fdc7bb3962c48c9d2d561641d2bc96225c94ca69c4087010241b9423a290370f |
| mcp.schema.json | https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/schemas/1.1.0/mcp.schema.json | b9367db0fa3b58dc0005acc9723bb797a466081c | f227ec2c0e40cd23051bd7a6ba1f64789eff7773d4e481d80002ab9fd3c45137 |

Reproduce the snapshot by downloading those three paths from raw.githubusercontent.com at the pinned commit, then compare sha256sum output with the table. Git blob IDs can be reproduced by hashing the bytes as a Git blob (the bytes blob, a leading blob-length header, and SHA-1).

## Local link note

`spec.md` is kept byte-exact, so its upstream-relative schema links (for example
`../schemas/1.1.0/plugin.schema.json`) do not resolve in this Skill. The
corresponding local files are [plugin.schema.json](plugin.schema.json) and
[mcp.schema.json](mcp.schema.json) beside `spec.md`.

## Comparison with published 1.0.0

Comparison was made against the frozen 1.0.0 files at the same commit:

| 1.0.0 upstream path | Git blob ID | SHA-256 |
|---|---|---|
| spec/1.0.0.md | c95263bd61fc16608390006bc461e964ce21cd12 | 97a658b7dca3ce1b4c2266b95da300fa51d9dc4ade59d73168e5f9104272da18 |
| schemas/1.0.0/plugin.schema.json | 8fed0e1fe45d0464aee880d3fbab228b71ecfc1e | 0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883 |
| schemas/1.0.0/mcp.schema.json | a9139a4259b932c60b5351c8d9da6a5c60c97646 | 6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb |

Both specifications have 640 lines. The 1.1.0 baseline changes version and status wording, schema links/examples from 1.0.0 to 1.1.0, and two scope phrases: “claiming conformance to Agent Plugins v1” becomes “claiming conformance”; “Agent Plugins v1 defines no OAuth…” becomes “This specification defines no OAuth…”.

Each 1.1.0 schema has the same validation rules as 1.0.0. Its only three changed lines are the canonical $id, description version, and required document $schema constant. Normalizing 1.1.0 to 1.0.0 makes each schema byte-for-byte equal to the existing 1.0.0 snapshot.

Unlike published 1.0.0, this snapshot is explicitly a **Working Draft** and may be superseded upstream.

## Drift verification

The dedicated offline test at tests/test_spec_snapshot_1_1.test.ts verifies SHA-256 digests, upstream Git blob IDs, schema identifiers, the working-draft marker, provenance fields, and normalized schema equivalence with 1.0.0. An intentional refresh must pin a new immutable revision and update the evidence and test together.
