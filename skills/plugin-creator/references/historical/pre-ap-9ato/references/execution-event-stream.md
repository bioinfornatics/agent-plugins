# Durable full-eval execution event stream

`plugin-creator full-eval` persists an append-only event stream at
`<workspace>/full-eval-events.jsonl` alongside its current-state checkpoint.
The checkpoint remains an optimization and compatibility surface; the stream is
the ordered execution history.

## Version 1.0 envelope

Every newline-terminated JSON object is closed to unknown envelope fields and
requires exactly these fields:

- `schema_version`: `1.0` for known events;
- `event_id`: a UUID unique within the stream;
- `event_type`: event discriminator;
- `run_id`: one non-empty identifier shared by the stream;
- `job_id`: a non-empty job identifier or `null`;
- `sequence`: contiguous, one-based integer;
- `timestamp`: canonical RFC 3339 UTC with millisecond precision
  (`YYYY-MM-DDTHH:mm:ss.sssZ`), strictly later than the preceding timestamp;
- `causal_event_id`: exactly the preceding event ID, or `null` on sequence 1;
- `data`: a closed event-specific object.

Duplicate IDs, malformed timestamps, timestamp regressions, gaps, forks, run
mismatches, unknown fields, and unsupported schema majors fail closed.

## Closed event data schemas

Required fields are not optional. Fields absent from the “allowed additions”
column are rejected. Status values are enumerated rather than free text.

| Event | Required data | Allowed additions |
|---|---|---|
| `evaluation-created` | `status=planned`, `graph_hash`, `plugin`, `workspace` | none |
| `phase-transition` | `phase`, `status` in planned/running/pass/fail/blocked/skipped/succeeded/failed/cancelled | none |
| `job-transition` | `phase`, `status` in planned/running/succeeded/failed/blocked/cancelled/skipped | positive `attempt`, protected-artifact `outputs[]` |
| `heartbeat` | run `status`, `resume`, closed job `counts`, retry counters, `elapsed_ms`, active worker/model arrays, checkpoint summary, budget, stale status, and canonical ETA snapshot (separate current-phase and total status, reasons, timestamps, sample counts, ranges, confidence, and basis/method) | none |
| `retry` | `phase`, positive `attempt` | none |
| `checkpoint` | positive `revision`, run `status`, protected `state`, closed `jobs[]` snapshots | none |
| `cancellation` | `status=cancelled` | none |
| `failure` | `status=failed` or `failure` | `phase` |
| `completion` | `status=success`, protected `archive` | none |
| `approval-requested` | `phase`, `status=blocked`, `reason` | none |

Protected artifact objects are themselves closed and contain
`kind=protected-artifact-ref`, an opaque `sha256:<digest>` reference, and an
optional SHA-256 content digest.

## Append and replay guarantees

Each append obtains an exclusive stream lock, reloads and validates all complete
records, compares the observed tail with the writer's last observation, derives
the next sequence/timestamp/causal ID, appends one line, synchronizes it, reloads,
and verifies the committed tail. Consequently, independent writer instances and
processes cannot allocate the same sequence or create a causal fork.

Replay accepts only newline-terminated records. A trailing partial record is
ignored for projection and reported as `interrupted_tail`; append is refused
until an operator repairs or archives the stream. Replay reconstructs phase and
job statuses/counts. Unknown event types under schema major 1 remain visible in
`unknown_events` but do not affect projection; known events require exactly
version 1.0. Unknown schema majors are rejected.

## Data protection

Event data is recursively sanitized before validation and persistence. Every key
containing `prompt` (including camelCase forms), common credential keys such as
`apiKey`, `accessToken`, `clientSecret`, authorization, cookies, passwords,
and secrets is replaced with `[REDACTED]`. Common credential values are also
redacted, including Bearer credentials, API-key assignments, AWS access keys,
GitHub tokens, and `sk-` keys. Full/private prompt content must never be stored.
Artifacts are represented only by opaque protected references and require
separate authorization to resolve.

## Progress projections

`progress_projections` is a pure replay layer over the validated canonical event array. It does not read checkpoints, the clock, environment variables, or terminal capabilities. Each projection therefore reports the same current phase, job counts, lifecycle state, and consumed/total/remaining budget:

- terminal text: `--format text --progress quiet|normal|verbose` (plain text, no ANSI dependency);
- machine stream: `--format jsonl` (one JSON object per non-empty line and no human lines);
- CI log: `--format ci` (groups summary, failures, protected artifact links, and resume guidance);
- historical review: `--format review` (accessible, script-free HTML replay with explicit `live` or `completed` lifecycle labels).

`evaluation-created` may include `job_count` and a budget snapshot. Checkpoints may include a budget snapshot. While a phase is active, `full_eval` emits rich heartbeats at the plugin-local reliability heartbeat interval. ETA remains `calculating` until five comparable completed full-eval jobs exist, becomes a cautious range with explicit confidence, and is `unavailable` when no worker is active; no heartbeat is emitted after a terminal event. Counts, retries, elapsed time, workers/models, checkpoint freshness, budget, and ETA are all replayed consistently by every projection. Protected artifact references never reveal local paths.
