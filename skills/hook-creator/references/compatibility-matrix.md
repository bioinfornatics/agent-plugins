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

## Host inventory research — 2026-11-07

Source checkout is an uncommitted 0.6.0 candidate; no release occurred.

| Host / exact observation | Hook evidence | Status / remaining proof |
|---|---|---|
| Goose stable v1.57.0, official release 2026-10-28 | [12 documented events](goose-hooks.md), live docs inspected separately | Documented; version-bound lifecycle activation unverified |
| Claude Code changelog heading 2.1.319, timestamp not verified | [33 documented events](claude-code-hooks.md); changelog 2.1.318 PostToolUse after interruption and 2.1.319 connector matcher fix inspected | Documented; eligibility/payload/managed-policy gaps and runtime unverified |
| Codex stable rust-v0.167.0, release SHA 086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a | [14 events and hash-trusted hooks](codex-hooks.md); live docs/main and release boundaries explicit | Documented + selected source inspection; integration unverified |
| OpenCode v1.19.5, release SHA 810c0eba1a7348036f8bdf61e6632d0c36c6876c | [Plugin callbacks and event catalogue](opencode-hooks.md); official repository source used after page403 | Documented/source-inspected; deployed docs revision and activation unverified |

Adaptation: ordinary instructions now route by host instead of applying Goose events
and denial rules universally. No prior exact Claude/Codex/OpenCode version baseline
exists here, so no version-transition compatibility claim is inferred. Ranges remain
unverified. No plugin changelog was found in this checkout: a destination must be
confirmed before creating a linked changelog entry for the identified upstream changes.

## Citation and dated release clarification — 2026-11-09

agent-plugin source candidate **0.8.0**, baseline `49bba1f45379c1bcb1339821e239e09174d69140`;
this instruction-only correction is not a publication or host-version transition.

| Host / exact observation | Adaptation and evidence | Status / remaining proof |
|---|---|---|
| Goose v1.57.0, tagged release published 2026-10-28T19:26:10Z; metadata/notes rechecked 2026-11-09 | [Inventory](goose-hooks.md#answer-citation-and-freshness) requires an official citation in delivered event/blocking answers and replaces timeless "Latest stable release" wording with the exact dated observation. [Hooks docs](https://goose-docs.ai/docs/guides/context-engineering/hooks) rechecked separately; twelve-event inventory unchanged. [Tagged notes](https://github.com/aaif-goose/goose/releases/tag/v1.57.0) contain no hook-contract change claim. | Documented + static review; no binary hook activation or model rerun. No new supported range inferred. |

Existing scenario 3 already requires citation and documentation/runtime separation;
its criteria and historical campaign grades remain unchanged. The previously dated
missing-changelog observation is retained; the current source change record is
[RELEASES.md](../../../RELEASES.md#unreleased--hook-answer-citations-and-dated-source-provenance).
