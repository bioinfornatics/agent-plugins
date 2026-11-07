# Hook instruction → question → criteria → independent proof

Sources: [Skill](../SKILL.md), [hook snapshot](../references/hooks.md),
[recorded target compatibility](../references/goose-target-compatibility.md),
[provenance](../references/UPSTREAM.md). Requests/assertions are in
[the suite](evals.json); operational setup is in [preparation](preparation.md).
This maps guarantees, not task progress or observed model acceptance.

| Instruction/source section | Natural question (case) | Observable criterion / wrong result detected | Independent proof |
|---|---|---|---|
| Component steps 1–2; native paths/manifest | Add exact-command hook to supplied plugin (1) | Same plugin root, unchanged manifest, native hooks/hooks.json and contained executable; no second scaffold | Parse files, compare manifest bytes, resolve handler path/mode; inspect write trace |
| Component steps 3–4; event/matcher | Add exact-command hook (1) | PreToolUse, anchored developer__shell regex rather than glob/unanchored population | Independent regex compilation/table against exact, other and prefixed tool names |
| Component steps 5–7; command/blocking | Add exact-command hook (1) | Safe stdin handling/dependencies/timeout; documented denial vs arbitrary failure | Inspect handler, JSON and executable mode; controller captures inert allow/block results under authority |
| Component step 6; fail-open | Add exact-command hook (1) | Actionable exit-2/block-JSON denial, no mistaken error-as-denial or prohibited retry advice | Exact stderr/stdout/exit comparison and independent delivery review |
| Audit branch; component steps 4,7,8 | Audit unsafe Stop component (2) | Bare-star compilation error and missing executable found without repair/unsafe execution | Independent regex exception/path check, input hashes and tool trace |
| Component step 6; Stop cap | Audit unsafe Stop component (2) | Loop/cap, dependency/spawn/timeout fail-open and recovery limits; proposed tests marked unrun | Source-based semantic review; real Stop lifecycle/cap check remains unverified |
| Verification steps 1–2; literal scope | Test supplied literal guard (3) | block exits 2; allow, padded, metacharacter and nonmatching payloads allow without executing strings | Controller exit/stdout/stderr for each inert file, plus effect trace; not candidate self-report |
| Component step 5; optional/malformed shape | Test supplied literal guard (3) | Missing optional fields, list payload, list tool_input and malformed JSON do not crash/deny | Independent fixed expected exit table; tool-effect observation |
| Verification steps 2–3 | Test supplied literal guard (3) | Regex, Python prerequisite, contained executable checked; narrow literal policy not comprehensive shell security | Direct static inspection and independent report review; no host extrapolation |
| Component step 3; target observation semantics | Can observer stop call on recorded main? (4) | PreToolUseResult cannot reverse resolved decision; handler exit 2/block JSON ineffective here | Independent source-based review of draft and decision semantics; no observer activation |
| Component step 3; observation costs/privacy | Can observer stop call? (4) | Awaited latency/durable-evidence and secret-logging limits surfaced | Independent review against recorded source; durable logging not claimed |
| Component step 1; target compatibility | Does observer work on v1.47.0? (5) | Absent event on older recorded source, no “latest”/binary-label inference or invented validator option | Independent comparison of two recorded rows and response, no deployed-host claim |
| Component step 2; native vs adapter | Older-target deployment question (5) | Native path and adapter structural/activation distinction retained; no silent migration | Source-based response review and zero-write trace |
| Verification step 4; routing/handoff | Prepare whole-plugin relay (6) | Files, matcher rationale, prerequisites, risks and missing receipts passed to plugin-creator | Compare handoff file inventory to inputs; evidence missingness and tool-effect review |
| Tooling/authority boundary | Applicable to 1–6 | No component-validator fiction, source review vs tests vs host vs release distinguished | Tool trace, independent delivery review; no live installation/publication |
| Source refresh/preservation | Applicable to 1–6 | No new format semantics; source snapshots, original fixtures and historical sidecar preserved | Static hashes/diff review; current upstream refresh required for any later contract change |

## Coverage and gaps

Distinct journeys cover creation, unsafe audit, direct handler seam, nonblocking
observation, older-target compatibility and whole-plugin handoff. Missing-manifest
scaffolding and unsupported standalone-hook evaluation are retained instruction
boundaries, not separately rehearsed model cases: no supplied request activates
them here. No real host, paid campaign or independent semantic review has run.
Direct handler tests need separate authority; static preparation does not count as
behavioral proof. Spawn/dependency/timeout failure, Stop cap/recovery, actual matcher
dispatch and event activation remain unverified. Historical original policy and
`run-contract.json` are retained, not applied as current executable constraints.
