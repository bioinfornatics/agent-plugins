# Agent Plugins 1.0.0 conformance matrix

This matrix is the complete acceptance contract for `assets/conformance-fixtures/`. The executable source of expected values is `cases.json`; the test does not infer additional pass criteria. Fixtures are minimal, network-free, read-only inputs and are hash-pinned by the test.

## Outcome vocabulary

| Column | Meaning |
|---|---|
| Portable load | Agent Plugins core loading with declared transports. `partial` means a narrow invalid or unsupported entry is skipped while siblings remain usable. |
| Strict authoring | Portable loading plus repository authoring policy, notably fixed-secret rejection. It is not an extra Agent Plugins requirement. |
| Goose extension | Validation of the distributor-owned `io.github.bioinfornatics.agent-plugins.goose` adapter. `not-applicable` means no Goose namespace is declared. Portable clients merely preserve or ignore extension data. |
| Release | `fail` means deterministic format, semantic, or Goose validation failed. `blocked` means those checks passed, or only an optional transport was skipped, but evaluation, test, review, receipt, or archive evidence was intentionally not supplied. No fixture is release-eligible. |

## Matrix

| Agent Plugins 1.0.0 sections | Fixture | Explicit concern | Portable load | Strict authoring | Goose extension | Release |
|---|---|---|---|---|---|---|
| §§5.1, 5.2, 8.1 | `manifest-exceptions` | Root manifest authority; unknown fields and non-object `extensions` are reported and ignored only while loading. | accepted, two named warnings | partial | not-applicable | fail |
| §§6.1, 6.2, 7.1, 7.2.1 | `fixed-discovery` | Only immediate `skills/*/SKILL.md` and root `mcp.json` count; nested skills and Goose host `.mcp.json` are not portable sources. | accepted; only `skill:good` | accepted | not-applicable | fail (nonportable Goose `.mcp.json`) |
| §§7.1, 7.2.2, 11.3 | `invalid-siblings` | Invalid skill and MCP entries are isolated from valid siblings. | partial; good siblings accepted | partial | not-applicable | fail |
| §§7.2.1–7.2.2 | `mcp-variants` | Closed stdio, Streamable HTTP, and legacy SSE variants. | accepted with declared support | accepted | not-applicable | blocked |
| §§7.2.1, 9.1–9.2 | `env-expansion` | One-pass expansion only in args/env/cwd; unknown placeholders stay literal; clients overwrite reserved runtime variables. | accepted | accepted | not-applicable | blocked |
| §§4.1, 7.2.1–7.2.2 | `paths` | Bare commands are valid; non-`./` paths and invalid cwd forms are server-scoped failures. | partial; `bare` accepted | partial | not-applicable | fail |
| §§7.2.1–7.2.2 | `http-security` | HTTPS, loopback HTTP, headers, duplicate casing, userinfo, fragments, plaintext remote HTTP; likely fixed secrets are separate strict policy. | partial; safe entries accepted | partial; fixed-secret rejected too | not-applicable | fail |
| §§7.2.2, 11.3 | `runtime-failures` | Start/connect/authenticate/handshake failures remain server-scoped and do not disable a healthy sibling. | accepted before launch | accepted | not-applicable | blocked |
| §§7.2.1–7.2.2, 11.2–11.3 | `unsupported-capabilities` | Optional unsupported transport is skipped; an MCP client exposing only SSE fails the standard-transport capability check. | partial; stdio sibling accepted | partial | not-applicable | blocked |
| §§8, 8.1, 11.3 | `goose-extension` | Portable core treats namespaced data as opaque; only the Goose adapter validates and activates its hooks envelope. | accepted | accepted | accepted | blocked |

## Exact assertions

`cases.json` names every expected aggregate status, accepted or absent component, per-component status, diagnostic, expansion result, runtime failure, and client capability result used by the test. The test also asserts:

- every listed fixture exists and no unlisted fixture directory exists;
- every applicable section above is represented;
- fixture files are regular, at most 4 KiB, and match one pinned corpus SHA-256;
- portable and strict outcomes come from `loadPortablePlugin`;
- expansion, path, and HTTP behavior comes from `validateMcpServerSemantics`;
- process environment precedence comes from `authoritativeMcpEnvironment`;
- runtime and capability outcomes come from `mcp_runtime` helpers;
- Goose activation comes from `validate`; and
- release classification uses `verifyPlugin` with deliberately absent release evidence after hard validation failures are excluded.

No network call, subprocess launch, archive creation, fixture rewrite, or hidden manual judgment is part of this suite.
