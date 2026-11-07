# Skill Creator authoring boundary

This directory owns portable Skill instructions, current scenario data and retained
historical references. Root instructions apply; task-specific restrictions prevail.

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
- Current commands/options are documented in README.md and references/evaluate-workflow.md.
  Retired creator commands, receipts, schemas and fixtures are historical only.
- evals/evals.json uses only current executable fields. Freeze assertions outside
  natural user prompts; preparation belongs in evals/preparation.md, not unsupported
  suite constraints. Supply identical neutral task inputs to both comparison arms.
- Preserve historical fixtures, evidence and user changes. Never package secrets or
  mutate ~/.agents. A private HOME is not an OS sandbox.
- For instruction changes, inspect local links, containment, suite input existence,
  unsupported fields and line counts. The contained launcher can perform read-only
  `validate <canonical-skill-path>` and evaluation `--dry-run`; neither proves behavior.
  Follow root/app verification guidance for source implementation changes.
- Report actual checks and remaining proof gaps. No implicit models, grading,
  installation, credentials, Git, tracking or publication authority follows from this file.
