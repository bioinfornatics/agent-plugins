# Skill Creator

Authors, audits and improves portable Agent Skills; designs scenarios and orchestrates
comparative Skill/Plugin evaluations. [SKILL.md](SKILL.md) selects independent intents
and owns common authority, default-override, executable and reporting safeguards.
Authoring does not implicitly launch models. Whole-plugin, agent, hook and executable
packaging authoring belong to their respective specialists.

## Current contained executable

**0.6.1.** `scripts/skill-creator.mjs` serves current `agent-plugin`, not the retired
creator command family. Node.js **>=22.22.2** and the whole Skill directory, including
its contained runtime, are required. An installed Git distribution needs no npm
install, app checkout, build, Bun or runtime download.

Current commands, exact options/defaults, required values and durable locations have
one owner: the [command contract](references/command-contract.md#command-contract).
Historical references are not active commands. Historical import, description
optimization, packaging CLI, live report servers and standalone native creator
executables are not supplied. Standalone Skill format validation does not validate
Plugin/agent/hook conformance or prove effectiveness or host compatibility.

## Workflow owners

| Requested outcome | Procedure owner |
|---|---|
| Create a Skill | [Authoring](references/create-workflow.md) |
| Audit actual source without rewriting | [Audit](references/audit-workflow.md) |
| Evidence-led correction | [Improvement](references/improvement.md) |
| Natural scenarios and independent criteria | [Scenario design](references/evaluation-design.md) |
| Evaluate, grade or export | [Evaluation-to-report](references/evaluate-workflow.md) |
| Inspect retained work or authorized resume | [Retained campaigns](references/retained-campaigns.md) |
| Generate/review HTML and assess disclosure | [Report review](references/review-viewer.md) |

“Evaluate this Skill/Plugin” owns **collect → prepare → evaluate → grade → export →
review**. When needed, one upfront checkpoint resolves scope, required values without
defaults and candidate-plus-grading authority; sufficient current permission is reused
without per-stage approval. Export/report use managed defaults without a destination
question; preparation needs a destination without a default. Explicit partial requests
remain bounded, and read-only/report work does not launch models. This is orchestration
of separate supported commands, not a new single-command CLI pipeline.

Evaluation procedure, profile composition, configured candidate identity before
scope freeze, heartbeat monitoring and coverage/grade selection belong in
[evaluate-workflow.md](references/evaluate-workflow.md). Do not infer agent/model
overrides from the authoring target or current conversation harness. Candidate and
judge execution configurations and exact versions remain separately evidenced;
configured identity does not authenticate the actual backend. Historical unknowns
stay unknown, not resolved from current settings.

[review-viewer.md](references/review-viewer.md) owns report generation, authenticated
managed regeneration, exclusive explicit outputs, browser checks, overview scoring
and disclosure. Evidence and grades remain immutable; managed regeneration changes
derived views only. Reports embed selected private outputs and do not redact secrets
automatically. Review disclosure before sharing. Generator execution, browser
verification, model quality and acceptance are separate evidence.

## Authoring assessment and proof

Use the [assessment guide](references/assessment-guide.md) at create design/final,
actual-source audit and evidence-led improve/final. It owns the dated 41-rule
checklist and functional Markdown/XML policy, not portable format validity or a
measured universal gain. Workflow links load detail at its consuming action;
evaluation-only work loads the guide only when assessing instruction content.

The active [suite](evals/evals.json) supplies short natural requests and neutral inputs
for creation, audit and evaluation planning/boundary cases. Verify prerequisites
separately. Planning cases do not prove end-to-end execution; that requires separately
authorized candidate and grading calls. Private HOME/XDG is not an OS sandbox.
Report actual checks, missing evidence and remaining authority; no paid retries,
installation or publication follow automatically.

Ordinary authoring targets current stable hosts and official documentation. Keep the
authoring target, current harness and candidate/judge execution hosts distinct; exact
observations belong in provenance and compatibility evidence. Untested support and
historical missing identities remain explicit; no broad host range follows from a
format pass or one observed version.

## Attribution

Derived from Anthropic's skill creator; see [LICENSE.txt](LICENSE.txt).
