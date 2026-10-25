# Hook Creator

Native Goose hooks use `hooks/hooks.json`. Read [Goose target compatibility](references/goose-target-compatibility.md) for exact source profiles, PreToolUseResult support and adapter activation limits before creating or validating hooks.

Creates and validates Goose/Open Plugins lifecycle-hook components. The package is
standalone-installable. Tagged native archives require no separate runtime; a source build requires Node.js 22+.

Hooks belong inside a plugin:

```text
<plugin>/
├── plugin.json
├── hooks/hooks.json
└── scripts/handler.sh
```

The source of truth is Goose's
[`guides/context-engineering/hooks`](https://goose-docs.ai/docs/guides/context-engineering/hooks),
vendored as `references/hooks.md`.

## Unified CLI

After building, invoke the CLI directly or through the package's `hook-creator`
bin mapping:

```bash
hook-creator --help
hook-creator init /path/to/plugin PostToolUse record-tool \
  --matcher 'developer__shell' --timeout 10
hook-creator validate /path/to/plugin
```

Common options can appear before or after the command:

- `--format text|json` selects human-readable or machine-readable output;
- `--quiet` suppresses successful output (failures remain visible);
- `--help` or `-h` prints help.

Exit codes are `0` for success, `1` for an operational or validation
failure, and `2` for invalid command-line usage.

### JSON examples

```bash
hook-creator init ./my-plugin PreToolUse policy-check --format json
hook-creator validate ./my-plugin --format json
```

JSON output includes an `ok` boolean and command-specific paths, warnings, or
errors.

## Legacy entrypoints

The original entrypoints remain supported for compatibility:

```bash
hook-creator init /path/to/plugin PostToolUse record-tool \
  --matcher 'developer__shell' --timeout 10
hook-creator validate /path/to/plugin
```

## Reproducible evaluation manifests

Hook evaluations use the canonical format in `references/evaluation-run-manifest.md` and `schemas/evaluation-run-manifest.schema.json`. The same schema applies locally and in CI; verification invalidates receipts after any bound input changes. Host adapters, runners, and graders—like tools—must record exactly one concrete version or an explicit unavailability reason, and retain their declared trust boundary in either case.

## Attested test and evaluation evidence

Use the attestation create and verify CLI commands for DSSE-wrapped in-toto evidence. Local evidence is unsigned and lower trust; production requires an offline-verifiable Ed25519 CI signature and rejects manual tests status. See references/evidence-attestation.md and schemas/evidence-attestation.schema.json.

## Development

The portable Skill contains documentation, references, schemas, and evaluation assets only. Develop and test the TypeScript CLI separately:

```bash
(cd apps/hook-creator-cli && npm install && npm run build && npm test)
```

Tagged staging injects the native executable as `skills/hook-creator/scripts/hook-creator` (`.exe` on Windows); never write build output into the source Skill.

## Use with Goose

```text
Load agent-plugins:hook-creator and add a PostToolUse hook to /path/to/plugin
that records shell tool usage. Validate its matcher, command, and referenced
files, and explain any security implications.
```

A hook is evaluated through focused handler tests and, when whole-plugin
behavior is requested, integration scenarios coordinated by
`agent-plugins:plugin-creator`. Blocking hooks such as `PreToolUse` require an
explicit side-effect and failure-mode review.

## Scope

- Hook creation and hook-specific testing: this skill.
- Complete plugin assembly and packaging: `plugin-creator`.
- Skills: `skill-creator`.
- Custom agents: `agent-creator`.

## Identity-bound production approval

Production uses hook-production-approval/v1 and the CLI approval commands. Automated passing evidence only creates a pending request. Reviewer ID, RBAC-ready role, rationale, accepted risks, waivers, timestamp, and Ed25519 signature are retained. Artifact, archive, manifest, benchmark, test, and review hashes are immutable; any changed input is stale. Deploy/install integrations use read-only approval consume with exact bindings and cannot create approval. See references/production-approval.md and schemas/production-approval.schema.json.
