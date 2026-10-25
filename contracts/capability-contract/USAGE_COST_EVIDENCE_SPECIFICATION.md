# Goose Usage and Cost Evidence 1.0.0

This portable contract records executor and grader observations without changing older contracts. Every input, output, cached, reasoning, and total token count; actual turn count; wall/model latency; and quality measurement is `{ value, unavailableReason }`. A value is finite and non-negative, or null with a metric-specific enumerated reason—usage/turn and latency reasons are telemetry availability reasons, cost reasons are pricing/currency reasons, and quality reasons are grading availability reasons. Tokens and turns are safe integers. Absence and unavailable cost are never zero and tokens are never estimated from text.

Requested and resolved provider/model identities are retained with resolution confidence. Exact Goose, adapter name, and adapter version are mandatory. Pricing is nullable and, when present, binds source, source version, retrieval/effective dates, currency, resolved provider/model, and one rate per token category. Cost is computed only when all categories, rates, temporal coverage, and resolved identity are compatible; otherwise it is null with a reason.

`computeUsageCostEvidence` returns separate executor/grader totals and their combined total. `computePairedUsageCostDelta` retains the same separation for paired evidence. Quality-per-dollar is emitted only when both quality and a positive complete combined monetary cost exist. Hashes use sorted-key canonical JSON and SHA-256. Paired deltas accept only complete normalized evidence outputs: each side is inert-validated, recomputed from its observations, and compared with its supplied hash and derived fields before any delta is read.

Inputs are closed inert JSON. Proxies, getters, cycles, sparse arrays, symbols, exotic prototypes, non-finite numbers, secret-like keys/values, prompts, responses, credentials, and raw provider payloads are rejected. Consumers must additionally protect the fixture/evidence storage boundary.

All identity strings are non-empty and trimmed. Timestamps use the strict UTC RFC 3339 profile YYYY-MM-DDTHH:mm:ss[.fraction]Z; offsets, leap seconds, and impossible calendar dates are rejected consistently by runtime validation.
