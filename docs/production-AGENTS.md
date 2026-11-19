# Production distribution

This tree is generated installation material. Do not author source here or merge
`develop` into `main`; use the development checkout for source and tooling.
The presence of these documents does not prove that any version is published;
check the remote `main` and its matching `v<version>` tag.

## Runtime boundary

Node.js **>=22.22.2** is required. Five Skills remain, but only `skill-creator`
has a contained executable runtime. Its `scripts/skill-creator.mjs` launches the
`agent-plugin` CLI with `evaluation`, `history`, `inspect`, `grading`, `regrading`,
`judgments`, `export` and `validate`. A separate contained helper,
`scripts/generate-report.mjs`, renders HTML from a verified export;
`scripts/generate-dashboard.mjs` compares several verified exports. Resolve paths
from that Skill's root, never from application sources, siblings or repository cwd.
No end-user build, npm install, Bun or runtime download is required.

`validate` checks standalone Skill format only; it does not validate plugin
manifests, hooks or agents, and it does not prove behavior. Old creator executables,
legacy packaging/report commands, historical import and native archives are
retired; no native creator executable is supplied. Agent, hook, plugin and
script-packaging Skills are instructions only; do not invoke or fabricate retired
commands. Historical references are not active command authority.

## Evaluation rules

- Read `skills/skill-creator/SKILL.md` and its
  `references/command-contract.md`; use `--help` for exact syntax.
- Discover user suites exactly at Skill `evals/evals.json`; Plugin suites belong
  to immediate `skills/*/SKILL.md` children. Skip missing child suites; fail on all
  absent or any present malformed suite. No root suite required.
- Compose repeatable `--skills`/`--plugin` selectors into one deduplicated profile.
  Every scenario compares the whole profile with its absence; provenance is not a
  child selector. Comparing versions requires separate campaigns.
- Dry-run prepares without host calls. Evaluation, grading and regrading can call
  models and need explicit authority; no monetary cap is implemented. Private
  HOME/XDG is not an OS sandbox.
- `history`, `inspect` and `judgments` are read-only. Export requires explicit
  grading IDs, never a latest-grade selection, and makes no model calls.
  Resume uses the frozen plan; no selectors or overrides. `--retry-uncertain`
  authorizes fresh uncertain attempts, never bypasses corruption checks.
- Preserve archives, failures, prior attempts and grades. Missing proof is not
  success. Local source/mock checks do not prove native activation or model
  compatibility. Generated HTML embeds selected outputs without redaction; review
  disclosure before sharing.

Repository self-evaluation suites and fixtures are development-only. Do not invent
installed regression inputs or use retained legacy workflow commands. Preserve
contained runtime/resources and never mutate live host installations in tests.
Installation, credentials, push, release and publication require separate authority.
