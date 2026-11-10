# Author a Skill

1. **Recover the user outcome and scope.** Read the supplied brief/artifacts. Identify
   intended users, observable result, activation context and neighboring responsibilities.
   For an early idea, ask only the decisions needed to make a usable candidate; no
   elicitation CLI, hash-confirmation ritual or durable workspace is assumed.
   Confirm writable destination and preserve existing work. Standalone authoring is
   separate from live installation and whole-plugin authoring.
2. **Choose the smallest useful structure.** Before drafting, read [authoring](authoring.md)
   and relevant [patterns](skill-authoring-best-practices.md). Apply the
   [assessment checklist](assessment-guide.md#authoritative-assessment-checklist)
   before drafting: record applicable design decisions and planned checks, not passes.
   Write English third-person
   discovery metadata describing responsibility and activation, not the full procedure.
   Keep SKILL.md <=500 lines. Put safeguards before their actions; link independent
   workflows at intent selection and specialized detail at the consuming step.
   For a rule-rich domain, read [domain coverage](domain-coverage.md) before designing
   its rule inventory. Prefer a complete small candidate with explicit unsupported
   cells to broad unfinished automation. Bundle deterministic helpers only when needed.
3. **Supply user-centered scenarios.** Read [scenario design](evaluation-design.md)
   before writing evals/evals.json. Derive prompts from real user questions, not the
   procedure just authored. Put criteria and independent proof plans outside prompts;
   supply neutral files identically to both arms. Do not invent activation commands
   or mandatory eval.json artifacts; discovery may be reviewed separately.
4. **Check and deliver.** Reapply the
   [assessment checklist](assessment-guide.md#authoritative-assessment-checklist)
   to the produced candidate and reachable active resources; report per-rule evidence,
   N/A reasons and unverified behavior. Run the contained launcher's standalone `validate` with the
   canonical candidate path when available. Inspect metadata, line count, contained
   links and fixture readiness. Correct observed scoped errors, then report paths,
   actual checks and gaps. Scenarios supplied is not scenarios executed. Stop after
   authoring unless evaluation was also requested and authorized.

Current format validation:

```bash
node <skill-root>/scripts/skill-creator.mjs validate /canonical/path/to/candidate
```

There is no current `design-evals`, `freeze-evals`, `create` or packaging command.
