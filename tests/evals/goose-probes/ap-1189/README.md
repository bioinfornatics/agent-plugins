# Goose 1.60.1 local probes (ap-1189.6, ap-1189.7)

Retained evidence for the 2026-11-20 rows in the hook-creator and plugin-creator
compatibility matrices. Observed with the Goose 1.60.1 binary on Linux
(`/usr/local/bin/goose`, sha256 prefix `d53092508e76af48`); one binary, no
supported version range inferred.

## Setup (disposable, outside the repository)

- Private `HOME` and `XDG_*`, `env -i`, `GOOSE_DISABLE_KEYRING=1`, dummy
  `OPENAI_API_KEY`; `config.yaml` sets `GOOSE_PROVIDER: openai`,
  `GOOSE_MODEL: fake-model`, `OPENAI_HOST: http://127.0.0.1:38917` and enables
  the builtin `developer` extension.
- [`fake-openai.mjs`](fake-openai.mjs): local OpenAI-compatible stub. It issues
  one tool call to the advertised `shell` tool, then a final text. No model and
  no credentials are involved.
- Project-scope plugins under `<project>/.agents/plugins/`, each with a root
  `plugin.json`. MCP servers run [`mcp-stub.mjs`](mcp-stub.mjs) with a marker path
  argument; the marker proves launch.
- Hook plugin `hooks/hooks.json`: `PreToolUse` without matcher runs a script that
  copies stdin to a file, writes a reason to stderr and exits 2.
- Run: `goose run --no-session --max-turns 4 -t probe` from the project directory.

## Observations

| Plugin MCP layout | Launched |
|---|---|
| root `mcp.json` only, no selection | no |
| `.mcp.json` | yes |
| `mcp.json` selected by `{"mcpServers":{"paths":["./mcp.json"],"exclusive":true}}` | yes |
| `.mcp.json` + unselected `mcp.json` (recommended default) | `.mcp.json` only |
| `.mcp.json` + non-exclusive `./mcp.json` selection, same server name | session aborted: [`duplicate-name-error.txt`](duplicate-name-error.txt) |

[`pretooluse-payload.json`](pretooluse-payload.json) is the captured `PreToolUse`
stdin (`tool_name` and `matcher_context` are `shell`). Exit 2 blocked the call:
the command's marker file was never created, and the model received
`Tool call denied by policy hook ... Do not retry; this is a policy denial, not a transient failure.`

Not exercised: `Stop`, `on_failure`, timeouts, other events, other platforms.
