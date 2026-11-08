# Versioned compatibility evidence

This matrix records evidence, not alternate instructions for ordinary requests.
Current stable Goose release checked on 2026-11-07: **v1.57.0**, published 2026-10-28
([official release](https://github.com/aaif-goose/goose/releases/tag/v1.57.0)).
Current documentation and observed binaries are separate evidence sources.

| agent-plugin | Host / version | Feature | Evidence | Status |
|---|---|---|---|---|
| 0.6.0, source c95a4a4 | Goose 1.57.0 | Candidate execution and collection | Campaign bb1b3356-064a-41b9-b33f-72eadc54a465: 76 complete executions | Observed; assertion quality not yet accepted |
| 0.6.0, source c95a4a4 | Goose 1.57.0 | Grading | Current grading has technical errors/stagnating attempts | In progress; not accepted |
| 0.6.0 | Goose 1.57.0 | Hook lifecycle activation | No version-bound activation campaign supplied here | Unverified |
| 0.6.0 | Claude / Codex, unspecified | Execution, hook/MCP integration | No observed integration evidence | Unverified |

## Historical source evidence

These rows are retained for explicitly requested historical analysis only. They do
not select defaults, configure a host or establish runtime compatibility.

| Profile | Source commit | PreToolUseResult | Native hook path |
|---|---|---|---|
| `v1.47.0` | `f9c7aaccde4834810dfd13d5efa8f0d39ba28a20` | Absent | `hooks/hooks.json` |
| `main-2b17adc` | `2b17adc33a7176e701c2fef9578a5fc5834ea89a` | Supported, observation only | `hooks/hooks.json` |

Recorded read-only 2026-10-25 from HookEvent/HookManager and lifecycle source.
Do not treat these historical source rows as current defaults or installed-host proof.

## Supported range versus tested versions

Each agent-plugin release should declare a host support range alongside exact test evidence. For agent-plugin 0.6.0, no verified minimum Goose version has been established here: the observed version is Goose 1.57.0, which does not by itself establish `Goose >=1.40.0` or any other open-ended range. A declared range requires a capability-based lower-bound rationale, boundary verification and explicit exclusions/regressions. Exact tested versions remain in the evidence rows above.

## 0.6.1 — terminal schema adaptation (2026-11-08)

Goose release v1.57.0 notes and tagged message schema were inspected before this
adaptation. Official [release notes](https://github.com/aaif-goose/goose/releases/tag/v1.57.0)
and [message schema](https://github.com/block/goose/blob/v1.57.0/crates/goose-provider-types/src/conversation/message.rs)
define camelCase thinking/redactedThinking auxiliary blocks. The previous 0.6.0
adapter rejected all nontext blocks; 0.6.1 accepts valid auxiliaries alongside text,
never using auxiliary payloads as verdicts. Historical omitted responses cannot
establish that this caused their failures. Source revision is the commit carrying
RELEASES.md 0.6.1; no new host version transition is inferred.

| agent-plugin | Host/version | Feature/evidence | Status |
|---|---|---|---|
| 0.6.1 | Goose 1.57.0 | Tagged schema, 48 local judge regressions; 8 process/heartbeat tests; private structural diagnostics | Schema documented; adapter locally tested; live model acceptance unverified |
| 0.6.1 | Goose other versions | No lower-bound/boundary evidence supplied | Supported range not established; unverified |
| 0.6.1 | Claude/Codex | No new judge integration evidence | Unverified |

Linked change record: [0.6.1 notes](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#061--report-overview-and-judge-diagnostics).
Exact observed versions do not imply an unlimited >= range.
