# Rust packaging

Use this reference only when the implementation or requested runtime is Rust.

## Build ownership

Keep the Cargo workspace, `Cargo.toml`, committed `Cargo.lock`, source, and tests outside the installed Skill. Build with `--locked`. Pin the Rust toolchain and every target triple. Review build scripts, proc macros, native libraries, licenses, and platform APIs; do not run Cargo during end-user installation.

## Git/source projection

Rust source is not an installed runtime. If Git installation is promised, ship prebuilt binaries for every supported target under contained target-specific paths:

~~~text
skills/<name>/runtime/bin/
  x86_64-unknown-linux-gnu/<command>
  aarch64-apple-darwin/<command>
  x86_64-pc-windows-msvc/<command>.exe
~~~

Declare the exact target-to-path map in a versioned vendor extension and runtime manifest. A reviewed adapter selects only an exact supported target and rejects unknown targets, missing binaries, symlinks, hash mismatches, and ambiguous fallbacks. Do not choose a “closest” architecture and do not compile on install.

If the host cannot safely select a target-specific Git artifact, mark Git installation unsupported and distribute only native releases.

## Native release projection

Prefer one target-specific archive containing exactly one stripped executable at `scripts/<command>[.exe]`. Choose the libc/ABI contract deliberately. Record target triple, Rust version, Cargo lock hash, enabled features, binary hash, and required dynamic libraries.

## Required checks

- Run `cargo build --release --locked --target <triple>` in controlled CI.
- Generate license and dependency evidence from the locked graph.
- Inspect dynamic linkage and reject undeclared shared libraries.
- Execute on the matching native target with an empty unrelated `PATH`.
- Test unsupported-target and wrong-architecture failures.
- Keep cross-compilation results `not-tested` until executed on target.
