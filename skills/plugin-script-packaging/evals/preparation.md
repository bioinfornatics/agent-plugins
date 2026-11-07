# Preparation, not task questions

## Authoring checks

Run `node evals/verify-fixture.mjs` from this Skill. It reads retained fixture code and creates/removes disposable copies below evals. No model, build, package install, HOME mutation or host installation is involved. It checks actual subprocess outcomes and retained input hashes. The tiny payload is authored test data, not generated application runtime. package-lock.json describes its empty dependency graph; no npm operation is needed.

For suite import, use the current app's preparation-only dry-run with the absolute Skill source path, or read FilesystemEvaluationSource directly. The launcher belongs to skill-creator, not this candidate. Do not rebuild shared outputs another worker owns. A dry-run is static preparation, not behavioral evaluation.

## Prospective comparative setup

- Cases 1–6 are design/audit/handoff questions supplied with neutral documents, not executable build tasks. No actual native artifact, Rust toolchain, Python freezer or host installation is prepared; do not classify those cells as execution-ready.
- Case 7 receives the declared `evals/inputs/launcher` directory at exactly that workspace path in both arms, independently of treatment installation. Inspect its code/contract before execution. Node >=22.22.2 and local filesystem/process tools must be available equally to both arms. It is interpreted JS only.
- Current importer forbids SKILL.md/AGENTS.md, node_modules and discovery/config inputs. These fixtures have none. No inert plugin manifest is required: mixed-profile data records an external owner's contract, not a portable metadata proposal.
- Authorize creation/mutation of disposable copies in the trial workspace, not retained inputs. Hold criteria and test runner separately from task data to avoid handing answers to either arm. The current CLI has no scenario setup hook; the test runner is an authoring oracle, not an automatically executed campaign assertion.
- Before any model run, freeze source/input identities and criteria, verify host/tools, set model/repetitions/time/turn/stopping rules and obtain explicit authority. These controls do not belong in suite fields. No model run is authorized by this authoring slice.

## Proof limits

Fixture receipt covers local Linux interpreted execution only. Native, signals, arbitrary dependency/resource closure, hostile filesystem races, Node loader security and real host discovery remain untested. Rust/Python designs need independent semantic assessment and later language-specific builds/execution; Node fixture success cannot replace them.

Historical enriched suite at `historical/evals-pre-ap-9ato.json` is byte-preserved and outside discovery. It is not prepared execution evidence.
