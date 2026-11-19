# Distribution status

The current installation is the Git-backed main tree, containing independently
installable Skills and the skill-creator Node.js >=22.22.2 launcher/runtime.
See [README](README.md) for installation and [CONTRIBUTING](CONTRIBUTING.md) for development.

The pre-migration Bun creator executables, native archives, tagged native workflow
and local staged installer have been retired and removed from current tooling.
No native compatibility or newly published release is claimed by this cleanup.
Historical compatibility evidence and third-party/vendor sources remain retained.

## Unreleased — native keyring verification (ap-44kd)

Version not yet assigned; classify at publication (backward-compatible fix: PATCH).

- **Fix — macOS keyring consent:** Goose-created Keychain items trust only Goose, so
  reading them through `/usr/bin/security` waits for a user consent dialog. The reader
  now allows 60 s on macOS (10 s elsewhere); choose "Always Allow" or export the provider
  variable for non-interactive runs.
- **CI — native keyring verification:** `native-keyring.yml` writes a synthetic entry with
  keyring-rs 3.6.3 (the library Goose uses) on macOS and Windows runners and reads it
  through the shipped runtime. Windows verified; macOS consent behavior verified.

## 0.10.0 — activation oracle, comparison dashboard, sandbox and keyring credentials

MINOR release before 1.0.0: backward-compatible new functionality and fixes. No
incompatible public-contract change; existing campaigns, grades and exports remain readable.

- **Feature — structural activation oracle:** export attaches an `activation` class to
  selected trials (With: triggered/attempted-failed/direct-read/not-triggered; Without:
  baseline-clean/probe/contaminated; inconclusive for incomplete scans) from the verified
  conversation; the report shows per-condition counts and flags contaminated baselines.
  Scores, deltas and sorting are unchanged (ap-x8p7.3, ap-wxvu).
- **Feature — multi-campaign dashboard:** `scripts/generate-dashboard.mjs` compares at
  least two verified exports side by side; a With-profile delta appears only for
  established comparability (same profile revision, prompt/criteria, judge, host, known
  different configured models). Same-model campaigns are replications, never pooled (ap-r5dg).
- **Feature — opt-in `--sandbox bubblewrap`** (Linux only, `bwrap` required): wraps the
  candidate `goose run`, hiding host `/home`, `/tmp` and `/dev/shm`; network stays shared.
  Sandboxed plans use registry plan schema 4, which older runtimes refuse to resume.
  Not yet verified on a real paid trial (ap-15xv).
- **Feature — baseline-isolation warning:** evaluation warns on stderr when a prompt names
  a profile `<dir>/SKILL.md`; the plan is unchanged (ap-15xv).
- **Fix — regression from 0.9.0:** the private trial environment withheld the desktop
  keyring, so candidate and judge Goose processes using keyring-stored provider keys
  (for example `azure_foundry`) failed authentication. The CLI now reads the Goose
  keyring entry (service `goose`, account `secrets`) with the OS-native store
  (Linux `secret-tool`, macOS `security`, Windows Credential Manager via PowerShell) and
  forwards only the selected provider's absent variables, registered for redaction.
  D-Bus, the keyring itself and unrelated secrets remain withheld; `GOOSE_DISABLE_KEYRING`
  disables the read. Linux reader observed; macOS/Windows readers unverified.
  The forwarded provider key is readable by evaluated code (also under bubblewrap);
  prefer scoped or revocable provider keys.
- **Fix — historical grades** stay readable across judge prose revisions (ap-rcqm).
- **Fix — report viewer accessibility** audit gaps (ap-f1fy).

## 0.9.0 — adversarial review hardening

MINOR release before 1.0.0, including a documented **incompatible change** to the
trial environment (adversarial review 2026-11-19, ap-dmoi).

- **Breaking — private trial environment:** candidate and judge Goose processes
  receive an allowlisted environment (locale/path/proxy/TLS-trust basics, `GOOSE_*`
  settings, and the selected provider's `<PROVIDER>_*` variables) instead of the operator
  environment. `GOOSE_*` names that look secret (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`,
  `CREDENTIAL`, `AUTH`, `BEARER`) or override executables (`*_BIN`, `*_CMD`, `*_COMMAND`,
  `*_EXECUTABLE`, `*_SHELL`, `*_EDITOR`),
  and context/path overrides, are not forwarded.
  SSH agent, D-Bus session (desktop keyring), GPG, npm, GitHub and unrelated tokens
  are never forwarded. Keyring-only or `az login` credentials must be supplied via
  Goose `secrets.yaml` or by exporting the provider variable for the single run; see
  the skill-creator command contract. GitHub Copilot environment credentials are not
  forwarded.
- **Fix — credential detection:** credential-named variables are classified by name:
  flags, booleans, short numbers, file/socket locations and host/endpoint values are no
  longer treated as secrets, which corrupted hashed evidence and blocked the judge (for
  example `FEATURE_TOKEN_CACHE=1`), while password-class values of at least 6
  characters, leading-slash base64 keys, digit-only passwords, dotted tokens and
  credential-bearing URL paths/queries remain redacted.
- **Fix:** `--timeout` above 2147483 is rejected before a campaign starts (dry-run
  too); specific evaluation errors are shown instead of a generic message; judge
  `read_artifact` snaps byte windows to UTF-8 boundaries; the managed report lock is
  released when precommit cleanup fails.
- **New:** `inspect` reports interrupted `<attempt>.pending` publications as
  `Residue` (JSON `residue`, control characters escaped in text), read-only; an
  unreadable campaign root reports `Residue scan unavailable` (JSON `residueScan`).
- **Fix:** `--resume` refuses invalid frozen execution limits before changing registry rows.
- **Docs/Skills:** installed guides rewritten from the current command contract;
  Goose 1.57.0 reported as observed (range not established); nonexistent `old_skill`
  mode removed; skill-creator scenario 1 criteria changed (scores not comparable with
  earlier campaigns); upstream snapshot safety banners.
- Evidence: [compatibility matrix](skills/plugin-creator/references/compatibility-matrix.md#090--adversarial-review-hardening-2026-11-19).

## 0.8.4 — functional Goose Skill loading

PATCH release: instruction and documentation corrections only; no CLI, option,
default or runtime change.

- Routing Skills (plugin-creator, plugin-script-packaging, agent-creator,
  hook-creator) name the functional Goose call: `load_skill` with the installed
  name, through `execute_javascript` `tools.call("load_skill", { name })` when it is
  not a direct tool. Goose `load` and `delegate(source:)` resolve recipes,
  subrecipes and agents, never Skills; a direct `SKILL.md` read is disclosed as
  reading, not activation. Fixes an observed misroute to `load` on Goose 1.57.0.
- skill-creator authoring guidance adds functional cross-Skill routing.
- skill-creator evaluation design maps Skill intentions to independent scenario
  evidence (ap-fxyc).
- Static regression test only; natural-activation behavior is not measured. See the
  [versioned compatibility evidence](skills/plugin-creator/references/compatibility-matrix.md#084--functional-goose-skill-loading-2026-11-19).

## 0.8.3 — current CI actions and Node LTS

PATCH release: updates CI infrastructure without changing CLI behavior or the
supported Node.js runtime minimum (22.22.2). CI pins Node.js 26.13.0 LTS;
GitHub Actions use their declared Node24 runtime independently.

- Latest stable full-SHA action pins: checkout 7.0.1, setup-node 7.1.0,
  setup-python 7.1.0, upload-artifact 7.0.2 and download-artifact 8.0.2.
- Disable automatic npm caching and preserve the authenticated canonical ZIP
  artifact transport, checkout refs, permissions and approval/provenance gates.
- Official release manifests and Node release index inspected 2026-11-10.
  Local Node26 build/tests/typecheck/lint and CI contracts verified; GitHub action
  execution and artifact-service round trip require exact-source CI evidence.
- No Goose update or new host-support commitment is introduced. See the
  [versioned compatibility evidence](skills/plugin-creator/references/compatibility-matrix.md#083--ci-toolchain-update-2026-11-11).

## 0.8.2 — conditional Skill context and host identities

PATCH from published 0.8.1: backward-compatible instruction, routing and
documentation corrections. CLI defaults, schemas, host protocols and installation
prerequisites are unchanged.

- Keep shared safeguards visible while selecting host-specific and independent
  workflow detail only when needed. Hook Creator moves its Goose procedure to a
  conditional reference; Plugin Creator separates portable format from Goose integration.
- Skill Creator owns evaluation orchestration and exact command/report contracts;
  other specialists hand off without duplicated invocation or monitoring guidance.
- Distinguish target host, authoring harness, observed test host, candidate/judge
  execution identities and packaged language runtimes. Agent Creator remains Goose-only.
- Preserve native activation ambiguity guards, full/partial evaluation boundaries,
  default-selection policy, immutable historical evidence and all existing suites.

Compatibility: [0.8.2 evidence](skills/plugin-creator/references/compatibility-matrix.md#082--conditional-skill-context-2026-11-11).
Local acceptance: separate source reviews, 23 static regressions, four format
validations, contained links and source-inventory checks on Node.js 22.22.2/Linux.
The command contract and Agent Creator role procedure are byte-preserved. Natural
discovery, actual conditional loading, host activation and measured quality/token
gains remain unverified. Canonical exact-source CI is required before publication.
Source revision is the commit carrying this record; publication is separate.
Matching annotated v0.8.2 tagging requires explicit authority and must point to
the verified generated main commit, not the authoring source.

## 0.8.1 — source-backed Skill authoring assessment

Distribution 0.8.1 (main 7da8c4d, tag v0.8.1) also includes the hook answer
citation correction below, which its source notes labeled "Unreleased".

PATCH from the published 0.8.0 distribution: backward-compatible authoring,
instruction-clarity and documentation corrections; no CLI, runtime, storage,
installation prerequisite or host-protocol change.

- Bundle a dated 26-page prompt/context/Skill-authoring synthesis and 41-rule
  checklist in skill-creator. Apply it before creation drafting, to actual-source
  audits and evidence-led improvements, and on the final candidate.
- Require functional Markdown hierarchy plus XML content boundaries as repository
  authoring policy. This is not portable schema validity or a universal measured gain.
- Clarify reporting, missing-input handling and reference path bases across five
  Skills; preserve action authority, current defaults and component responsibilities.
- Correct universal tool-name and unbounded-iteration advice. Preserve the existing
  hook-reference provenance cleanup without changing hook behavior.

Compatibility: [0.8.1 evidence](skills/plugin-creator/references/compatibility-matrix.md#081--source-backed-authoring-assessment-2026-11-10).
Local instructions-only acceptance includes independent review, 18 distribution
regressions, two targeted production tests, five format validations, source inventory
and a five-source dry-run. Planned trials are not model execution. Natural discovery,
full-bundle safety, hybrid/ablation efficacy and host integration remain unverified.
Version-display/release metadata changes are verified separately before publication;
canonical exact-SHA CI remains required. Source revision is the commit carrying this
record. The matching annotated v0.8.1 tag must target the verified generated main
commit; no tag, completed release or publication is implied by these source notes.

### 0.8.1 — hook answer citations and dated source provenance

- Hook event/blocking explanations explicitly cite the selected host's official
  documentation in the delivered answer, with source date and runtime-evidence limits.
- The retained Goose v1.57.0 release is labeled as a dated observation, not timeless
  "latest". Documentation and release freshness are independent; existing evaluation
  criteria and historical evidence are preserved.

[Compatibility evidence](skills/hook-creator/references/compatibility-matrix.md#citation-and-dated-release-clarification--2026-11-09).
Instruction-only source correction (e17fea4, PR #73), first published in
distribution 0.8.1 (main 7da8c4d); no host-version transition, model rerun or
lifecycle activation is claimed.

## 0.8.0 — campaign-owned report defaults

New report-storage capability and changed default destinations before 1.0 require
a minor increase from published 0.7.0 to 0.8.0. Export `--output` is optional:
the validated recorded campaign directory owns stable `report/export` and
`report/review.html`, including custom and historical campaign paths. No report
UUID directories or separate reports root are created.

- Regenerate authenticated managed outputs while preserving immutable evidence
  and judgments. Explicit export/HTML destinations remain new and exclusive.
- Authenticate private ownership markers, exact inventories and HTML hash receipts
  under a shared lock. Precommit ordinary failures preserve the previous view;
  postcommit cleanup failures return success with a generic inspection warning.
  Residue blocks regeneration; no automatic repair or crash atomicity is supplied.
- Export and HTML generation remain separate: export replacement leaves existing
  HTML unchanged until the helper regenerates it. Explicit grade IDs remain required.
- Skills use tool defaults throughout the workflow and link commands from nested
  `references/`; candidate preparation still needs a destination without a default.

Compatibility: [0.8.0 evidence](skills/plugin-creator/references/compatibility-matrix.md#080--campaign-owned-report-defaults-2026-11-09).
Local source, contained-helper and runtime mechanics are independently accepted:
376 app tests, 12 helper tests, and 15 each distribution/production tests passed.
One optional upstream test and five browser tests skipped. No new host transition,
paid provider qualification, live installation, or browser appearance claim follows.
Source revision is the commit carrying this change record; publication is separate.

## 0.7.0 — Hive campaigns and frozen candidate models

**Breaking storage contract before 1.0:** all new CLI campaign evidence uses
`profile=<id>/model=configured-<digest>/campaign=<uuid>` partitions. Evaluation
`--output` changes only the root, never the Hive layout. Existing campaigns and
recorded paths are not migrated. Default/requested-only historical partitions remain.
This requires a minor version increase from published 0.6.2 to 0.7.0.

Skills omit optional execution/storage flags unless the user explicitly requests
an override; durable campaigns are not autonomously placed in `.artifacts`.

Source candidate 0.7.0: freeze configured provider/model per host, key new campaign
partitions by configured identity, bind exported overview models and show configured
identities separately from selected session observations. Distinct configured defaults
no longer pool in quality-only benchmarks. Legacy paths, absent identities, grades
and reports remain frozen; no regrading or publication is implied.

Inspected Goose 1.57.0 environment docs and tagged providers.rs on 2026-11-09;
no host version transition is inferred. Local source/mock checks
cover projection and binding; native/provider integration and supported range remain
unverified. [Compatibility evidence](skills/plugin-creator/references/compatibility-matrix.md#configured-candidate-identity--ap-h8f6-2026-11-09).

## 0.6.2 — reliable grading and partial comparisons

- Validated verdicts no longer pass through the raw diagnostic JSON scanner. Safe
  escaped prose and exact citations are preserved; known credentials remain
  protected, with unsafe rationale omitted independently of the verdict.
- The judge receives a bounded, authenticated structural tool-event index with
  exact request/response IDs. Mentions, listings and wrapper code alone are not
  consultation proof; incomplete scans cannot establish absence.
- Overview cards show With/Without coverage and inconclusive states together when
  judge attribution is unique. Baseline-only partitions display their own score;
  resolved historical grading errors remain in Details.
- Future plugin-creation criteria distinguish supported consultation claims from
  artifact quality. No-plugin baseline absence is expected, not a quality defect;
  frozen suites and historical grades are not rewritten.

Compatibility: see [0.6.2 evidence](skills/plugin-creator/references/compatibility-matrix.md#062--grading-reliability-and-evidence-access-2026-11-09).
Local source/runtime/browser regressions are verified; the structural reader has
not been exercised by a live model campaign. The 22 authorized regradings on Goose
1.57.0 used the sanitization repair before the structural-reader addition: no new
technical failures, 19 decisive and 3 inconclusive outcomes. This is not calibrated
judge-quality or cross-version compatibility proof. No npm/native release is
supplied. The v0.6.2 tag must target the verified promoted main distribution.

## 0.6.1 — report overview and judge diagnostics

- Explicit source Skill/Plugin identity and complete frozen campaign overview, with
  candidate and judge model provenance kept separate.
- Compact attention-first cards, raw ascending score bands, unavailable scores first,
  closed supporting artifacts and a space-reserving feedback dock.
- Strict exports require source metadata and overview.json; re-export retained grades
  without rerunning models to use the current report helper.
- Goose terminal text accepts valid thinking/redactedThinking auxiliaries; strict
  prompt, tool-request, JSON, hash and quote validation stays enforced.
- Safe structured judge diagnostics preserve stages, process facts and omission
  causes without message/thinking payloads; existing grades are unchanged.

Compatibility: see [versioned evidence](skills/plugin-creator/references/compatibility-matrix.md).
Local regression verification is not a claim that all historical grading failures
are fixed. Native/model efficacy and unknown effective model identity remain separate.
Git distribution uses main; the v0.6.1 distribution tag must target its verified
promotion commit, not an authoring tree. No npm or native archive release is supplied.
