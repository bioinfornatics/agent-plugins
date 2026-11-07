# Agent instruction → question → criteria → independent proof

Sources: [Skill](../SKILL.md), [custom-agent guide](../references/custom-agents.md),
[provenance](../references/UPSTREAM.md). Requests/assertions are in
[the suite](evals.json); setup and authority are in [preparation](preparation.md).
This is a coverage design, not a task tracker or a claim of executed behavior.

| Instruction/source section | Natural question (case) | Observable criterion / wrong result detected | Independent proof |
|---|---|---|---|
| Role vs workflow; guide “When to Use” | Create a dependency reviewer (1) | Reusable supply-chain/compatibility role, not copied task workflow | Blinded semantic review of body for evidence, priorities and uncertainty |
| Author steps 1,3,4; guide “Create an Agent File” | Create project agent (1) | Required name; optional string description/model only; meaningful body; no placeholders | Parse final YAML/Markdown and inspect artifact, not validation self-report |
| Author steps 2,5; guide project paths and “Use an Agent” | Create project agent (1) | Correct sandbox .agents/agents placement; textual invocation; no claimed discovery | Filesystem path/hash plus tool trace and delivery review; no host check claimed |
| Audit branch; author step 4 | Audit invalid-agent.md (2) | Finds tools/permissionMode, distinguishes authoring policy from observed parser rejection | Compare findings with independent field inventory; pre/post input hash and no-write trace |
| Modify branch; author step 3 | Add supply-chain review (3) | Useful addition while preserving compatibility, uncertainty and review-model | Exact frontmatter comparison and independent body diff review |
| Migration; author steps 1–3 | Migrate legacy-reviewer.md (4) | Supported role/model retained, tools/permissionMode/extensions/schedule reported unmapped; original retained | Parse destination, enumerate source unmapped keys, compare original hash; semantic review of routing |
| Placement/overwrite; author steps 2,5 | Place legacy role at supplied location (5) | Reads existing destination and refuses unsupported overwrite; no silent replacement or false success | Setup-gated seeded hash plus read/write records; inspect blocking question |
| Routing; guide scheduled/workflow/MCP FAQs | Weekly parameterized MCP review (6) | Recipe orchestration vs role, session-enabled MCP vs declaration, no mcp.json/frontmatter transport | Independent source-based response review and zero-write/tool-effect record |
| Bundled role boundary; author step 6 | Weekly parameterized MCP review (6) | Does not equate standalone custom role with portable plugin agent discovery | Independent review against recorded guide paths, not plugin-agent activation claims |
| Evaluation branch; tooling boundary | Compare supplied security roles (7) | Standalone agents unsupported; asks for supported Skill/Plugin, no fabricated paired scores or substitute experiment | Tool trace for absence of campaigns/delegation/grading; independent review of missingness statement |
| Routing/loading limits; execution boundary | Applicable to 2,4,6,7 | No invented specialist tool/retired validator; authority not expanded | Inspect tool calls and response against available host capabilities |
| Source-refresh guard; all source-driven decisions | Applicable to 1–6 | Uses recorded constraints, no new public fields/paths inferred | Static source/diff comparison; upstream refresh needed before future contract changes |
| Preservation/evidence; execution boundary | Applicable to all cases | Actual files/checks and gaps reported; authoring never becomes installation/publication/effectiveness | Before/after hashes, tool trace and independent delivery review |

## Scope of proof

This suite covers distinct create/audit/modify/migration/collision/routing and
unsupported-comparison guarantees, not a case-count target. Static JSON/links and
suite dry-run establish preparation only. Case 5 needs external collision setup.
Global operation limits need external observation/enforcement, not scenario metadata.
Live user placement, actual Goose discovery/loading/delegation, unavailable-host
loading fallback and behavioral improvement are unverified; no paid trials or
independent semantic review have run. No public contract change is proposed.
