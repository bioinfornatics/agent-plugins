# Execute evaluation and produce HTML reports

Read only for an evaluation/reporting request, then execute this workflow. Do not load creation guidance as a preflight for an existing eval set.

1. **Launch the requested evaluation on the existing Skill.** Use the supplied target and eval set; do not begin with Skill audit/validation, runtime smoke tests, credential probes, scenario redesign or advanced preparation. Let the command validate its own inputs. If cases are missing, report that concrete input gap; create them only when the request covers scenario authoring, read [scenario design](evaluation-design.md) and the applicable [schemas](schemas.md), create the missing cases, then return here. Do not load the whole creation workflow to supply cases.
   - **Activation:** read [trigger evaluation](trigger-evaluation.md), then run run-evaluation --skill-path <dir> (default <skill>/eval.json). It tests selection, not output quality.
   - **Behavioral:** read only the applicable simple section of [evaluation workflow](evaluation-workflow.md), then run run-evaluation --mode behavioral --skill-path <dir> (default <skill>/evals/evals.json). For comparison, use the explicit previous Skill as baseline; use without_skill for a genuinely new Skill. Freeze criteria and equivalent inputs before candidate runs.
   - Commands launch neither candidates nor graders: the current session executes/delegates pending tasks. prepare-execution and full-eval are optional advanced paths, not prerequisites. Read advanced sections only for an explicitly selected advanced protocol.

2. **Execute pending tasks and collect actual evidence.** Dispatch only returned pending work, with equivalent fixtures/context and assigned output destinations. Candidate tasks receive the prompt and allowed inputs, not expected answers or grading criteria. Preserve completed outputs and resume from the first incomplete step.
   - Activation imports actual host load-tool observations through --observations on resume. Forced SKILL.md injection or candidate self-report is not activation evidence; absent usable telemetry is unsupported-telemetry, not a negative.
   - Behavioral tasks save actual outputs and observed timing. Record unavailable metrics as null with a reason; never estimate tokens. Separate processes/workspaces do not prove isolation, an uncontaminated baseline or independent grading.
   - If a required execution/delegation capability is absent, report the affected pending step; do not simulate runs or probe unrelated capabilities. Inspect delegated artifacts and raw evidence, not completion claims. Parallel writers need disjoint ownership and a join before dependent work.

3. **Check and grade the outputs.** Run reliable deterministic checks first; reserve LLM judgments for contextual criteria. Before preparing/importing grading artifacts, read the operational sections of [evaluation output contract](evaluation-output-contract.md); use the schema reference linked at step 1 only for artifacts being authored/imported or a concrete schema error.
   - For simple behavioral runs, resume to obtain grading_requests, send only each anonymous request packet to an independent blinded grader, collect judgments, then resume with --grading-results <file>. Never send coordinator status, variant paths or expected answers, and never substitute self-grading. Batch semantic criteria per output; additional graders are for ambiguity/higher stakes, not routine duplication. Disagreements stay inconclusive.
   - Only for advanced full-eval awaiting-grading, read [delegated grading](delegated-grading-workflow.md) before using its separate export/import commands.
   - Follow frozen repetition and correction budgets. A completed report or favorable average cannot erase missing proof or a safety-boundary failure. Do not rerun completed candidates merely to recover missing grading.

4. **Aggregate, generate and inspect the HTML.** Resume the applicable command to validate imported evidence, calculate results and produce the returned review HTML. Both simple modes produce review.html even with incomplete evidence; behavioral local reports retain unavailable metrics, while strict compatible exports require complete data.
   - Open and inspect the rendered report. A file existing is not browser verification. Show progress, outcomes, individual failures and missing observations/grades/telemetry; retain unavailable and inconclusive results rather than inventing zeros or passes.
   - For the selected advanced protocol, use its aggregation/viewer and receipt checks; do not apply advanced acceptance receipts to simple local reports.

5. **Report the result and stop.** Immediately before reporting, read the human-report section of the output contract linked at step 3, reusing available guidance. Give actual artifact paths including HTML, results, failures, evidence limits and the next concrete action. Complete is not pass, authenticated provider proof, independent review or release acceptance. Do not fabricate usage or approval. Propose improvements from failures; change the Skill only if improvement was requested.


## Commands for this workflow

Use the available launcher; source copies use Node.js 22+ through node scripts/skill-creator.mjs, native archives use the released executable. Consult --help only for needed syntax. JSON automation uses stable envelopes; exit codes are 0 success, 1 failure, 2 invalid usage and 3 blocked execution.

~~~bash
skill-creator run-evaluation --skill-path <skill-directory> --format json
skill-creator run-evaluation --skill-path <skill-directory> --output <run-directory> --resume --observations <file> --format json
skill-creator run-evaluation --mode behavioral --skill-path <skill-directory> --format json
skill-creator run-evaluation --mode behavioral --skill-path <skill-directory> --output <iteration-directory> --resume --grading-results <file> --format json
skill-creator full-eval <skill-directory> --workspace <iteration-directory> --format json
~~~
