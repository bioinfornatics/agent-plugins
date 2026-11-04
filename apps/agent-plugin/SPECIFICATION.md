# Agent Plugin — specification index

The canonical product specification is now [specifications/product.md](specifications/product.md).
This index preserves the previous entrypoint; do not maintain a second requirements copy here.

Current source candidate: `agent-plugin evaluation` prepares a composed profile;
non-dry-run executes Goose sequentially with private HOME/XDG and a shared user
SQLite registry plus campaign-isolated evidence. Native compatibility remains unverified.

Profile/registry source mechanics are implemented and tested local/mock; historical
import, history CLI and grading remain pending. See
[product requirements and open decisions](specifications/product.md).
Planning does not authorize implementation, paid trials or publication.
Installed runtime migration remains separate from these application sources.

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
