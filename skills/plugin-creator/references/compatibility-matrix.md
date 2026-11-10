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

## 0.6.2 — grading reliability and evidence access (2026-11-09)

No host-version transition is introduced: this fixes adapter post-processing and
adds bounded evidence navigation for the inspected Goose 1.57.0 conversation
shape. Source revision is the commit carrying RELEASES.md 0.6.2, not the frozen
0.6.1 candidate evaluated by campaign 6ed04ce6-da89-4cb4-ba01-1f2500f99c65.
The initial 108 candidate trials completed; 22 explicitly authorized regradings
used the sanitization repair and produced 19 decisive/3 inconclusive outcomes with
no technical errors. Later reader/UI changes did not rerun or alter these grades.

| agent-plugin | Host/version | Feature/evidence | Status |
|---|---|---|---|
| 0.6.2 candidate | Goose 1.57.0 | Sanitization repair: 22 retained-candidate regradings; exact evidence validation remains | Observed regrading mechanics; efficacy/calibration unverified |
| 0.6.2 candidate | Goose 1.57.0 schema; fake host | Structural request/response indexing, 110 local judge tests | Locally tested; live model use of new reader unverified |
| 0.6.2 candidate | Chromium, local report | Partial comparison cards and exact navigation, 9 browser tests | Locally tested; not host integration evidence |
| 0.6.2 | Goose other versions; Claude/Codex | No boundary or new integration evidence | Unverified; no supported version range established |

The declared supported host range remains unestablished: one observed exact
version does not justify an unlimited `>=` commitment. Known credentials remain
protected, but unknown secrets and arbitrary encodings are outside the guarantee.
Linked change record: [0.6.2 notes](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#062--reliable-grading-and-partial-comparisons).

## Configured candidate identity — ap-h8f6 (2026-11-09)

Source candidate 0.7.0, revision: the source commit carrying the 0.7.0 change
record. No host version transition is introduced. Inspected [official environment docs](https://block.github.io/goose/docs/guides/environment-variables/)
and [tagged providers.rs](https://github.com/block/goose/blob/v1.57.0/crates/goose/src/config/providers.rs)
on 2026-11-09: environment `GOOSE_PROVIDER`/`GOOSE_MODEL`, structured
`active_provider`/`providers` configuration and flat legacy keys determine configured
identity. Preserve this precedence and freeze only identity, never provider settings.

| agent-plugin | Host/version | Feature/evidence | Status |
|---|---|---|---|
| 0.7.0 source candidate | Goose 1.57.0 | Configuration-resolution source inspection; overview/export/model-attribution regressions | Documented; source/local mock verified; native/provider integration unverified |
| 0.7.0 source candidate | Goose other versions; Claude/Codex | No boundary verification | Unverified; supported range unestablished |

Session-export provider/model fields are observations, not actual backend proof.
No unlimited `>=` support commitment follows. Linked [0.7.0 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#070--hive-campaigns-and-frozen-candidate-models).

## 0.8.0 — campaign-owned report defaults (2026-11-09)

No host-version transition or host protocol change is introduced. Source revision
is the commit carrying the 0.8.0 change record. The supported host range remains
unestablished; prior exact Goose 1.57.0 observations are retained above and do not
establish an unlimited range for this feature.

| agent-plugin | Host/runtime | Feature/evidence | Status |
|---|---|---|---|
| 0.8.0 source candidate | Node.js 22.22.2; fake hosts | Recorded campaign export defaults, receipt-bound HTML regeneration, failure/security tests; app 376, helper 12, distribution 15 and production 15 passed | Local mechanics tested; independently accepted |
| 0.8.0 | Goose 1.57.0; other Goose versions; Claude/Codex | No new live model/activation verification for report change | Host/provider integration unverified; supported range unestablished |
| 0.8.0 | Browser | Five optional browser tests skipped | Appearance/interaction unverified for this candidate |

Export and HTML are separate committed derived operations, never evidence rewrites.
No crash atomicity or hostile-filesystem protection is claimed. Linked
[0.8.0 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#080--campaign-owned-report-defaults).


## 0.8.1 — source-backed authoring assessment (2026-11-10)

No host-version transition, host protocol, CLI or runtime change is introduced.
This source revision is the commit carrying the 0.8.1 release record. The declared
supported host range remains unestablished; retained exact Goose observations do
not establish a new minimum or unlimited range. Prompt/model sources are dated
recommendations, not host compatibility proof.

| agent-plugin | Host/runtime | Feature/evidence | Status |
|---|---|---|---|
| 0.8.1 source candidate | Node.js 22.22.2; Linux | Contained 41-rule guide; five Skill entrypoints; independent static review; distribution18, targeted projection2, format5 and inventory checks; five-source dry-run | Authoring content and local projection tested; dry-run is not model execution |
| 0.8.1 | Goose 1.57.0; other Goose versions; Claude/Codex | No new live model/activation campaign for this instruction change | Integration and supported range unverified |
| 0.8.1 | Target models unspecified | Markdown/XML authoring pattern and dated vendor prompting guidance | Policy/documentary support; causal quality/token/cost benefit unverified |

The existing hook-reference provenance cleanup preserves dated observations rather
than teaching them as the latest runtime. No event/blocking contract is changed.
Linked [0.8.1 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#081--source-backed-skill-authoring-assessment).
Canonical CI, generated publication and tagging are separate gates; this source row
claims neither publication nor tagged-release completion.


## 0.8.2 — conditional Skill context (2026-11-11)

This source revision is the commit carrying the 0.8.2 release record. No new host
version transition, protocol or CLI-default change is introduced; retained dated
host sources and historical evidence remain unchanged. Declared supported host
ranges remain unestablished: exact prior observations do not prove an open-ended
range or its lower boundary.

| agent-plugin | Host/runtime | Feature and evidence | Status |
|---|---|---|---|
| 0.8.2 source candidate | Node.js 22.22.2; Linux | Conditional reference ownership, separated identity roles; independent source reviews; 23 static regressions, four format validations, link/inventory checks | Source structure locally accepted; not actual agent loading |
| 0.8.2 | Goose; Claude Code; Codex; OpenCode, versions not executed for this change | Existing host contracts preserved; no new activation/model campaign | Integration and supported ranges unverified |
| 0.8.2 | Candidate/judge models unspecified | Shared safeguards and exact CLI defaults retained | Behavioral preservation and causal quality/token/cost gains unverified |

Linked [0.8.2 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#082--conditional-skill-context-and-host-identities).
Release metadata is not publication/tagging or host-integration evidence.
