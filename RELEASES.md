# Distribution status

The current installation is the Git-backed main tree, containing independently
installable Skills and the skill-creator Node.js >=22.22.2 launcher/runtime.
See [README](README.md) for installation and [CONTRIBUTING](CONTRIBUTING.md) for development.

The pre-migration Bun creator executables, native archives, tagged native workflow
and local staged installer have been retired and removed from current tooling.
No native compatibility or newly published release is claimed by this cleanup.
Historical compatibility evidence and third-party/vendor sources remain retained.

## 0.6.1 — report overview and judge diagnostics

- Explicit source Skill/Plugin identity and complete frozen campaign overview, with
  candidate and judge model provenance kept separate.
- Compact attention-first cards, raw ascending score bands, unavailable scores first,
  closed supporting artifacts and a space-reserving feedback dock.
- Strict exports require source metadata and overview.json; re-export retained grades
  without rerunning models to use the current report helper.
- Goose terminal text accepts valid thinking/redactedThinking auxiliaries; strict
  prompt, tool-request, JSON, hash and quote validation stays enforced.
- Safe structured judge diagnostics preserve stages, process facts and omission
  causes without message/thinking payloads; existing grades are unchanged.

Compatibility: see [versioned evidence](skills/plugin-creator/references/compatibility-matrix.md).
Local regression verification is not a claim that all historical grading failures
are fixed. Native/model efficacy and unknown effective model identity remain separate.
Git distribution uses main; the v0.6.1 distribution tag must target its verified
promotion commit, not an authoring tree. No npm or native archive release is supplied.

## 0.6.2 — reliable grading and partial comparisons

- Validated verdicts no longer pass through the raw diagnostic JSON scanner. Safe
  escaped prose and exact citations are preserved; known credentials remain
  protected, with unsafe rationale omitted independently of the verdict.
- The judge receives a bounded, authenticated structural tool-event index with
  exact request/response IDs. Mentions, listings and wrapper code alone are not
  consultation proof; incomplete scans cannot establish absence.
- Overview cards show With/Without coverage and inconclusive states together when
  judge attribution is unique. Baseline-only partitions display their own score;
  resolved historical grading errors remain in Details.
- Future plugin-creation criteria distinguish supported consultation claims from
  artifact quality. No-plugin baseline absence is expected, not a quality defect;
  frozen suites and historical grades are not rewritten.

Compatibility: see [0.6.2 evidence](skills/plugin-creator/references/compatibility-matrix.md#062--grading-reliability-and-evidence-access-2026-11-09).
Local source/runtime/browser regressions are verified; the structural reader has
not been exercised by a live model campaign. The 22 authorized regradings on Goose
1.57.0 used the sanitization repair before the structural-reader addition: no new
technical failures, 19 decisive and 3 inconclusive outcomes. This is not calibrated
judge-quality or cross-version compatibility proof. No npm/native release is
supplied. The v0.6.2 tag must target the verified promoted main distribution.
