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

## 0.8.3 — CI toolchain update (2026-11-11)

Source revision is the commit carrying the 0.8.3 release record. This is a CI
infrastructure update, not a host-version or installation-contract change.
[Node release index](https://nodejs.org/dist/index.json) inspected 2026-11-10
identifies Node26.13.0 as LTS. The pinned official action manifests declare Node24.
Exact action versions/SHAs and CI identity are checked in the source CI contracts.

| agent-plugin | Host/runtime version | Evidence | Status |
|---|---|---|---|
| 0.8.3 source candidate | Node.js 26.13.0; Linux x64 | Checksum-verified official runtime; local build, app tests, typecheck/lint and CI/provenance contracts | Locally tested; hosted CI and artifact-service round trip unverified until exact-source execution |
| 0.8.3 | GitHub Actions Node24 | [checkout 7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node 7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), [setup-python 7.1.0](https://github.com/actions/setup-python/releases/tag/v7.1.0), [upload-artifact 7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2), [download-artifact 8.0.2](https://github.com/actions/download-artifact/releases/tag/v8.0.2) and pinned action.yml inspected | Documented; local configuration verified, not hosted action execution |
| 0.8.3 | Goose1.57.0 unchanged; other hosts not executed | No host adapter or instruction change; minimum Node22.22.2 unchanged | Existing limitations retained; declared host support range remains unestablished |

Linked [0.8.3 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#083--current-ci-actions-and-node-lts).

## 0.8.4 — functional Goose Skill loading (2026-11-19)

Observed in a Goose 1.57.0 code-mode session on installed 0.8.3 (source 7d13c23):
an agent called `load(source: "agent-plugins:skill-creator")`, received "not found"
and fell back to direct file reads. This is an instruction-routing gap, not a host
change; no Goose upgrade was involved.

| agent-plugin | Host / version | Feature | Evidence | Status |
|---|---|---|---|---|
| 0.8.3 installed | Goose 1.57.0 | Skill loading tools (code mode) | `load_skill` reachable only through `execute_javascript` `tools.call("load_skill", { name })`; it loaded `agent-plugins:skill-creator` and `agentic-development:cycle`. `load()` listed recipes/agents only and `load(source: <skill>)` returned not found | Observed 2026-11-19 |
| 0.8.4 source candidate | Goose 1.57.0 | Routing instructions name `load_skill`, reject `load`/`delegate(source:)` for Skills | Static regression test in `tests/test_distribution.test.ts` | Static only; natural-activation behavior unverified, no campaign |

Linked [0.8.4 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#084--functional-goose-skill-loading).

## 0.11.0 — code-mode Skill loading in activation trials, ap-qbol (2026-11-20)

No host upgrade was involved; Goose 1.57.0 remains the observed host. This extends
the [0.8.4 observation](#084--functional-goose-skill-loading-2026-11-19) to automated
activation trials and records the inspected upstream source.

- **Documentation** (read 2026-11-20): [Agent Skills](https://goose-docs.ai/docs/guides/context-engineering/using-skills)
  says the Skills platform extension lets goose load a matching Skill during a session;
  [Code Mode](https://goose-docs.ai/docs/guides/managing-tools/code-mode) says tools of
  enabled extensions are discovered through `list_functions`/`execute_javascript`.
  Neither page states whether `load_skill` stays a direct tool in code mode.
- **Tagged source** (v1.57.0, commit 30bba95105e5): `prepare_inference_tools` in
  `crates/goose/src/agents/reply_parts.rs` keeps tools of first-class platform
  extensions in code mode, and `platform_extensions/mod.rs` declares `skills` with
  `unprefixed_tools: true`. By that reading `load_skill` should remain direct.
- **Observed binary:** campaign 9c1cef33-2b34-45e1-9e96-a918133cfa57 request logs list
  `analyze, delegate, edit, execute_javascript, get_function_details, list_functions,
  load, read_image, shell, tree, write`; `load_skill` is absent. The operator session
  shows the same set. The observation contradicts the source reading; the cause is not
  established (a different build path is possible) and no upstream issue was filed.
- **Cause and upstream fix** (inspected 2026-11-20, ap-y2f2): in v1.57.0
  `state_machine/ops_toolcalling.rs` builds inference tools with
  `tools_excluding(skills)`, and `ops_skills.rs` re-adds an ownerless `load_skill` that
  the code-mode filter then drops. [PR #13574](https://github.com/aaif-goose/goose/pull/13574)
  (merged 2026-11-17, first released in
  [v1.60.0](https://github.com/aaif-goose/goose/releases/tag/v1.60.0)) states "Code Mode
  keeps `load_skill` as a direct tool" with test `load_skill_stays_a_direct_tool_in_code_mode`;
  the filter on v1.60.0 and v1.60.2 admits `LOAD_SKILL_TOOL_NAME`. No upstream issue was
  filed because the fix already exists.

| agent-plugin | Host / version | Feature | Evidence | Status |
|---|---|---|---|---|
| 0.10.0 + activation source (PR #98) | Goose 1.57.0 on Linux, code mode enabled, `azure_foundry` | Natural Skill activation in `agent-plugin activation` trials | Campaign 9c1cef33, 12 runs: 6/6 should-not-trigger runs not triggered; 6/6 should-trigger runs first called `load` (not found); 3 attempted-failed, 1 direct read, 2 reached `load_skill` through `execute_javascript` | Observed 2026-11-20; positive activation unresolved under code mode |
| same | Goose 1.57.0, code mode disabled | Natural Skill activation | No campaign | Unverified |
| same | Goose 1.60.0 / 1.60.2, code mode enabled | Direct `load_skill` in code mode | Upstream PR #13574, release notes and tagged source only; no local binary or campaign | Documented; unverified here |
| 0.11.0 (ap-49tf, PR #101) | Goose 1.57.0 | Frozen code mode in campaign provenance (`candidateToolModes`), drift refused before launch | Local fake-host and fake-Goose tests only | Static/local tests; no paid campaign |

Implication: with code mode enabled, should-trigger cases measure the host's tool
routing as much as the Skill description. Activation results are only comparable
between campaigns with the same code-mode setting. New campaigns record it
(`candidateToolModes`, ap-49tf); older campaigns remain unknown.

Linked [0.11.0 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#0110--activation-trials-benchmark-telemetry-and-frozen-code-mode).

## 0.12.0 — Goose 1.60.1 direct `load_skill` in code mode, ap-v26g (2026-11-20)

Host transition Goose 1.57.0 -> 1.60.1 (installed `/usr/local/bin/goose`, Linux).
The upstream fix recorded in the 0.11.0 section ([PR #13574](https://github.com/aaif-goose/goose/pull/13574),
first released in v1.60.0) is now observed locally. No agent-plugin code change is
required: the existing code-mode provenance (`candidateToolModes`) already separates
these campaigns from 1.57.0 ones. Rows in the 0.11.0 section remain historical.

| agent-plugin | Host / version | Feature | Evidence | Status |
|---|---|---|---|---|
| develop aca84ba (0.11.0 + adversarial-skill-review) | Goose 1.60.1 on Linux, code mode enabled, `azure_foundry` / `claude-opus-5-5` (configured), bubblewrap | Natural Skill activation in `agent-plugin activation` trials | Campaign 5cbeea63, same four case IDs and query texts as 9c1cef33, 12 runs: tp 2, fp 0, tn 2, fn 0, unresolved 0. All 6 should-trigger runs called direct `load_skill` first (no `execute_javascript` or `load` detour); 0/6 should-not-trigger runs loaded the Skill | Observed 2026-11-20 (one provider/model, Linux) |
| same | Goose 1.60.0 / 1.60.2 | Direct `load_skill` in code mode | Upstream release notes and tagged source only | Documented; untested here |

Linked [0.12.0 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#0120--adversarial-skill-review-and-goose-1601-code-mode-evidence).

Comparability limits: the skill-creator profile revision differs from 9c1cef33
(d7a5b5ef vs 9f712c9f, later Skill edits) and the queries file hash differs although
every query text is identical, so the delta mixes host and Skill changes. No Without
arm exists in activation trials. Results compare only at equal code-mode setting.

## Goose v1.60.1/v1.60.2 plugin MCP loader source recheck, ap-1189.6 (2026-11-20)

Host transition: recorded commit `dd8de019` -> tags v1.60.1 (`b4e789ef`, installed) and
v1.60.2 (`fb55b5a6`, latest release). `dd8de019` is an ancestor of v1.60.1 (460 commits behind).
Instruction-only adaptation in [Goose integration](goose-plugin-format.md#mcp-activation).

| agent-plugin | Host / version | Feature | Evidence | Status |
|---|---|---|---|---|
| develop `fb8cc6f` (after 0.12.0) | Goose v1.60.1 and v1.60.2 tags | Plugin MCP loader: default `.mcp.json` (`DEFAULT_MCP_CONFIG`), manifest `paths` supplement it unless `exclusive: true`, inline `mcpServers`, required non-empty `command`, stdio only | `crates/goose/src/plugins/mcp_servers.rs` and `plugins/formats/open_plugins.rs` byte-identical at both tags; last loader change b855a1a1 (#13467, 2026-11-13) is a refactor preserving behavior | Documented (tagged source) |
| same | Goose 1.60.1 binary (`/usr/local/bin/goose`, sha256 prefix `d53092508e76af48`), Linux, private HOME/XDG, project-scope `.agents/plugins`, local fake OpenAI-compatible provider (no model, no credentials) | Plugin MCP activation by file | Stub stdio servers wrote launch markers: `mcp.json` alone **not launched**; `.mcp.json` launched; `./mcp.json` with `exclusive: true` launched; `.mcp.json` + unselected `mcp.json` (recommended default) launched `.mcp.json` only; non-exclusive `./mcp.json` + `.mcp.json` with the same server name aborted the session: `Failed to collect extensions: invalid config: extension name 'probe-dup:stub' is already in use` | Observed 2026-11-20 (one binary, Linux); probe harness retained under `.artifacts/ap-1189-probe` |

## 0.10.0 — keyring credentials and candidate sandbox (2026-11-20)

No host upgrade was involved; Goose 1.57.0 remains the observed host.

| agent-plugin | Host / version | Feature | Evidence | Status |
|---|---|---|---|---|
| 0.10.0 source candidate (56135e9, ced8830) | Goose 1.57.0 on Linux, provider `azure_foundry` | Keyring-stored provider key forwarded by the CLI (Secret Service via `secret-tool`) | Judge grade 023cb686 on campaign b92185d5: completed 8/0/0 with no exported credential, 9 successful evidence-reader calls; key absent from 27,689 registry files | Tested 2026-11-19 (one provider, Linux) |
| 0.10.0 source candidate | Goose 1.57.0 on macOS / Windows | Keyring reader (`security` / `CredReadW` target `secrets.goose`) | Unit tests of command construction only | Unverified (ap-44kd) |
| 0.10.0 source candidate | Goose 1.57.0 on Linux | `--sandbox bubblewrap` candidate wrapping | Local fixture tests with real `bwrap`; no paid model trial | Unverified (ap-jlsl) |
| 0.10.0 published (4854933) | Goose 1.57.0 on Linux (bubblewrap 0.12.0), `azure_foundry` | `--sandbox bubblewrap` on a real paid trial | Campaign 617155b5: 2/2 completed, shell tool ran; host checkout, `/home` and `/tmp` hidden, `/usr` visible; key absent from evidence | Tested 2026-11-20 |
| 0.10.0 published (4854933) | Windows (windows-2025 CI), keyring-rs 3.6.3 entry | Keyring reader (`CredReadW` target `secrets.goose`) | Native CI runs 44640663085, 44642247959: exact round trip incl. non-ASCII; only `AZURE_FOUNDRY_API_KEY` forwarded; keyring-rs writer, no Goose binary involved | Tested 2026-11-20 |
| 0.10.0 published (4854933) | macOS (macos-15 CI), keyring-rs 3.6.3 entry | Keyring reader (`security find-generic-password`) | Native CI runs 44640663085, 44642247959: Goose-style item blocks on Keychain consent (`ETIMEDOUT`) non-interactively; any-app item read exactly incl. non-ASCII (hex output decoded since 97448e9) | Reader tested; Goose items require user consent ("Always Allow"); non-interactive unsupported |

Linked [0.10.0 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#0100--activation-oracle-comparison-dashboard-sandbox-and-keyring-credentials).

## 0.9.0 — adversarial review hardening (2026-11-19)

No host upgrade was involved; the change is in agent-plugin's trial environment.

| agent-plugin | Host / version | Feature | Evidence | Status |
|---|---|---|---|---|
| 0.9.0 source candidate (ce0abc6) | Goose 1.57.0, provider `azure_foundry` | Allowlisted trial environment with an exported provider key | Campaign 521c539b (agent-creator, 1 repetition): 4/4 trials completed; raw key absent from evidence. Repeated after the review fixes (name-based credential detection, filtered `GOOSE_*`): campaign 4b4dc372, 4/4 completed, raw key absent; after re-review nits (whole-word credential names, URL userinfo under any name): campaign 62584da3, 4/4 completed, raw key absent | Tested 2026-11-19 (one provider) |
| 0.9.0 source candidate | Goose 1.57.0, provider `azure_foundry` | Azure CLI (`az login`) token exchange in trials | Campaign 285008df: 4/4 failed, `$HOME/.azure` hidden by private HOME (also before this change) | Unsupported |
| 0.9.0 source candidate | Goose 1.57.0, provider `azure_foundry` | `AZURE_FOUNDRY_AD_TOKEN` forwarding | Token reached Goose; endpoint returned 401 for the tested principal | Unverified |
| 0.9.0 source candidate | Goose 1.57.0, other providers | `<PROVIDER>_*` prefix and alias forwarding | Unit tests only | Unverified |

Linked [0.9.0 change record](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md#090--adversarial-review-hardening).
