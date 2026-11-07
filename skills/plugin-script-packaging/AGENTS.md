# Plugin Script Packaging Skill

Follow root instructions; keep this Skill and its references independently copyable.

- Active references govern separately requested external runtimes, not creator/native availability. Retain current normative format sources; remove obsolete workflows rather than treating them as active contracts.
- Do not invent portable dependency fields or vendor schemas. Use a supplied contract or document missing decisions in prose.
- TypeScript, Rust and Python have different runtime closures; Node is not a universal launcher.
- Current shared launcher belongs to skill-creator: Node >=22.22.2, evaluation, history/inspect, standalone Skill validate, explicit grading/regrading/judgments and export. Consult that Skill for exact usage. Creator packaging/install CLIs and native executables remain retired.
- Route manual whole-plugin review and authorized release to plugin-creator. Evaluation is Skills/Plugins only; history/inspect remain read-only.
- New suites use supported fields only. Declare neutral inputs in `files`; verify execution prerequisites separately and keep independent criteria in the suite, not task prompts. Never launch models or touch live installations to validate authoring.
- `evals/inputs/` contains inert task data and a tiny interpreted JavaScript fixture; `evals/verify-fixture.mjs` tests only disposable copies below this Skill. Neither is a distributed application runtime.
- English metadata/instructions; SKILL.md <=500 lines. No hand-edited generated application runtimes.

## Host version policy

Active instructions target current stable host releases and current official documentation.
Do not teach historical version branches unless the user explicitly requests an older target.
Record agent-plugin version, host/version, feature, evidence and verification status in
compatibility matrices instead. A documented capability is not a tested integration;
unsupported or untested hosts remain explicitly unverified. Refresh upstream before
changing public contracts and keep exact runtime versions in execution provenance.

## Host changes, compatibility matrix and changelog

When a host update (Goose, Claude or another supported agent host) is identified as
changing plugin specifications or behavior, inspect its official changelog/release
notes and the affected documentation or implementation before changing the contract.
Record the host version transition, affected feature/specification, concrete impact
and required adaptation in the compatibility matrix, linked from the corresponding
plugin changelog entry. Include agent-plugin version/source revision, exact host
versions, dated upstream sources, verification evidence and status (documented,
tested, unsupported or unverified). Record no relevant impact only when inspected
evidence supports that conclusion; a version bump alone is not a compatibility result.

Maintain the matrix and plugin changelog together for the authorized change. Preserve
historical rows and prior evidence; do not replace an observed version with a vague
"latest" label. A host changelog claim is documented evidence, not a passed integration
test. Keep ordinary Skill instructions on the current supported behavior rather than
adding historical branches. If no plugin changelog/location exists, report that gap
and confirm its destination before creating one; never invent an entry or imply a
release occurred. Missing verification stays explicit and is tracked in Beads.

This maintenance obligation authorizes neither automatic installation/upgrades nor
credentials, model execution, commits, pushes or publication. Apply current task
scope and action-specific authorization before any such operation.

### Compatibility range per agent-plugin version

For each agent-plugin release, state the declared supported host range separately
from exact observed versions, for example `Goose >=1.40.0` (illustrative only, not
an established minimum). A range is a support commitment; derive its lower bound
from the required capabilities and inspected host evidence, record its rationale,
exceptions/upper bound when applicable, and verify the boundary before labeling
it tested. Do not infer `>=` compatibility from one successful newer version.
Keep exact tested host versions and results in separate evidence columns; identify
untested versions within a declared range explicitly. A later host regression must
update the range/limitations and linked plugin changelog rather than silently
retaining an unlimited `+` claim. Unknown lower bounds remain unverified, not guessed.

## Evaluation prerequisites

Launcher scenario requires Node >=22.22.2 and equivalent local execution/symlink capability; use disposable copies, preserve source bytes and report unavailable proof.
