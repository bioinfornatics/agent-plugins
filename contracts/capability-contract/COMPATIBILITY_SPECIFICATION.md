# Protocol compatibility and migration policy

The additive Goose Usage and Cost Evidence `1.0.0` input/schema and TypeScript APIs are independently versioned package subpaths. Existing surface versions and readers are preserved; unavailable usage and cost remain explicitly null rather than being backfilled into legacy contracts.

`COMPATIBILITY_POLICY_VERSION` is `1.0.0`. The normative runtime registry is `COMPATIBILITY_REGISTRY`; `fixtures/compatibility/expected-public-surfaces.json` is its independently maintained review oracle. The oracle records every public surface's stable ID, owner, exact source file/field/evidence, kind, readable versions, emitted version, support state, deprecation/replacement/migration metadata, and an executable fixture result or explicit non-reader outcome.

## Drift and golden evidence

Tests derive host wire messages and creator `evals/evals.json` forms from producer sources, require exact one-to-one manifest coverage, compare every registry metadata field, and verify each evidence marker against its source. Added, removed, renamed, re-owned, or version-changed surfaces require an intentional manifest and registry change. Every entry has an exact expected outcome. `fixture-hashes.sha256.json` freezes every compatibility and migration fixture byte except the hash inventory itself.

Readers require an explicit surface ID. Versioned JSON is accepted only at the declared version field and range. Unversioned evidence is read only as `legacy-readable` with `COMPATIBILITY_LEGACY_UNVERSIONED`; malformed, missing-version, unsupported, unknown, and ambiguous cases return stable diagnostics and are never inferred.

## Migration preview security

`previewMigration` is dry-run only and exposes no apply or filesystem API. Inputs must declare `entryType`; only `regular-file` is accepted and symbolic links are never followed. Raw paths are rejected before normalization when they contain empty, `.` or `..` segments, backslashes, drive prefixes, absolute syntax, control bytes, or NUL. The only accepted source layout is:

`runs/eval-N/(with_skill|old_skill|without_skill)/run-N/(outputs/<safe-relative>|grading.json|timing.json)`

The only accepted non-source paths are exact corresponding root targets used for conflict detection. Secret-like names/extensions and likely credential/private-key bytes are rejected. Safe operations are deterministic SHA-256-addressed copies, preserve originals, and never mutate input buffers or disk.

## Compatibility policy

- **Supported:** readable and emitted at the listed version.
- **Legacy-readable:** readable only with an explicit ID; original bytes must be retained. These remain readable through compatibility policy `1.x` and at least **2027-09-30**. Removal requires a `2.0` breaking release and a replacement named in the manifest.
- **Unsupported/ambiguous:** fail with an exact diagnostic; never reinterpret.
- Exit/status compatibility is owned by each creator but normatively delegates semantics to `RESULT_CONTRACT_REFERENCE`.

### Significant-site discovery

The producer-discovery.json ledger records every significant source location that constructs, consumes, forwards, or structurally participates in a registered public artifact. Each location has a stable siteId, exact sourceEvidence, and evidenceOccurrences; discovery fails when evidence is added or removed. Filename artifacts are additionally derived lexically. Every site is either a producerSiteAlias linked to one canonical artifact or a structuralExclusion with a non-serialized rationale. Every serialized canonical artifact is registry-linked.

### Migration secret classification

Migration preview applies one centralized classifier before path validation. It classifies both the basename and decoded content. Content candidates include UTF-8 (with or without BOM), UTF-16LE BOM, UTF-16BE BOM, and NUL-interleaved ASCII. GitHub tokens, AWS access/secret/session credentials, Basic/Bearer authorization, JWTs, private-key blocks, and separator/camelCase credential assignments are rejected. If either name or bytes is sensitive, the diagnostic is MIGRATION_SECRET_REJECTED at files/<input-index> and never contains the original path or value. Unsafe non-secret paths remain MIGRATION_PATH_UNSAFE. Migration remains dry-run, copy-only, and has no apply API.
