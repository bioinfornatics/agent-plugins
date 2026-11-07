# Instruction → question → criteria → proof

This is scenario design evidence, not a task tracker. The [suite](evals.json)
contains nine natural requests. The [preparation protocol](preparation.md) keeps
setup and execution governance outside prompts and identifies environment gates.
Criteria are independent assertions, not answers supplied to the task agent.

| ID / source instruction | User question / wrong observable result detected | Criteria | Proof oracle |
|---|---|---|---|
| 1 — [SKILL create route](../SKILL.md#select-the-requested-workflow), [authoring steps 2–5](../references/authoring-workflow.md) | Create the supplied notes package; detects manifest-only output or fictitious MCP implementation | Canonical manifest + usable immediate Skill + closed stdio declaration; external prerequisite and honest findings | Parse produced JSON against recorded schemas; inspect Skill frontmatter/body and path inventory; independent semantic review of usability and report; tool events for actual handoff |
| 2 — [portable decisions](../references/portable-conformance.md#separate-the-decisions) | Audit the mixed-validity draft; detects conflating tolerant loading, strict schema and readiness | extraLabel ignored by tolerant loader but schema-invalid; malformed stdio isolated from Skill; missing version optional in schema but readiness gap | Compare exact fixture facts to recorded schema required/additionalProperties and MCP variants; inspect report per-component findings; pre/post hashes prove no edits; no self-reported validator pass |
| 3 — [author/migrate steps 1–6](../references/authoring-workflow.md), [native hooks](../references/goose-target-compatibility.md#native-versus-adapter) | Migrate the legacy package; detects lost originals or invented portable agent/adapter activation | Separate destination; complete preservation; canonical Skill/MCP; native hooks retained; unsupported UI/custom agent classified | Full source byte/hash inventory before/after; destination manifest/MCP/Skill parse; native hook path inventory; independent review of mapping notes and unresolved selection |
| 4 — [MCP governed selection](../references/portable-conformance.md#mcp-migration-and-selection) | May both documents coexist? Detects unconditional no-co-ship policy | One default .mcp.json activation allowed; portable versus Goose distinction; no running-host claim | Inspect manifest with no extra selection, both exact MCP documents and source-backed report; semantic review of selection/transport explanation |
| 5 — [SKILL MCP guards](../SKILL.md#format-and-host-guards), [governed selection](../references/portable-conformance.md#mcp-migration-and-selection) | Is ambiguous package ready? Detects guessed precedence or silent repair | Non-exclusive path plus default flagged; host-only field distinguished; readiness blocked pending approval | Inspect exact false exclusive flag and adjacent files; source/report comparison; input hashes and tool events prove audit-only scope |
| 6 — [archive steps 1–5](../references/archive-workflow.md) | Prepare an archive from the supplied inert draft; detects unchecked/incorrect-root archive or forced full-eval | Correct root and canonical entries; no templates/extras; observed integrity/content checks; preserved input | Archive listing/integrity tool output, entry byte hashes versus supplied draft with canonical names, original hashes; exact blocker if tooling/setup unavailable; report semantics do not establish host proof |
| 7 — [SKILL tooling boundary](../SKILL.md#current-tooling-boundary) | Prepare a new plugin from the supplied draft and observe its dry-run; detects obsolete full-eval or root integration discovery | Current shared evaluator; one immediate child suite; whole-profile absence comparison; no models/grades | Produced new canonical plugin inventory and unchanged source hashes; actual contained-launcher dry-run JSON and exit status with notes/1 included, integration/99 absent and six default trials; tool events for zero model execution. Proposed commands/blockers do not pass observed delivery |
| 8 — [installation review steps 1–4](../references/installation-diagnostics.md) | Give installation guidance; detects invented commands or implicit installation | Current official/repository sources consulted or access gap; unknown host disclosed; no live effects or end-user authoring builds | Source/tool records for actually consulted docs and exact commands; filesystem/process events for guidance-only scope; independent review of caveats; unavailable sources do not count as verified guidance |
| 9 — [native/adapter boundary](../references/goose-target-compatibility.md#native-versus-adapter) | Can the supplied adapter activate on v1.47.0? Detects structure mistaken for loading | Native hooks/hooks.json identified; adapter not upstream-ratified; no silent migration; source profile versus binary distinction | Exact supplied envelope/path inventory and recorded loader evidence compared with report; unchanged hashes; real lifecycle proof is explicitly absent |

## Static verification and actual gaps

Required static checks: JSON/unique safe integer IDs, nonempty short prompts and
assertions, allowed fields only, input containment and reserved-name rejection,
coverage tags/dimensions, active local links, SKILL.md <=500 lines and lossless
archive SHA-256 inventory. Source suite dry-run should prepare nine scenarios and
54 logical trials at defaults (one Goose host, two arms, three repetitions), with
zero unsupported constraint diagnostics. Observed source dry-run matches these
counts; this is preparation evidence, not a behavioral claim.

The original rejected five-case suite remains losslessly outside discovery in
[the historical archive](../references/historical/pre-ap-9ato/INDEX.md). It is not
counted as ready coverage. Existing legacy fixture/evidence assets are preserved;
new neutral inputs do not depend on them or treatment resources.

No candidate models, independent semantic grading, real installation, MCP startup,
hook lifecycle execution, task-agent archive delivery or campaign effectiveness comparison
were run for this rewrite. Cases 6/7 prepare their outputs as the requested task from captured inert drafts;
no hidden pre-trial copies or setup hook are needed. Equivalent filesystem/archive
tools and current skill-creator guidance/launcher in both native arms remain
unverified. Case 7 requires observed dry-run, not an accurately proposed command. Case 8 needs current source
access for verified commands. These are explicit proof gaps, not green outcomes.
Remote transport semantics, permission-sensitive blocking behavior, malicious
archive extraction, actual rollback and multi-host compatibility are not measured
by this suite. Existing recorded format/host constraints were reused, not refreshed
or broadened.

## Observed checks for this source slice

Node.js v22.22.2, from repository root unless noted:

- Static Python inspection: 9 unique cases, supported fields, short prompts,
  nonempty assertions, matching coverage tags, 28 declared captured input files,
  reserved-name/symlink/containment checks, 47 active local links and 69 SKILL lines:
  pass. All 18 archived original byte counts/SHA-256 values match inventory.json.
- `node skills/skill-creator/scripts/skill-creator.mjs validate <absolute-plugin-creator-root>`:
  “Skill format valid; extensions not validated: none”. This validates the Skill,
  not plugin manifests or host activation.
- From apps/agent-plugin, `node src/index.ts evaluation --skills <absolute-plugin-creator-root> --dry-run`:
  prepared schemaVersion 3; 9 scenarios, 54 candidateRuns/logical trials, with/without
  conditions; defaults Goose, 3 repetitions, 50 turns, timeout 0, parallelism 3.
- Direct source FilesystemEvaluationSource.load plus assertExecutableScenarios:
  pass for plugin-creator/1 through /9, 28 captured files and 0 unsupported diagnostics.
  No candidates were executed.
- One exploratory dry-run output summarizer failed with AttributeError because it
  assumed trial.scenario was an object; it is an ID string. Corrected summary and
  direct public import checks passed. This was a check-script error, not a suite failure.

No generated/runtime scripts, schema JSON bytes, external skill roots, Git/tracker
state or live installations were modified by this worker. The schema snapshot README
now describes manual review; its original bytes are retained in the historical archive.
Hashes recorded during inspection identify current schema bytes only; they do not
constitute an upstream refresh or independently authenticated provenance check.

## H2/M3 correction checks

- Cases 6/7 now request preparation from captured inert drafts at their actual
  `evals/inputs` paths, with explicit new deliverables. No hidden external setup
  or assumed ready root directories remain. Case 7 requires observed dry-run.
- Node v22.22.2: source suite dry-run exit 0, `status: prepared`, schemaVersion 3,
  9 distinct scenarios, `candidateRuns: 54`, 54 trials. Top-level short fields are
  status/schemaVersion/options/profile/candidateRuns/trials; trials contain string
  scenario IDs, not scenario objects.
- Authorized temporary deterministic check: package (3 files) and comparison
  (4 files) materialized with canonical names; complete bytes/modes/inventories
  match the drafts, and all 28 original input hashes/modes remain unchanged.
  Ordinary Python zipfile integrity, exact three rooted entries and archive byte
  hashes pass. Temporary artifacts were cleaned; this is not task-agent behavior.
- Comparison direct FilesystemEvaluationSource discovery yields exactly notes/1.
  The current contained launcher `evaluation --plugin <temporary-comparison>
  --dry-run` exits 0: prepared/schemaVersion 3, candidateRuns 6, six with/without
  trials. Composed CLI scenario IDs are fingerprint-namespaced, not literal
  notes/1: the first check incorrectly assumed literal IDs and failed; corrected
  source-seam plus CLI checks pass. Integration case 99 is absent.
- Current contained launcher standalone Skill validate passes. Static short
  prompts (<240 characters), unique IDs, actual target paths, contained inputs
  and absence of reserved input entrypoints/symlinks pass.
- M3 snapshot README now describes recorded manual format sources, not a current
  TypeScript plugin validator. Original retained: 415 bytes, SHA-256
  `7bc7f1739710ed14b58aa96cd4903143dd5322e603e1b08949815e2625f01b45`.
  Schema JSON bytes are unchanged; no public format contract was refreshed.

Equivalent current guidance/launcher and archive/filesystem tools in both native
arms are still unverified. These deterministic checks do not establish candidate
performance, native host compatibility or campaign outcomes. No models or campaigns
were run; no Git, runtime, live-installation or other-root writes were performed.
