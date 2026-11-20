# Creator Skill activation cases (ap-1189.9)

`ap-1189-creator-queries.json` holds should-trigger and near-miss cases for the
five creator Skills after the 2026-11-20 adversarial review. Each Skill has two
natural should-trigger requests and two near misses, chosen from requests that
could activate a sibling or competing Skill. The oracle observes only the case's
target Skill.

Dry-run (no host or model calls):

```bash
node skills/skill-creator/scripts/skill-creator.mjs activation \
  --skills skills/agent-creator skills/hook-creator skills/plugin-creator \
           skills/plugin-script-packaging skills/skill-creator \
  --queries tests/evals/activation/ap-1189-creator-queries.json --dry-run
```

Removing `--dry-run` calls models (20 cases x 3 repetitions by default) and
requires explicit authorization. Results compare only at equal host version and
code mode. These cases are inputs, not evidence.
