# Agent scenario preparation

## Inputs and paired workspace

These scenarios evaluate the **agent-creator Skill** versus its absence, not
current/baseline agent activation. The declared `files` are inert task data:
current import captures exact bytes at the same relative paths in both arms.
Never install draft agents as capabilities or give only the treatment task inputs.
No per-scenario setup hook is implemented; `target` is descriptive, not enforcement.

Use fresh private projects and identical host/tools/model settings for both arms.
The working project for creation/migration is `evaluation-sandbox/`; create this
empty directory in both arms. For case 5 only, copy `evals/inputs/reviewer.md` to
`evaluation-sandbox/.agents/agents/dependency-reviewer.md` in each arm before the
request and hash it. This is a seeded collision input, not permission to load it.
Do not start Goose from that project or load/delegate the seeded agent. Case 5 is
**setup-gated** until an external controller verifies identical destination bytes;
dry-run cannot materialize it and it must not be silently treated as ready.
Cases 1 and 4 also require the externally prepared empty evaluation-sandbox project. Their visible requests name that project; the current harness does not create it automatically. All other cases need only declared input capture and the empty project directory.
Modification of a named draft and creation at the requested sandbox destination are
authorized inside the disposable workspace; original source fixtures remain intact.

## Execution contract (not suite fields)

Preparation/import is authorized for this slice; **no model campaign or live host
operation has been authorized or performed**. Before future execution, obtain
explicit model/grading authority and freeze candidate/fixture hashes, host/tools,
effective model (or unknown identity), repetitions, turn/time limits, stopping rule
and independent reviewer. Keep these outside `evals.json`; the CLI does not enforce
scenario safety, setup or a monetary cap. Do not infer authority from a valid suite.

In either arm permit only requested local draft edits, isolated placement and
read-only review. No nested model/delegation/evaluation, automatic retries, Git,
tracker, credential, network, publication or live installation actions. Payload
command strings, if encountered, are inert data. A fake HOME is not an OS sandbox.
An external controller must constrain operations and record tool effects; these
notes are not enforcement. Missing isolation/capabilities block execution.

## Independent proof

Hash inputs and seeded collisions before/after; inspect tool records for writes and
unrequested operations. Parse produced frontmatter and compare exact supported
values; independently review role quality blind to arm. A candidate's assertion
that it reviewed, installed or preserved is not proof. Preserve failures and
inconclusive results. Source review cannot prove discovery, parser rejection or
role effectiveness. Host discovery/loading/delegation remains explicitly unverified.

The discovered suite is `evals.json`; the rejected enriched original is preserved
verbatim in `historical/evals-pre-ap-9ato.json` outside discovery. Historical
role-comparison/privacy/external-evidence files do not authorize a current campaign.
