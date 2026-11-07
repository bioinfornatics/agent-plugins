# Full-eval execution reliability

Reliability applies only to `plugin-creator full-eval`; it does not change component runtimes or the execution event schema.

## Durable policy and budget

Each run persists its normalized reliability plan and cumulative ledger in `full-eval-state.json`. A logical job keeps its stable `id` and idempotency key while every execution receives a distinct UUID `attempt_id`. Successful jobs whose input and output hashes are still valid are never rerun on resume. A stale running attempt is closed as failed before a new attempt is allocated.

Retries are bounded by `max_attempts`, exponential `backoff_ms` capped by `max_backoff_ms`, and the run-wide `total_budget_ms`. The cumulative budget and attempt count are restored rather than reset by resume. A terminal failed job records an explicit stop reason such as `nonretryable`, `retry-limit-exhausted`, or `total-budget-exhausted`.

## Leases and cancellation

The workspace lease records owner, process, acquisition, heartbeat, expiry, monotonic generation, and an unguessable fencing token. Checkpoints renew the heartbeat and are accepted only while both the lease and durable fence still match that generation and token. A lease is reclaimable when its owner is gone, its expiry has passed, **or** its heartbeat age reaches `stale_after_ms`, even when the recorded PID remains live. Takeover advances the fence before terminating a stale live owner, so that owner cannot checkpoint after recovery.

Cancellation records its request and grace period and first allows cooperative completion. Forced cancellation then discovers the owner process tree, including descendants that created detached process groups, sends `SIGTERM` followed by `SIGKILL` to survivors, and waits for termination. The ledger records every signal and target plus the final outcome and any survivors. A forced-cancel checkpoint is written only by the new fenced owner; tests verify that no package descendant remains alive or continues writing.

## Crash safety and fault injection

Checkpoints are written to a unique file, synchronized, and atomically renamed. They include all completed job evidence and attempt history. Orphaned partial checkpoint files are discarded on entry; the last complete checkpoint remains authoritative. Resume may truncate only an incomplete final JSONL fragment, then consumes the existing event stream without changing its contract.

Tests may set `PLUGIN_CREATOR_FAULT_INJECTION` to `checkpoint-before-write`, `checkpoint-partial-write`, `checkpoint-before-rename`, or `checkpoint-after-rename`. The exact value throws a controlled fault. Prefix it with `process-crash:` to terminate the process at that point, allowing subprocess crash-recovery tests without production-only branches.
