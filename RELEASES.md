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
