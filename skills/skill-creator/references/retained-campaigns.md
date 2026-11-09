# Find, inspect and resume retained campaigns

1. **Locate the retained registry and question.** Omit `--registry` for the shared
   XDG registry. Use a supplied or known nondefault registry consistently to access
   its retained campaign; this is continuity, not a new discretionary override.
   Do not infer a registry from cwd/session provider or invent `.artifacts` durable
   storage. Read-only commands do not create/migrate it. Find campaigns through
   `history --json`; optional `--profile <id>` filters exact identity, not label.
2. **Inspect stored evidence.** Run `inspect <campaign-id> --json` with the same
   registry. Summarize stored parameters, logical trials, append-only attempts and
   evidence locations. Presence is not hash verification, a grade or quality proof.
   Missing/corrupt/incompatible inputs remain explicit; never invent a campaign ID.
3. **Resume only on request.** Confirm continuation authority, including any model
   calls. `evaluation --resume <campaign-id>` uses the frozen stored plan, not current
   source selectors. Only `--registry`, explicit `--retry-uncertain` and presentation-only
   `-q`/`--quiet` may accompany it: no dry-run, model/parameter overrides, selectors, name or output change.
   Omit quiet mode unless explicitly requested. Never restate evaluation defaults
   as flags on resume: its stored parameters and evidence path remain authoritative.
   New default campaigns use sibling `campaigns/profile=<id>/model=configured-<digest>/campaign=<uuid>`;
   this does not relocate retained campaigns or invent legacy model identities. Keep heartbeat enabled and follow
   [heartbeat monitoring](evaluate-workflow.md#monitor-heartbeat-and-wait-for-the-same-command)
   while waiting on the same invocation. Retry-uncertain permits new attempts; it never bypasses corruption checks or
   overwrites old attempts. Inspect after continuation; do not rerun completed work
   merely to fill a report or choose a favorable result.
4. **Deliver the observed state.** Report campaign/registry/evidence identifiers,
   actual commands and missingness. For grading/export use the explicit selections
   in [evaluation-to-export](evaluate-workflow.md); a historical workspace cannot be
   imported through an invented current command.

For the shared default registry omit `--registry` in these examples. Supply it
only to access the known nondefault registry containing the retained campaign.
Export/report still require explicit new authorized `--output` destinations and
the report helper requires the existing export as `--workspace`.

```bash
node <skill-root>/scripts/skill-creator.mjs history --registry /path/registry.sqlite --json
node <skill-root>/scripts/skill-creator.mjs inspect <campaign-id> --registry /path/registry.sqlite --json
node <skill-root>/scripts/skill-creator.mjs evaluation --resume <campaign-id> --registry /path/registry.sqlite
```
