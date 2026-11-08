# Find, inspect and resume retained campaigns

1. **Select the registry and question.** Use the supplied explicit registry when
   present. Read-only commands do not create/migrate it. Find campaigns through
   `history --json`; optional `--profile <id>` filters exact identity, not label.
2. **Inspect stored evidence.** Run `inspect <campaign-id> --json` with the same
   registry. Summarize stored parameters, logical trials, append-only attempts and
   evidence locations. Presence is not hash verification, a grade or quality proof.
   Missing/corrupt/incompatible inputs remain explicit; never invent a campaign ID.
3. **Resume only on request.** Confirm continuation authority, including any model
   calls. `evaluation --resume <campaign-id>` uses the frozen stored plan, not current
   source selectors. Only `--registry`, explicit `--retry-uncertain` and presentation-only
   `-q`/`--quiet` may accompany it: no dry-run, model/parameter overrides, selectors, name or output change.
   Keep heartbeat enabled by default and follow
   [heartbeat monitoring](evaluate-workflow.md#monitor-heartbeat-and-wait-for-the-same-command)
   while waiting on the same invocation. Retry-uncertain permits new attempts; it never bypasses corruption checks or
   overwrites old attempts. Inspect after continuation; do not rerun completed work
   merely to fill a report or choose a favorable result.
4. **Deliver the observed state.** Report campaign/registry/evidence identifiers,
   actual commands and missingness. For grading/export use the explicit selections
   in [evaluation-to-export](evaluate-workflow.md); a historical workspace cannot be
   imported through an invented current command.

```bash
node <skill-root>/scripts/skill-creator.mjs history --registry /path/registry.sqlite --json
node <skill-root>/scripts/skill-creator.mjs inspect <campaign-id> --registry /path/registry.sqlite --json
node <skill-root>/scripts/skill-creator.mjs evaluation --resume <campaign-id> --registry /path/registry.sqlite
```
