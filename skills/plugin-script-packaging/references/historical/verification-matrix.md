# Verification matrix

Record evidence independently for every promised cell.

| Dimension | Source/Git requirement | Native-release requirement |
|---|---|---|
| Entrypoint | selected branch's launcher, interpreter artifact, or exact target selector exists and is plain | target binary exists and is executable where applicable |
| Implementation | built runtime artifact, never editable source | compiled/frozen binary; no source application |
| Dependencies | exact locked runtime closure or exact prebuilt target set | embedded or explicitly bundled by the selected compiler/freezer; no undeclared package closure |
| Isolation | copied Skill runs outside repository | extracted archive runs outside build tree |
| Environment | declared interpreter/runtime only; no network install or user/global package fallback | source interpreter, build tool, and language package path unavailable |
| Integrity | runtime manifest paths/hashes match | release inventory and archive checksum match |
| Safety | traversal and symlink mappings rejected | wrong target and mixed runtime rejected |
| Behavior | representative command and failure path execute | same command and failure path execute |
| Host | actual Git installation discovers the Skill | actual archive installation discovers the Skill |

## Minimum test sequence

1. Validate Skill metadata and linked resources.
2. Build the application and run unit tests.
3. Generate the selected language's source runtime twice and check deterministic drift.
4. Copy only the Skill directory and run its declared source entrypoint.
5. Build each pinned native target in its native CI runner.
6. Smoke-test the current-platform binary with a language-appropriate clean environment.
7. Compare stable command behavior between source and native projections.
8. Assert native staging excludes every source-profile entrypoint, runtime closure, editable source, language package cache/environment, tests, and build files.
9. Tamper with a hash, mix a foreign binary, and add source runtime material; each must fail closed.
10. Install through the supported host, verify revision/profile, restart discovery, and execute one real workflow.

Cross-compilation proves only artifact production. Runtime success requires execution on that target or an explicit `not-tested` result.
