# Agent Creator maintenance

- Preserve the recorded format in [custom-agent source](references/custom-agents.md).
  Refresh upstream before changing its public contract; see [provenance](references/UPSTREAM.md).
- Author custom roles in `.agents/agents`, not portable plugin agents, Skills or recipes.
- Keep active instructions English, metadata concise and third-person, and `SKILL.md` <=500 lines.
- This Skill has no current creator executable/component validator. Do not edit or revive retained runtimes/scripts as authoring tooling.
- Keep historical evidence/fixtures intact. New evaluation inputs must be neutral data copied to both arms; use supported suite fields and verify setup before execution.
- Test only in isolated project/user directories, never live operator installations.

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

Creation scenario requires an equivalent empty evaluation-sandbox project in both arms; missing setup remains a blocker.
