# External runtime verification

Use before promising a mode or target.

Identify the intended target host separately from the authoring harness. Record
exact observed host revision/profile/version for installation proof and exact
language runtime/toolchain/OS/CPU/ABI for artifact proof. Evaluation candidate/judge
selections or results do not replace either gate; do not infer their defaults from
the target host or harness. Apply host-specific checks only to the applicable target.

| Claim | Independent observable proof |
|---|---|
| Source/Git artifact is contained | Copy just declared artifact closure, run outside repository; no sibling/build/package fallback |
| Arguments and failures preserve contract | Subprocess argv result, exact stdout/stderr/status; signals tested separately |
| Unsafe mappings fail before execution | Traversal/absolute/symlink/hash/missing-entry mutations yield nonzero and no child output |
| Dependencies are complete | Inventory versus locked transitive closure, resources/licenses; clean environment execution |
| Profile is unambiguous | Supplied contract versus staged files; incompatible extra entrypoints blocked without precedence guessing |
| Native target works | Actual matching OS/CPU/ABI run with source interpreter/build tools unavailable |
| Reproducible artifact | Two controlled builds compare bytes/inventory, pinned toolchain/lock evidence |
| Host discovers/executes | Separately authorized isolated host installation, exact revision/profile and observed workflow |

For a design-only request, state proposed checks, not fabricated receipts. For a verification request, run only supplied declared entrypoints within authority; inspect fixture code first. Compare representative success/failure behavior, capture commands, statuses and hashes, and separate not-tested target cells. Format review, component execution, host discovery and publication authority are independent.

A tiny interpreted JS fixture can prove its own path/argv/status boundary. It cannot prove arbitrary dependency closure, Node loader security, native execution, signals not exercised, or Rust/Python behavior. Avoid using fake native forwarding fixtures as interpreter-free proof.
