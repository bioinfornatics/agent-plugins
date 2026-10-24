# Agent Plugins

Ready-to-use creators for Agent Skills, custom agents, hooks and complete plugins.

## Requirements

Node.js 22 or newer for the Git distribution. Compiled creator implementations and production dependencies are included inside each Skill. No npm install or build is required after installation.

## Installation

Install from this repository with the documented Goose plugin installation mechanism. The default main branch contains the production distribution. Native release archives are a separate, platform-specific installation option; Goose's Git installer does not select them automatically.

See the [Goose Plugins guide](https://goose-docs.ai/docs/guides/context-engineering/plugins).

## Creators

- agent-plugins:skill-creator — author, evaluate and improve one Skill.
- agent-plugins:agent-creator — author and validate a custom agent.
- agent-plugins:hook-creator — author and validate lifecycle hooks.
- agent-plugins:plugin-creator — validate and assemble a complete plugin.
- agent-plugins:plugin-script-packaging — plan contained source/native execution.

Each skills/ directory is independently installable. Evaluation results are evidence-backed; missing evidence is never a pass.

## Development and updates

main is generated; do not edit or merge authoring source into it. Source, tests, migration/rollback instructions and native release tooling live on development. Open contribution pull requests against development. Development-to-main pull requests are promotion review requests, never ordinary source merges. Read-only CI clean-builds the exact source head, rejects committed runtime drift and verifies the Git distribution. Exhaustive isolated reproducibility and five-platform native packaging run separately on schedule or manual dispatch. Independent approval starts Promote production automatically; manual dispatch on development with the request number and expected main SHA is a recovery path. Successful publication creates a normal fast-forward generated-tree commit and closes the request without merging.

distribution-manifest.json records the exact development commit/tree and the SHA-256 inventory. A Git-managed update follows main; manually placed archive installations require separate updates. License: CeCILL-C.
