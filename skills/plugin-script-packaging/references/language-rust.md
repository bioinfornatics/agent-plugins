# Rust external packaging

Use only for Rust/Cargo. [Historical snapshot](historical/language-rust.md) is retained, not a current creator release contract.

Keep Cargo workspace, Cargo.toml, committed Cargo.lock, tests and source in the build workspace. Pin rustc/toolchain, target triples and features; build with --locked in authorized build/CI. Review build scripts, proc macros, licenses, native libraries and platform APIs. Never run Cargo at end-user installation.

Rust source is not an installed runtime. Git installation needs contained prebuilt binaries for every supported target and an exact selector defined by the supplied contract. Reject unsupported targets, wrong ABI/architecture, missing binaries, symlinks and hash mismatch; no closest-target or compilation fallback. If safe target selection cannot be supplied, mark Git mode unsupported and offer target-specific native archives.

Record libc/ABI, dynamic library requirements, Rust version, target triple, Cargo lock hash, features and binary hash. A native archive normally carries one target executable plus declared resources/notices, not a Cargo workspace. Do not retrofit a Node launcher, node_modules or a Python zipapp.

Proof requires locked build records, linkage inspection and actual matching-target execution without Cargo/source. Cross-build success remains not-tested for runtime behavior. Compare argv/stdout/stderr/exit contracts between promised artifacts, test unknown/wrong target rejection, and mark unavailable platform cells explicitly.
