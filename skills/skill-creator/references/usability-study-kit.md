> **Historical reference — not a current execution workflow.** Retained for provenance.
> Its commands, schemas and acceptance claims are not supported by the current CLI.
> Use [current evaluation](evaluate-workflow.md), [scenario design](evaluation-design.md),
> [authoring](create-workflow.md) or [report review](review-viewer.md) instead.

# Governed intake usability study kit

Use this kit to run the real-human intake study without treating preparation, dry runs, or fictional fixtures as participant evidence.

## Governance boundary

- Obtain voluntary consent before recording anything. Do not record a declined session.
- Assign a random session ID matching `S-[A-Z0-9]{8}`. Keep any recruitment/contact mapping outside this repository and outside the session record.
- Never collect names, handles, email addresses, phone numbers, IP addresses, employer names, repository URLs, home-directory paths, recordings, or raw transcripts. Runtime validation checks every string field for likely email addresses, URLs (including repository URLs), handles, phone numbers, home paths, IPv4/IPv6 addresses, organization/employer indicators, and common full-name forms.
- Keep finding titles (1–120 characters) and descriptions (1–500 characters) bounded. Refer to people only with pseudonymous lowercase role labels such as `participant`, `facilitator`, or `reviewer`; never use a real name or stable external identifier. A privacy reviewer must inspect both fields before setting `privacy_reviewed: true`; validation conservatively rejects capitalized multiword proper nouns.
- Store only the structured fields allowed by `assets/usability-study/session.schema.json`.
- Set `retention.delete_after` before collection. It must be on or after the UTC date of `consent.captured_at` and at most 90 calendar days later. Delete the session record by that date and follow any stricter approved local policy.
- Fictional fixtures are validator tests only. They are synthetic, are not research evidence, and must never be included in a study report.
- Analyze only consented sessions. The parent requirement is at least five sessions; this protocol requires at least six because each session attempts exactly one catalog task and eligibility requires coverage of all six task IDs, all three artifact types, and both cohorts.

## Consent script

Read verbatim before starting:

> We are evaluating the Skill Creator workflow, not you. Participation is voluntary. You may pause or stop at any time without giving a reason. We will record only an anonymous session code and structured task measures; we will not record your name, contact details, employer, repository URLs, screen/audio/video, or a transcript. The record will be deleted on the stated retention date. The study team may use these anonymous measures to improve product behavior and documentation. Do you consent to participate and to this limited data collection?

Record `consent.granted: true`, the protocol version, collection mode, capture time, and retention policy. If the answer is no, stop and create no session file.

## Facilitator protocol

### Before each session

1. Use a clean offline workspace and a released Skill Creator build.
2. Choose one cohort (`nonexpert` or `developer`) and exactly one task assigned to that cohort in `assets/usability-study/tasks.json`, without changing its wording. Record exactly that task ID and its catalog `expected_artifact`.
3. Explain think-aloud is optional and will not be transcribed. Show the withdrawal and retention terms.
4. Obtain consent, allocate an anonymous session code, and start the elapsed timer.

### During each task

1. Read only the task prompt. Do not teach creator routing or terminology.
2. Count each participant question. Answer only procedural/safety questions until the participant is blocked.
3. A **facilitator correction** is any hint that changes artifact choice, command, or next action. Record it; do not silently rescue the task.
4. Record the elapsed milliseconds to the first reviewable candidate, if any.
5. Record initial and final artifact choice. Recovery succeeds only when an initially wrong choice is changed to the expected artifact without a facilitator correction.
6. Mark completion only against the task's observable checks. Score comprehension with the fixed 0–4 rubric below.
7. Ask for confidence from 1 (not confident) to 5 (very confident).

### Comprehension rubric

- **0**: cannot state what will be created or where.
- **1**: recognizes the artifact but cannot explain scope or next review step.
- **2**: explains artifact and scope, but misses isolation, validation, or routing.
- **3**: explains artifact, scope, and review/validation boundary with one omission.
- **4**: accurately explains artifact, ownership/routing, isolation, and next validation/review step.

### After each session

1. Validate immediately with `usability-study --validate`; correct data shape, never participant behavior.
2. Classify each observed issue as `product-defect` or `documentation-gap`, and severity `P0`–`P3`. P0 blocks safe use or causes destructive/cross-scope action; P1 blocks a core task with no reasonable self-recovery; P2 degrades a task with a workaround; P3 is minor friction.
3. Do not diagnose from memory or add direct identifiers/free-form transcripts.
4. Store records in an access-controlled study workspace, not under fixtures or source control.

## Deterministic analysis

```bash
skill-creator usability-study --validate <session.json> --format json
skill-creator usability-study <sessions-directory-or-json-array> --format json
```

The analyzer reports completion without correction, question burden, wrong-artifact recovery, comprehension, time to first candidate, confidence, cohort mix, task/artifact coverage, the parent `>=5` requirement, the stricter `>=6` protocol eligibility gate, and the `80%` completion threshold. Eligibility requires all six checked-in task IDs, all three artifact types, and both cohorts. It emits deterministic suggested `bd create` commands for P0/P1 findings but never executes them. Review classifications before creating issues.
