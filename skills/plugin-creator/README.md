# Plugin Creator

Native Goose hooks use `hooks/hooks.json`. Read [Goose target compatibility](references/goose-target-compatibility.md) for exact source profiles, PreToolUseResult support and adapter activation limits before creating or validating hooks.

A dedicated creator for Goose/Open Plugins installed under `.agents/plugins/`.
It creates, ports, validates, tests, and packages plugins containing skills,
hooks, MCP server declarations, or combinations of these components.

## Scope

| Asset | Location | Managed here? |
|---|---|---|
| Plugins | `.agents/plugins/`, `~/.agents/plugins/` | Yes |
| Standalone skills | `.agents/skills/`, `~/.agents/skills/` | No — use `agent-plugins:skill-creator` (or standalone `skill-creator`) |
| Standalone agents | `.agents/agents/`, `~/.agents/agents/` | No — use `agent-plugins:agent-creator` (or standalone `agent-creator`) |
| Repository guidance | `AGENTS.md` | No — instructions only |

Bundled skills under `<plugin>/skills/` are managed because they are plugin
components. This does not make the project a general-purpose skill creator.

## Component routing

- Bundled skills route to `agent-plugins:skill-creator` (or standalone `skill-creator`).
- Hooks and hook scripts route to `agent-plugins:hook-creator` (or standalone `hook-creator`).
- Standalone custom agents route to `agent-plugins:agent-creator` (or standalone `agent-creator`).
- Manifest, MCP, packaging, and whole-plugin validation stay in `agent-plugins:plugin-creator` (or standalone `plugin-creator`).

The current Goose custom-agent contract uses `.agents/agents`; do not package an
`agents/` directory unless the selected target format explicitly supports it.
For the audited Goose revision, plugin `agents/` is not auto-installed or
auto-discovered as custom agents.

## MCP: portable artifact versus Goose host

Portable Agent Plugins 1.0.0 defines root `mcp.json` with `$schema` and
`mcpServers`; this is the public artifact and supports the recorded closed
`stdio`, `streamable-http`, and `sse` variants. Current Goose does **not**
auto-discover that filename. Its plugin loader defaults to root `.mcp.json`,
accepts inline or path-based `plugin.json.mcpServers`, and can be pointed
explicitly to `./mcp.json`. Goose currently converts only stdio declarations (`command`, optional `args`,
`env`, and `cwd`) into extensions. Its serde model ignores unknown fields, so an
explicitly selected portable stdio-only `mcp.json` can load even with `type` and
top-level `$schema`. Portable `streamable-http` and `sse` entries fail because
`command` is required and this loader has no remote transport mapping. Validate
portability and Goose runtime compatibility separately.

## Unified CLI

Use `plugin-creator <init|validate|verify|package|full-eval>`. All subcommands accept `--format text|json`, `--quiet`, and `--help`. Exit codes are `0` success, `1` failure, `2` usage, and `3` blocked. Packaging runs schema and structural validation. `full-eval` returns a stable versioned envelope in JSON mode.

## Create a plugin

```bash
plugin-creator init my-plugin \
  --path /tmp \
  --description "Reusable Goose workflows" \
  --skill my-workflow \
  --with-hooks
```

## Validate

```bash
# Agent Plugins 1.0.0 schema conformance (offline, machine-readable)
plugin-creator validate /path/to/my-plugin --format json

# Structural and Goose-specific operational checks
plugin-creator validate /path/to/my-plugin
```

The validators check:

- `plugin.json` and component declarations;
- bundled `SKILL.md` files;
- hook events, matchers, actions, and referenced files;
- portable root `mcp.json` and its Agent Plugins 1.0.0 schema;
- Goose host `.mcp.json` / `plugin.json.mcpServers` compatibility and stdio runtime limits;
- plugin-relative paths and unresolved placeholders.

## Evaluate a complete plugin

Plugin evaluation goes beyond schema and structural validation. Load
`agent-plugins:plugin-creator` and request an evaluation; it coordinates the
specialized creators and requires traceable evidence before release.

```text
freeze baseline
  → evaluate every behaviorally changed Skill
  → run plugin integration scenarios
  → grade paired outputs
  → aggregate benchmark.json and benchmark.md
  → generate the HTML review viewer
  → verify component and plugin release gates
```

Integration scenarios should exercise routing between Skills, trigger overlap,
hook effects, and cross-component handoffs. Every discovered Skill, agent, hook,
and MCP component supplies typed evidence with applicability and a current
component source hash. Full plugins also supply an integration receipt covering
all components and explicit handoffs. The plugin-level receipt aggregates each
component separately and records artifacts and human-review status. See
[Typed Component Evidence](references/component-evidence.md). Missing execution capabilities produce
`evaluation: blocked`; static validation or an ad-hoc comparison is not reported
as a successful behavioral evaluation.

Example Goose request:

```text
Load agent-plugins:plugin-creator and evaluate this plugin against the previous
release. Include Skill receipts, routing and hook integration scenarios, the
combined benchmark, release gates, and a static HTML review report.
```

## Full-eval orchestration

Use the deterministic orchestrator when an AI agent needs to evaluate a whole plugin without guessing the next step:

```bash
plugin-creator full-eval /path/to/plugin --workspace /path/to/plugin/evaluations/full-eval --dry-run --format json
plugin-creator full-eval /path/to/plugin --workspace /path/to/plugin/evaluations/full-eval --resume --format json
```

The fixed phases are validation, typed component discovery, component evaluation receipt detection, integration output detection, packaging, and release verification. Skill commands use the bundled skill-creator CLI by absolute path, while agent, hook, and MCP entries provide explicit specialist handoffs. Each completed component evaluation writes `receipt.json` exactly where plugin orchestration expects it. Dry-run is side-effect free. Rerunning (optionally with `--resume`) discovers existing receipts and outputs, making each phase idempotent. The envelope reports exact Skill paths, expected receipt paths, component `plugin-creator full-eval` commands, phase statuses, and `next_actions`.

This command never runs or simulates an LLM. The workspace must be a proper subdirectory of the plugin's `evaluations/` directory; integration and archive paths must stay inside that workspace. Evaluation files are therefore excluded consistently from source fingerprints and release archives. Cancellation requires an existing persisted graph and uses its saved configuration. Expired or heartbeat-stale leases are reclaimed even if their PID is live; generation/token fencing prevents the displaced owner from checkpointing. Forced cancellation terminates the complete package process tree and persists signal targets, outcome, and survivors. It stops with exit code 3 when Skill receipts, `integration/benchmark.json`, `integration/review.html`, test evidence, or explicit `--human-review pass` are absent. Once prerequisites exist, it packages the plugin and invokes the existing release verifier. Inputs can be overridden with repeated `--component-receipt`, `--integration`, `--archive`, and `--tests-status pass`.

Non-dry runs append a versioned durable history to `full-eval-events.jsonl`. Progress is projected purely from that canonical stream: plain terminal text supports `--progress quiet|normal|verbose`, `--format jsonl` is machine-only JSON Lines, `--format ci` groups failures/artifacts/resume guidance, and `--format review` renders accessible historical replay with live/completed labels. Replay reconstructs phase and job status counts and rich periodic heartbeat telemetry (retry, elapsed time, workers/models, checkpoint freshness, budget, and cautious local ETA), detects interrupted tails, tolerates unknown additive event types, and rejects unknown schema majors. Sensitive values and full/private prompts are excluded or redacted; artifacts use opaque protected references. See [Durable full-eval execution event stream](references/execution-event-stream.md) and [Full-eval execution reliability](references/execution-reliability.md).

## Package

```bash
plugin-creator package /path/to/my-plugin ./dist/my-plugin.zip
```

## Installation

```bash
goose plugin install https://github.com/example/my-plugin.git
```

For local development, place the plugin under the project or user
`.agents/plugins/` directory and start a new Goose session.

## Golden offline E2E journeys

Three immutable natural-language journeys exercise the complete creator lifecycle with novice defaults and bounded expert overrides. A deterministic offline executor loads generated candidate policies, runs shipped validators and varied scenario repetitions in cancellable child processes, derives productivity only from evaluator-owned observed-action events (never candidate-reported counters) while reporting wall time separately, and archives timer-heartbeat provenance. Independent challenger children inspect candidate, records, and criteria files; finding-specific changes are behaviorally rerun. Its evidence is honestly `executed: true` and `llm_executed: false`, it can never activate an artifact, and success remains **pending production approval**. See [Golden end-to-end journeys](references/golden-e2e-journeys.md).

## Decision-comprehension research

The offline `decision-research` command analyzes a strict anonymous session format for three report-comprehension tasks across developer and nonexpert cohorts. Consent, neutral facilitation, privacy/retention constraints, metrics, coverage, and blocking gates are documented in [Decision-comprehension research kit](references/decision-comprehension-research.md). Included synthetic records are test fixtures and are always excluded from evidence.

## Format status

The project targets Goose's Open Plugins adapter and the Open Plugins
conventions. Plugin manifests, hooks, and MCP runtime behavior are not part of
the Agent Skills specification. Host-specific behavior is documented as such.