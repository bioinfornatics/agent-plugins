# Plugin Creator evaluation fixtures

Immutable plugin roots for static validation, packaging, component routing, and integration evaluation. Copy before mutation.

- `package-ready/`: valid minimal Skills-only plugin.
- `schema-invalid/`: schema-minimal manifest accepted by Agent Plugins 1.0.0 but rejected by Goose operational validation because `version` is absent.
- `multi-component/baseline/`: valid plugin with one basic Skill.
- `multi-component/current/`: improved Skill plus a blocking hook and integration cases.
- `partial-integration-workspace/`: benchmark inputs exist but viewer and human review are absent.

## Inert templates

Fixture entrypoints are stored as SKILL.md.fixture, never active SKILL.md.
Materialize the selected fixture in a new system-temporary directory before validation or execution:

    node assets/materialize-fixtures.mjs <fixture-directory> <new-temp-directory>

The command rejects overwrites, discovery roots and symlinks. Use the resulting
sandbox path as the evaluation target; never activate the source fixture as a Skill.
