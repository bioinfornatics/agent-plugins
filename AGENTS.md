# Production distribution

This tree is generated installation material. Do not author source here or merge
`develop` into `main`; use the development checkout for source and tooling.
The **0.6.0 candidate is not published** merely because these documents exist.

## Runtime boundary

Node.js **>=22.22.2** is required. Five Skills remain, but only `skill-creator`
has a contained executable runtime. Its existing `scripts/skill-creator.mjs`
launches `agent-plugin evaluation`, `history` and `inspect`. Resolve paths from
that Skill's root, never from application sources, siblings or repository cwd.
No end-user build, npm install, Bun or runtime download is required.

Old creator executables and validation, packaging, grading, scoring, HTML-report
and historical-import commands are retired. No standalone native creator
executable is supplied. Agent, hook, plugin and script-packaging Skills retain
instructions with **migration-pending legacy CLI references**; disclose this and
do not invoke or fabricate their retired commands. Historical references are not
active command authority.

## Evaluation rules

- Read `skills/skill-creator/SKILL.md` and its current README command contract.
- Discover user suites exactly at Skill `evals/evals.json`; Plugin suites belong
  to immediate `skills/*/SKILL.md` children. Skip missing child suites; fail on all
  absent or any present malformed suite. No root suite required.
- Compose repeatable `--skills`/`--plugin` selectors into one deduplicated profile.
  Every scenario treats the whole profile; provenance is not a child selector.
- Dry-run prepares without host calls. Model execution needs explicit authority;
  no monetary cap is implemented. Private HOME/XDG is not an OS sandbox.
- `history`/`inspect` are read-only, not grading or hash-verification commands.
  Resume uses the frozen plan; no selectors or overrides. `--retry-uncertain`
  authorizes fresh uncertain attempts, never bypasses corruption checks.
- Preserve archives, failures and prior attempts. Missing proof is not success.
  Local source/mock checks do not prove native activation or model compatibility.

Repository self-evaluation suites and fixtures are development-only. Do not invent
installed regression inputs or use retained legacy workflow commands. Preserve
contained runtime/resources and never mutate live host installations in tests.
Installation, credentials, push, release and publication require separate authority.
