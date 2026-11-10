# Plugin Creator authoring boundary

Read repository instructions before edits. Keep metadata/instructions English,
descriptions concise and third-person, and SKILL.md <=500 lines. Write only the
approved files and preserve pre-existing work.

- `references/portable-plugin-format.md` owns common portable format;
  `references/goose-plugin-format.md` owns conditional Goose integration, consumed
  only for a Goose target or existing Goose migration/review. Keep native/ambiguous
  activation guards at authoring, archive and installation selection steps.
- SKILL.md owns the concise available skill-creator evaluation handoff and role
  distinctions; exact commands/defaults/reporting remain with that loaded owner,
  never a presumed sibling filesystem dependency. README is navigation, not a
  duplicate operational/default contract.
- Plugin Creator owns package manifests, MCP integration and whole-package routing.
  Bundled Skills are in scope; standalone Skills/agents route to their specialists.
- Portable Agent Plugins 1.0.0 includes Skills and MCP, not agents or hooks. Keep
  recorded canonical schemas unchanged unless upstream refresh and approval exist.
- Native Goose hooks use `hooks/hooks.json`. Distributor adapter structure does
  not establish activation; preserve native sources and block ambiguous layouts.
- Creation, plugin/component validation, packaging, installation and full-eval
  creator CLIs/native executables are retired. Do not invoke old scripts.
- Shared skill-creator guidance owns supported standalone Skill `validate`,
  evaluation/history/inspect, explicit grading/regrading/judgments/export and its
  contained static HTML helper. History/inspect are read-only. None validates a
  plugin manifest, proves host activation or supplies production approval.
- Evaluation sources are selected Skills and/or Plugins, never standalone hooks,
  agents or MCP-only benchmarks. Authoring does not authorize model execution.
- Active references must not prescribe retired tooling or retain duplicate obsolete workflows as fallback instructions.
- Scenario prompts are short user questions, not supplied solutions. Only supported
  suite fields; neutral inert fixture bytes go to both arms. Put setup and execution
  governance outside task prompts and independently observable criteria in the suite,
  not constraint extensions or a parallel tracker.
- Distinguish static format review, archive checks, behavior, host compatibility and
  publication authority. Report exact commands/results and missing proof.

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

## Consultation assertions — ap-3mwp

Future creation-suite assertions distinguish supported consultation claims from
artifact quality. Direct load/read evidence supports a claim; listings, mentions
and wrapper code alone do not. No-plugin baseline absence is expected and must
not be mislabeled as task-quality failure. This changes future criterion identity;
do not apply it to frozen campaigns or compare scores across suite revisions as
if criteria were unchanged. Whole-profile treatment and neutral inputs remain.
