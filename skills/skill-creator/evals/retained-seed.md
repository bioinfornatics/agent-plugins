# Operator-only retained fixture setup

`seed-retained.mjs` is evaluator tooling, **not a candidate input**. It generates
current schema-v2 registry and checkpoint archives via public preparation,
execution and storage APIs. Host receipts explicitly disclose deterministic
synthetic execution: this is neither native Goose/provider compatibility nor
Skill effectiveness evidence. Campaign/attempt UUIDs are assigned by the current
store/executor, not invented as evidence. No credentials or ambient configuration
are archived. No model, grading or resume command is invoked.

## Generate directly in the final workspace

With Node >=22.22.2 and the current app source checkout available to the operator:

```bash
node skills/skill-creator/evals/seed-retained.mjs \
  /absolute/repository/apps/agent-plugin /absolute/new-final-workspace
node --test skills/skill-creator/evals/seed-retained.test.mjs
```

The workspace must not already exist; its parent must exist and contain no symlink
ancestors. Failure leaves operator-owned partial output for inspection; do not
reuse it as verified evidence. Generate again at a new path.

The completed campaign has two finalized with/without attempts. The interrupted
campaign has one finalized intact attempt and one pending logical trial, created
using public store start/finish/close. Each finalized archive is reverified through
`SqliteVerifiedAttemptReader`. Actual CLI history/inspect operations exit zero and
preserve existing workspace bytes. The test additionally invokes the **contained
launcher/runtime copied independently of app sources** in separate processes at two distinct final workspace locations,
checking exact campaign states, identities/evidence availability and all workspace-byte immutability.
Those consumer processes do not import the app or generator.

Outputs `fixture-metadata.json` and `bound-retained-cases.json` bind the pending
sidecar's tokens to real stored identities. They are operator records, not
unsupported suite fields; they do not activate any discovered suite. Treat the
metadata/observations as private oracle data rather than material handed to an
agent. Pass only neutral registry/archives and the bound natural request under
an explicitly reviewed harness setup.

## Relocation and comparison-arm boundary

**Do not copy a generated registry to a new absolute location.** Current checkpoint
requests and stored campaign output paths bind absolute provenance. The portable
asset is the operator generator, not a prebuilt SQLite file. Run it independently
in each final arm workspace before candidate execution; no app source is required
by history/inspect at run end. The seed does not itself create harness setup hooks.
Generated UUIDs/absolute roots necessarily differ; compare normalized logical
trial state and neutral artifact bytes, not identical SQLite hashes across arms.
Within each arm preserve and compare exact original bytes. The harness still needs
reviewed out-of-band setup and equivalent operational CLI availability before any
case is activated; current suite `files` alone does not supply that mechanism.

## Remaining authorization and evidence

Cases 8–10 remain outside `evals.json`. This fixture makes positive retained
consultation feasible and supplies an interrupted frozen plan with genuine
archives, but does not prove candidate behavior or native provider execution.
Future resume must retain the finalized attempt and execute only pending work;
requires explicit model authority. Future grade/export must select actual
completed attempts, create real judgments under separate authority and export
explicit decisive grade IDs. No grades are fabricated by this seed, and no
export-success claim is made. An additional deterministic injected-judge/export
fixture is optional future tooling, not a substitute for paid-grading acceptance.

Verification: Node v22.22.2, `node --test .../seed-retained.test.mjs`: 1 test passed,
0 failed; contained consumer history/inspect passed in both final locations.
