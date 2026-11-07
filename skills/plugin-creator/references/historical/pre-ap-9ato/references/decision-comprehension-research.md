# Decision-comprehension research kit

This offline kit prepares governed human research; it does not claim research occurred. Synthetic fixtures are validator data and never evidence.

## Protocol, privacy, and collection

Use the immutable task catalog at `assets/decision-comprehension/protocol.json`. Copy its version and SHA-256 into the study record. The validator binds each task ID to the canonical journey and expected decision, so a recorder cannot make an incorrect selection appear accurate by changing `expected_decision`. Each session covers validation, evaluation, and one release scenario; across actual sessions cover all four expected categories: validation failure, evaluation failure, blocked, and approval required. Cover every golden journey in both developer and nonexpert cohorts.

Before recording, explain purpose, retained fields, voluntary participation, withdrawal/deletion, and obtain informed recorded consent. Store a UTC `consented_at` timestamp and deletion date from the consent day through 90 days later. Use opaque unique `anon-*` IDs. Scan every string: no names, organizations, email, URLs, IP addresses, user home paths, recordings, transcripts, or reversible identifiers. Use only the versioned neutral facilitator script.

Record completion, time to first candidate, interventions, selected decision, confidence, missing-evidence identification, and—for the evaluation journey—the time and accuracy for finding the highest-severity regression. Findings require code, P0–P3 severity, classification, summary, and structured locator/observation evidence.

## Analyze and gates

    plugin-creator decision-research --input ./sessions.json --format json

Invalid input exits 2, pass exits 0, and blocked exits 3. Gates require eight non-synthetic sessions, 80% unassisted completion, 90% decision accuracy, median highest-severity regression identification at most 120 seconds, both cohorts across every golden journey, all four decision categories, and no unresolved P0/P1. Time to first candidate is reported separately and is not the two-minute gate. For P0/P1, the report emits deterministic `bd create` suggestions but never executes them.
