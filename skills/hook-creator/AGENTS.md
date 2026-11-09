# Hook Creator maintenance

- Preserve [hook source](references/hooks.md) and the recorded [target contracts](references/goose-target-compatibility.md); refresh upstream before public format changes.
- Resolve the target host before authoring executable hooks. Goose hooks are plugin components; only its PreToolUse and Stop events block. Other hosts use their dedicated references and native ownership/decision contracts.
- Keep English metadata/instructions, concise third-person descriptions and `SKILL.md` <=500 lines.
- No current creator executable/component validator exists. Do not revive historical runtime/scripts or claim Skill validation validates hooks.
- Preserve original fixtures and schemas. New neutral inputs and setup belong in `evals/inputs`; execution prerequisites are verified separately; supported suite fields only.
- Inspect executable code before isolated tests; never execute payload commands or mutate live installations.

## Citation and snapshot maintenance

- Event/blocking explanations must cite the selected host's official documentation
  in the delivered answer; Goose uses the public Hooks reference linked from
  `references/goose-hooks.md`. Reading a local inventory is not a citation.
- Record source-check dates and exact release identifiers separately. Never label
  a retained release "latest" without a fresh dated check; snapshot maintenance is
  not synchronized with host releases. Keep unavailable freshness explicit.
- Preserve existing evaluation criteria and frozen campaigns when clarifying these
  instructions; static checks do not prove future answers or hook activation.

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

## Active evaluation inputs

- The active suite is `evals/evals.json`; creation uses
  `evals/inputs/empty-plugin` and audit uses `evals/inputs/unsafe-stop-hook`.
- `evals/inputs` contains evaluation-only data, not authoring tools, installable
  components or format authorities. Copy equivalent inputs to both evaluation arms;
  creation modifies only isolated copies and audit inputs remain read-only.
- `assets/evaluation-fixtures` remains historical evidence. Preserve its original
  bytes and modes; active suite prompt, files and target references use `evals/inputs`.
- Inspect handler code and inert payload data before isolated testing. Never execute
  payload command strings or the unsafe draft's missing handler; these inputs do not
  authorize host activation or live installation changes.

## Evaluation prerequisites

Creation tests invoke reviewed handlers with inert payloads only; payload command strings are never executed. Audit stays read-only.
