# Capability comparison: enhancement research

> Historical research evidence only. External project names, paths and citations identify the inspected sources; they are not product terminology, runtime dependencies or operational instructions. Product behavior and instructions must describe the adopted capabilities in Agent Plugins terminology.

## Question and task

Should this repository be enhanced using ECC, and which improvements fit its purpose? User-requested steps 1–5; Beads **ap-sqt**. “EXX” is interpreted as ECC.

**Conclusion: yes, selectively. Improve diagnostics, compatibility/routing reporting and operational audits; do not turn this focused creator toolkit into a general agent operating system.**

## Goals and Non-goals

- G1: Create feature branch from local development. Created **feat/ecc-category-comparison** at **640a963bb8b74f432fa4b40b56e6685fe32a516e**. No fetch; remote currency is not asserted.
- G2: Map both repositories with evidence-grounded capability categories.
- G3: Assess **10 ECC × 8 Agent Plugins categories = 80 unique pairs**.
- G4: Report enhancement priorities, existing coverage, scope limits and follow-up proposals.
- Non-goals: software implementation, ECC installation, live configuration, paid campaigns, commits, pushes, publication or Dolt sync. No public-format contract changed.

## Sources and affected paths

Inspection: **2026-10-24**, local snapshots only.

| Repository root | Commit | Initial state |
|---|---|---|
| /home/jmercier/Codes/third-parties/ECC | 90606c8315ee09cafc303515c5f33024db6b9882 | main, clean, read-only |
| /home/jmercier/Codes/me/agent-plugins | 640a963bb8b74f432fa4b40b56e6685fe32a516e | development; existing .beads/interactions.jsonl modification preserved |

Method: tracked-file inventories and representative reads of READMEs, manifests, Skills, authoring CLIs, host contracts, hooks, diagnostics, integrity checks and CI. Categories overlap; this is a capability map, **not exhaustive semantic classification of every file**. Dependency trees, generated runtime copies, host projections and translations do not count as independent capabilities. No web refresh or ECC executable was run.

Citations prefixed **ECC:** resolve under its root above; other code citations resolve under Agent Plugins. Dataset entries carry both roots and relative source paths. Pair-specific assessments are static analytical inferences, not runtime verdicts.

### ECC category map

| ID | Category | Representative sources |
|---|---|---|
| E1 | Skills and domain toolbox | `ECC:skills/tdd-workflow/SKILL.md`, `ECC:skills/skill-stocktake/SKILL.md`, `ECC:scripts/ci/catalog.js` |
| E2 | Specialist agents | `ECC:agents/planner.md`, `ECC:agents/code-reviewer.md`, `ECC:scripts/lib/agent-ir.js` |
| E3 | Commands and orchestration | `ECC:commands/plan.md`, `ECC:commands/skill-create.md`, `ECC:workflows/README.md` |
| E4 | Lifecycle hooks and controls | `ECC:hooks/hooks.json`, `ECC:hooks/hooks.metadata.json`, `ECC:scripts/lib/hook-flags.js` |
| E5 | Rules, context and discovery | `ECC:rules/README.md`, `ECC:contexts/research.md`, `ECC:skills/context-budget/SKILL.md`, `ECC:manifests/context-profiles/lean@1.json` |
| E6 | Memory and learning | `ECC:skills/continuous-learning-v2/SKILL.md`, `ECC:scripts/lib/memory-vault.js` |
| E7 | Host adapters and compatibility | `ECC:scripts/lib/harness-capabilities.js`, `ECC:skills/skill-host-compat/SKILL.md` |
| E8 | Installation and diagnostics | `ECC:manifests/install-profiles.json`, `ECC:manifests/install-modules.json`, `ECC:scripts/doctor.js`, `ECC:scripts/lib/install-lifecycle.js` |
| E9 | Evaluation and observability | `ECC:skills/eval-harness/SKILL.md`, `ECC:scripts/eval-harness.js`, `ECC:scripts/skills-health.js` |
| E10 | Security and supply chain | `ECC:skills/security-scan/SKILL.md`, `ECC:scripts/ci/scan-supply-chain-iocs.js`, `ECC:SECURITY.md` |

Language, business, research, scientific and media Skills belong to E1. Host mirrors, schemas, tests, Docker fixtures and multilingual docs support E7–E10. Neither each language nor each directory becomes a required new creator.

### Agent Plugins category map

| ID | Category | Representative sources |
|---|---|---|
| A1 | Skill authoring | `skills/skill-creator/SKILL.md`, `apps/skill-creator-cli/scripts/audit_skill.ts` |
| A2 | Agent authoring | `skills/agent-creator/SKILL.md`, `apps/agent-creator-cli/scripts/agent_format.ts` |
| A3 | Hook authoring | `skills/hook-creator/SKILL.md`, `apps/hook-creator-cli/scripts/hook_format.ts` |
| A4 | Plugin assembly and conformance | `skills/plugin-creator/SKILL.md`, `apps/plugin-creator-cli/scripts/portable_loader.ts` |
| A5 | Executable packaging | `skills/plugin-script-packaging/SKILL.md`, `config/skill-runtimes/skill-runtime-map.json` |
| A6 | Evaluation and governed improvement | `skills/skill-creator/references/improvement.md`, `apps/skill-creator-cli/scripts/trigger_evaluation.ts`, `contracts/capability-contract/HOST_ADAPTER_SPECIFICATION.md` |
| A7 | Safety, privacy and approval | `apps/plugin-creator-cli/scripts/path_containment.ts`, `apps/plugin-creator-cli/scripts/mcp_semantics.ts`, `apps/agent-creator-cli/scripts/privacy_policy.ts` |
| A8 | Reproducible delivery | `scripts/production.mjs`, `scripts/verify-repository-integrity.mjs`, `.github/workflows/development-ci.yml`, `docs/branch-migration.md` |

A1–A5 are the five installable Skills. A6–A8 are cross-cutting apps/, contracts/, scripts/, config/ and test capabilities. Generated skills/*/runtime/ trees are mirrors, not additional creators.

## Observed findings

1. **Different products:** ECC is a broad agent-harness workflow/toolbox system; Agent Plugins is an open-format-first authoring, validation and distribution toolkit. README product descriptions substantiate this distinction.
2. **Inventory, not quality:** direct canonical counts confirm ECC **311 Skills, 71 agents, 97 commands**; Agent Plugins **5 Skills**. Counts agree with ECC README/plugin declarations. Exclude translated/host copies and fixture entries. Breadth does not establish effectiveness.
3. **Existing evaluation and learning:** Agent Plugins already has paired runs, trigger evaluation, receipts, capability preflight and governed evidence-loop revisions. See A6, especially improvement.md and HOST_ADAPTER_SPECIFICATION.md. Do not call these absent; source presence is not full operational proof.
4. **Existing correctness work takes precedence:** Beads ap-dd7 and ap-5o4 are active, with findings recorded by ap-ctb at an older source revision. This comparison did not reproduce those findings against 640a963 or establish fixes. Complete and independently verify that existing program before relying on expanded health summaries. Do not create duplicate repair work.
5. **Distribution strengths to retain:** production.mjs checks inventories/provenance/contained runtimes; config/reproducibility/source-manifest.json declares build closure; development CI checks its exact source checkout and projection/install path. Source inspection does not prove the CI ran here. Repository review rules were not queried; workflow guards alone are not enforced branch protection.
6. **Diagnostic opportunity:** ECC doctor.js exposes drift/missing managed files through a user-facing report. Agent Plugins already has integrity/projection checks, but inspected plugin-creator CLI dispatch has no dedicated doctor command. Consolidated diagnostics can reuse existing machinery rather than invent integrity verification.
7. **Compatibility opportunity:** ECC harness-capabilities and skill-host-compat expose per-host differences and substitution hazards. Agent Plugins already distinguishes portable/Goose contracts and negotiates evaluation-host capabilities. Improve consolidated reporting/lint, not the negotiation protocol itself. Static lint cannot prove host installation or discovery.
8. **Hook operational visibility:** ECC supplies hook IDs/metadata/profile controls. Agent Plugins has hook validation and evaluation attestations. Extend these with side-effect/failure/replay reporting; do not blindly copy ECC host events, commands or payloads.
9. **Security is partly covered already:** containment, MCP policy, privacy, identity and approval mechanisms exist. ECC demonstrates a broader configuration-risk/advisory surface. AgentShield is an external tool described by its security-scan Skill; it was not installed or tested. Integrity hashes do not prove freedom from vulnerabilities.
10. **ECC is inspiration, not a correctness oracle:** lean@1 is explicitly proposed and does not activate a harness; workflows/README labels native Workflow support a pilot with installer wiring outstanding. continuous-learning-v2 includes “100% reliable” language, not independently measured here. Its general Skill validator defaults frontmatter findings to warnings. These limits must survive comparison.

## Hypotheses and discriminating probes

| Hypothesis | Probe | Finding / limit |
|---|---|---|
| Larger catalog means better creator quality | Canonical counts plus both README scopes | Unsupported; counts only establish breadth |
| Agent Plugins lacks evidence-driven improvement | Read improvement.md and host protocol | False at architecture level; correctness/efficacy not benchmarked |
| Installed-plugin diagnostics could improve troubleshooting | ECC doctor versus local CLI dispatch/integrity checks | Plausible extension; needs user failure data and bounded prototype |
| Format validation guarantees host compatibility | Compare host-compat and portable/Goose contracts | False; real-host evidence remains necessary |
| ECC agents/hooks/workflows can be copied directly | Compare manifest layouts and responsibility boundaries | Unsafe assumption; current host mapping and upstream contracts required |

Inventory probes used git ls-files and canonical filesystem globs. CLI behavior was inspected in source rather than running unknown commands. No paid behavioral benchmark, host session or third-party test suite was run.

## Full Cartesian comparison

Legend: **extend** = plausible bounded improvement above current capability; **retain** = existing capability or boundary to preserve; **example** = fixture/scenario inspiration; **out-of-scope** = unjustified product expansion. These labels are inferred recommendations, not software pass/fail results.

| ECC | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 |
|---|---|---|---|---|---|---|---|---|
| E1 | extend | example | example | extend | retain | extend | retain | retain |
| E2 | example | extend | out-of-scope | retain | out-of-scope | extend | retain | out-of-scope |
| E3 | example | retain | retain | retain | example | extend | retain | retain |
| E4 | retain | out-of-scope | extend | extend | example | extend | extend | retain |
| E5 | extend | example | out-of-scope | extend | retain | extend | retain | retain |
| E6 | retain | example | out-of-scope | out-of-scope | out-of-scope | retain | retain | retain |
| E7 | extend | extend | extend | extend | retain | retain | retain | extend |
| E8 | retain | extend | retain | extend | extend | example | retain | retain |
| E9 | retain | retain | extend | retain | retain | extend | retain | retain |
| E10 | extend | extend | extend | extend | extend | example | extend | extend |

Full pair assessments: [comparison.json](comparison.json) (including evidence per pair), [comparison.csv](comparison.csv).

| ECC | Agent Plugins | Relationship | Pair-specific assessment |
|---|---|---|---|
| E1 | A1 | extend | Add bounded catalog stocktake above per-Skill audit. |
| E1 | A2 | example | Use specialist roles as authoring fixtures, not automatically compatible agents. |
| E1 | A3 | example | Use procedures as optional hook requirement examples; no automatic hooks. |
| E1 | A4 | extend | Offer inventory and routing diagnostics, not the entire ECC toolbox. |
| E1 | A5 | retain | Contain script-backed resources in each Skill runtime. |
| E1 | A6 | extend | Add cross-Skill collision and changed-catalog regression scenarios. |
| E1 | A7 | retain | Review imported instructions and resources; breadth is not trust. |
| E1 | A8 | retain | Generate the five declared Skills; do not mirror domain catalogs. |
| E2 | A1 | example | Teach role versus procedure distinctions. |
| E2 | A2 | extend | Use representative planner/reviewer fixtures with conversion constraints. |
| E2 | A3 | out-of-scope | Agent-team execution is not hook authoring. |
| E2 | A4 | retain | Do not assume ECC agents/ installs through portable plugins or Goose. |
| E2 | A5 | out-of-scope | Personas do not need a new executable distribution system. |
| E2 | A6 | extend | Evaluate role/task separation with existing paired agent tooling. |
| E2 | A7 | retain | Role names do not prove isolation or independent review. |
| E2 | A8 | out-of-scope | Do not publish a general specialist-agent catalog. |
| E3 | A1 | example | Use plan/review/verify as authoring scenarios. |
| E3 | A2 | retain | Keep roles distinct from recipes and orchestration graphs. |
| E3 | A3 | retain | Hooks must not silently orchestrate commits or agents. |
| E3 | A4 | retain | Preserve specialist routing instead of duplicated logic. |
| E3 | A5 | example | Workflow CLIs can exercise argument and exit propagation. |
| E3 | A6 | extend | Add incomplete-review/failure regressions, not native Workflow integration. |
| E3 | A7 | retain | Keep approval outside autonomous execution, bound to current artifacts. |
| E3 | A8 | retain | Preserve development flow; do not import ECC release commands. |
| E4 | A1 | retain | Keep event automation separate from procedural content. |
| E4 | A2 | out-of-scope | Do not embed hooks in agent frontmatter. |
| E4 | A3 | extend | Add rule IDs, side-effect summaries and timeout/failure audit output. |
| E4 | A4 | extend | Aggregate optional hook audits under the explicit host adapter. |
| E4 | A5 | example | Dispatchers can exercise signal and failure propagation. |
| E4 | A6 | extend | Add payload replay, disabled-rule and dispatch-failure fixtures. |
| E4 | A7 | extend | Audit consent, input bounds and fail-open/fail-closed consequences. |
| E4 | A8 | retain | Do not activate hooks in distribution tests or projection. |
| E5 | A1 | extend | Audit eager descriptions separately from on-demand bodies. |
| E5 | A2 | example | Use compact role descriptions and explicit discovery assumptions. |
| E5 | A3 | out-of-scope | Do not convert context-budget instructions to default hooks. |
| E5 | A4 | extend | Report creator-selection boundaries and duplicate activation. |
| E5 | A5 | retain | Context budgets do not justify dependencies outside a Skill. |
| E5 | A6 | extend | Measure routing and metadata footprint separately from live token use. |
| E5 | A7 | retain | Bound static audit to the selected root; never scan HOME for live use. |
| E5 | A8 | retain | Keep a small creator surface, not ECC full/lean install profiles. |
| E6 | A1 | retain | Use existing proposal/preview/approval ledger, not automatic instinct promotion. |
| E6 | A2 | example | Treat learned role proposals as untrusted authoring input. |
| E6 | A3 | out-of-scope | Do not add default transcript-capture hooks. |
| E6 | A4 | out-of-scope | Memory service operation is not plugin assembly. |
| E6 | A5 | out-of-scope | Do not add a memory database to each runtime. |
| E6 | A6 | retain | Source-bound improvement ledger already covers governed revisions. |
| E6 | A7 | retain | Confidence is not correctness; preserve consent and project isolation. |
| E6 | A8 | retain | Use Beads, not a parallel ECC task store. |
| E7 | A1 | extend | Lint host-only substitutions while preserving portable instructions. |
| E7 | A2 | extend | Report conversion limits; contract changes require current upstream snapshots. |
| E7 | A3 | extend | Record event/payload support by host; mark unknown explicitly. |
| E7 | A4 | extend | Consolidate manifest/discovery/MCP/hook support in a versioned report. |
| E7 | A5 | retain | Report runtime/OS mode separately from host integration. |
| E7 | A6 | retain | Reuse capability preflight, not a second negotiation protocol. |
| E7 | A7 | retain | Missing safety-required capabilities must block, never silently downgrade. |
| E7 | A8 | extend | Bind real-host installation evidence to source and adapter revisions. |
| E8 | A1 | retain | Whole-directory copying and per-Skill independence already allow selectivity. |
| E8 | A2 | extend | Offer explicit-root read-only discovery diagnostics without installing agents. |
| E8 | A3 | retain | Installation consent is separate from hook authoring. |
| E8 | A4 | extend | Add installed-plugin doctor reusing manifests and integrity checks. |
| E8 | A5 | extend | Diagnose missing dependencies, drift and mixed source/native layouts. |
| E8 | A6 | example | Use clean/drifted/missing installs as diagnostic fixtures. |
| E8 | A7 | retain | No automatic repair/uninstall; preserve user-owned files and containment. |
| E8 | A8 | retain | Keep offline closure and production projection, not ECC installer architecture. |
| E9 | A1 | retain | Keep task artifacts and semantic evidence ahead of lexical checks. |
| E9 | A2 | retain | Reuse paired agent runs and resource telemetry. |
| E9 | A3 | extend | Add replay reporting above existing hook evaluation manifests. |
| E9 | A4 | retain | Keep component receipts distinct from integration evidence. |
| E9 | A5 | retain | Offline/native smoke is not behavioral evaluation. |
| E9 | A6 | extend | Resolve existing correctness review before adding health summaries. |
| E9 | A7 | retain | Missing execution/grading cannot become approval. |
| E9 | A8 | retain | Script existence does not mean either suite passed. |
| E10 | A1 | extend | Add advisory instruction-risk checks without injection-detection guarantees. |
| E10 | A2 | extend | Audit broad permissions separately from format validity. |
| E10 | A3 | extend | Report interpolation, exfiltration and suppressed-failure risks. |
| E10 | A4 | extend | Aggregate existing containment/MCP findings and bounded advisory checks. |
| E10 | A5 | extend | Report vendored versions/advisory provenance without install-time network. |
| E10 | A6 | example | Adversarial hook/MCP fixtures are useful; model grading is not security proof. |
| E10 | A7 | extend | Separate mechanical errors, heuristic warnings and verified vulnerabilities. |
| E10 | A8 | extend | Consider maintained advisory/SBOM reporting alongside integrity manifests. |

## Options and risks

| Option | Benefit | Risk | Decision |
|---|---|---|---|
| Preserve toolkit; add bounded diagnostics/audits | Better author/operator visibility, narrow scope | Duplicate existing checks if not composed | Preferred |
| Import ECC wholesale | Broad content quickly | Host mismatch, discovery overhead, dependencies, consent and maintenance burden | Reject for current scope |
| Add docs/examples only | Low-cost useful journeys | Cannot solve runtime diagnostics | Useful first slice, incomplete solution |
| Add autonomous memory/orchestration runtime | Potential operating-system capabilities | Another product; privacy and task-store duplication | Defer pending explicit need |

ECC is MIT; Agent Plugins is CeCILL-C. Any future copying requires attribution/license review and source provenance. Prefer independently designed requirements over wholesale code import. Preserve self-contained vendored runtimes and no install-time network dependency.

## Requirement gaps (FR/NFR proposed or N/A)

**FR: N/A** — research artifact, not changed user-facing software. Deliverable checks: G1 branch/base SHA; G2 both maps and source-path existence; G3 exactly 80 unique pairs; G4 priorities/limitations and durable follow-ups.

**NFR: N/A for runtime performance.** No latency/cost/token target requested or measured. Existing containment, offline-runtime and source-closure rules remain applicable. Metadata footprint must not be presented as live context usage.

Proposed verification seams, **not approved implementation acceptance**:

| Proposal | Given / When / Then | Required future evidence |
|---|---|---|
| Doctor | Given clean/drifted/missing/mixed install fixtures; when explicit-root diagnostics run; then faults are explained and files remain unchanged | Hashes before/after, symlink tests, source/native layouts |
| Compatibility report | Given unsupported/unknown host components; when audited; then required gaps block and unknown is not verified | Contract fixtures plus separately scoped real-host evidence |
| Routing audit | Given boundary/near-miss prompts for five creators; when evaluated; then intended selection and collisions are distinguished | Frozen cases, equivalent model/tools/budget, activation evidence |
| Hook/security audit | Given bounded approved fixtures; when audit/authorized replay runs; then side effects, failures, validity and advisory risks stay separate | Adversarial payloads, redaction, no untrusted script execution |

Numerical routing, latency and cost thresholds need measured baselines and owner approval. Parent software/release acceptance retains independent review gates.

## Recommendation and unresolved questions

**Yes: enhance selectively, in this order.**

1. **Existing prerequisite, P1:** finish and independently verify ap-dd7 evaluation correctness; ECC comparison does not resolve it.
2. **First new planning slice — ap-1yi, P2:** read-only installed-plugin diagnostics using current distribution/runtime integrity data. Explicit root, human and stable JSON reports, no repair/install/HOME traversal/network. Clearest practical enhancement.
3. **Second planning slice — ap-2mu, P2:** consolidated versioned compatibility report and bounded cross-creator routing audit. Reuse capability-contract/trigger machinery; keep portable format, host integration and OS/runtime support separate.
4. **Third planning slice — ap-ldo, P2:** hook operational audit and vendored dependency security reporting. Separate deterministic errors, heuristic warnings and maintained external advisories. No AgentShield/install-time network dependency.
5. Add representative role/workflow/failure examples within those slices. **No sixth creator Skill or wholesale domain catalog is currently justified.**

The three new Beads features are **open planning proposals, not authorized implementation**. Relative effort is inferred: doctor can compose current checks; compatibility crosses contracts; security needs threat model and independent review. No time estimate, ROI or empirical benefit is claimed.

Unresolved: common user troubleshooting failures; the next genuinely requested host; advisory privacy/threat model; configured repository review rules; empirical routing/performance baselines; attribution/licensing for any chosen reuse.

## Handoff

Artifacts: docs/research/ecc-comparison/research.md, comparison.json and comparison.csv. Beads remains task truth: ap-sqt owns research; ap-1yi/ap-2mu/ap-ldo own proposed planning; existing ap-dd7 unchanged. These artifacts are analysis, not a parallel tracker.

Only research documents/data and their source-manifest declaration are authored here. Pre-existing .beads/interactions.jsonl changes are preserved; bd commands may append local tracking events. ECC unchanged. No commit/push/merge/publication/Dolt sync. Build/full tests and paid behavior evaluation **NOT RUN**: no executable implementation changed. Artifact checks establish structural completeness, not independent security/software acceptance.

Validation performed: both recorded HEAD SHAs match; every category evidence path exists; 80 unique Cartesian pairs exactly cover 10 × 8; CSV, JSON and Markdown assessments agree. Source inventory PASS (2604 declared inputs, zero unknown paths/overlap); git diff --check PASS; node --test tests/test_reproducibility_contract.test.ts PASS (9/9, zero skips). Targeted output: /tmp/ecc-comparison-reproducibility-tests.log; artifact-check helper: /tmp/validate-ecc-comparison.py (temporary aids, not distributed tooling). These are structural/documentation checks, not full runtime or behavioral acceptance.

Resume planning: bd prime; inspect chosen issue and existing corrective work; recheck branch/status/source/permissions; select bounded ownership and independent verification. Feature PRs target development; main stays a generated production projection.

## Reassessment — 2026-10-25, after intervening evaluator corrections

This dated section supersedes the action status above, not the historical 80-pair
comparison or its recorded SHAs. Current feature HEAD is
bbb9c9830f53c03afc5531376ec60670de0bc7fd; ECC remains read-only at its recorded SHA.
The owner accepted the reviewed local/mock scope and authorized bounded follow-up
implementation. No commit, push, publication, personal installation or paid model
campaign is included in the current authorization.

### What to do, and what not to do

1. Do not reimplement the evaluator corrections: current regression evidence and
   recovered independent reports support the local/mock construction. Exact HEAD
   archive verification passed clean reconstruction, production-profile tests,
   production projection and smoke (exit 0). This is a local verification, not remote
   exact-SHA CI or independent release approval. The archive was indexed in a
   disposable Git repository; projected provenance names that temporary commit,
   not the original source SHA. The source SHA is separately recorded in
   .artifacts/ecc-followup/baseline/source-sha.txt.
2. Implement the smallest practical ECC-inspired addition: read-only explicit-root
   installation diagnosis. plugin-creator doctor now checks declared node-bundled
   runtimes and optional distribution inventories. Public CLI fixtures cover intact,
   modified, missing, mixed, unsafe, malformed and limit-exhausted installations.
   Native verification is explicitly unsupported/incomplete. Local integrity does
   not authenticate the publisher. The new candidate still needs its own full
   verification and independent review before ap-1yi closure.
3. Keep ap-2mu focused on consolidated capability reports and collisions/near-miss
   scenarios among five existing creators. Reuse existing preflight and trigger
   engines; do not add a second evaluation or compatibility system. Real-host and
   paid routing evidence require separate bounded authorization.
4. Defer ap-ldo implementation until hook operations and dependency-advisory security
   reporting are separately scoped. No urgent new defect or justification for an
   AgentShield/install-time network dependency was established.
5. Do not import ECC wholesale, add a sixth creator, memory platform or orchestration
   engine. Static capability overlap is not measured behavioral improvement.

### Acceptance and evidence limits

Owner local/mock acceptance is recorded by ap-dd7.10. External provider fidelity,
resource use, natural activation, OS sandbox isolation and measured efficacy remain
unverified. The parent epic remains open. Prior sixth reviewer reports accepted
local/mock content, but clean delegation return failed (ap-dd7.11); Opus disclosed
filtered/control-flow rather than complete line-by-line reading for some upstream
sources, so strict full-reading J2 is not established for both reviewers. Historical
reports are preserved rather than silently rewritten.

Verification artifacts under .artifacts/ecc-followup distinguish committed baseline,
new uncommitted candidate, installed-copy behavior and missing independent proof.
Research JSON/CSV remain the historical 10 x 8 dataset, not a new benchmark.
