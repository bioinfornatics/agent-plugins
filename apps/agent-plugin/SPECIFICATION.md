# Agent Plugin — specification index

The canonical product specification is now [specifications/product.md](specifications/product.md).
This index preserves the previous entrypoint; do not maintain a second requirements copy here.

Current authorized scope: `apps/agent-plugin`, `agent-plugin evaluation`, local
validation and JSON preparation only. Execution without `--dry-run` is explicitly
unavailable after validation. Future campaign requirements are not delivered
features; installed `skills/skill-creator` runtime remains unchanged.

## Read by category

- [Product](specifications/product.md): goals, scenarios, comparison, grading, analytical data and HTML requirements.
- [Architecture](specifications/architecture.md): project map, dependencies, ports, entrypoints and resource ownership.
- [Conventions](specifications/conventions.md): naming, discoverability, interface/implementation placement.
- [Development](specifications/development.md): commands, tests, build gaps and verification.
- [Debugging](specifications/debugging.md): reproduction, classification, repair and evidence.
- [Deployment](specifications/deployment.md): selected Git/Node runtime profile, migration gaps and publication boundaries.

Read [AGENTS.md](AGENTS.md) before modification; use its conditional routing rather than
loading every category. Historical links to this document remain valid as an entrypoint;
section-level references should follow the canonical product document.
