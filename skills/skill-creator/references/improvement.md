# Improve a Skill from evidence

1. **Bind the finding to its source.** Read the supplied candidate and observed
   outputs, user feedback or retained evidence. Confirm which version, inputs and
   comparison the finding concerns. Stale/partial evidence is not current proof.
   Use [retained campaigns](retained-campaigns.md) for read-only inspection when needed.
   A profile-presence/absence campaign is not an old/current comparative experiment.
2. **Classify the failure before changing instructions.** Apply the
   [assessment checklist](assessment-guide.md#authoritative-assessment-checklist)
   to the bound source and observed evidence before selecting a correction. Use relevant
   [patterns](skill-authoring-best-practices.md): metadata for missed/false activation,
   action order for omitted prerequisites, conditional disclosure for wrong branches,
   deterministic validation for mechanical errors, or resource/host prerequisites
   for unavailable operations. Separate candidate defects from suite, runner and
   grader defects. Read [authoring](authoring.md) before structural redesign.
3. **Make the smallest authorized correction.** Preserve working behavior and
   supplied user edits. Prefer clarifying or reordering existing guidance before
   adding prose. Generalize the failure mechanism; never insert the exact test answer
   or grader wording into instructions. Activation tuning changes metadata, not
   execution authority. No description-optimization or evidence-loop CLI is current.
4. **Freeze a discriminating regression.** Read [scenario design](evaluation-design.md).
   Keep relevant positive cases and add only risk-distinct coverage. Freeze source,
   criteria and neutral fixtures before any authorized evaluation. Define a stopping
   rule; models and grading are separate permissions, not automatic improvement steps.
5. **Verify and deliver.** Reapply the
   [assessment checklist](assessment-guide.md#authoritative-assessment-checklist)
   to the changed candidate, preserved behavior and outstanding proof; keep per-rule
   static passes distinct from unverified behavioral gain. Run scoped static checks on the final candidate and report
   actual paths, correction rationale, preservation evidence and remaining behavioral
   proof. If evaluation is authorized, use [current evaluation](evaluate-workflow.md)
   and report its actual comparison and uncertainty. Static improvement is not a
   demonstrated quality gain; no legacy receipt or release eligibility is inferred.
