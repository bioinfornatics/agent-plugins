# Skill Creator authoring boundary

This directory owns portable Skill instructions, current scenario data and retained
historical references. Root instructions apply; task-specific restrictions prevail.

- `references/assessment-guide.md` owns dated prompt/context/authoring knowledge
  and the 41-rule assessment checklist. Apply it at create design/final, actual-source
  audit and evidence-led improve/final; wire consuming links, not orphan references.
  Functional Markdown/XML is authoring policy, not schema validity or measured gain.
- Use recorded Agent Skills format sources; refresh upstream before changing a
  public format contract. Evaluation suite metadata is not Agent Skills frontmatter.
- Keep metadata and instructions English, concise descriptions third-person, and
  SKILL.md <=500 lines. Link conditional detail at its consuming action.
- Author standalone Skills in the user-approved workspace, not a live installation.
  Agent, hook, plugin and executable-packaging responsibilities remain separate.
  Comparative evaluation accepts both Skill and Plugin roots; this does not grant
  whole-plugin authoring authority.
- Current executable source is apps/agent-plugin. Never hand-edit runtime/ or the
  generated scripts/skill-creator.mjs launcher. Report helpers/templates have their
  own ownership; instructions-only changes do not require runtime regeneration.
- Current commands/options are documented in references/command-contract.md;
  README.md links to it and references/evaluate-workflow.md governs orchestration.
  Retired creator commands, receipts, schemas and fixtures are historical only.
- evals/evals.json uses only current executable fields. Freeze assertions outside
  natural user prompts; verify preparation outside the suite, not unsupported
  suite constraints. Supply identical neutral task inputs to both comparison arms.
- Preserve current normative sources, authentic evidence and user changes; obsolete synthetic fixture corpora are not mandatory retention. Never package secrets or
  mutate ~/.agents. A private HOME is not an OS sandbox.
- For instruction changes, inspect local links, containment, suite input existence,
  unsupported fields and line counts. The contained launcher can perform read-only
  `validate <canonical-skill-path>` and evaluation `--dry-run`; neither proves behavior.
  Follow root/app verification guidance for source implementation changes.
- Report actual checks and remaining proof gaps. No implicit models, grading,
  installation, credentials, Git, tracking or publication authority follows from this file.

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
