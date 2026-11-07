# TypeScript packaging

Use this reference when the implementation language is TypeScript or when no language is specified. TypeScript is the default branch, not a universal runtime requirement.

## Source/Git projection

Keep editable TypeScript, tests, `package.json`, and the lockfile in the repository application area. Compile to JavaScript before distribution. Install a small `scripts/<command>.mjs` launcher and a generated `runtime/` containing emitted JavaScript, runtime resources, the exact transitive production dependency closure, third-party notices, and a closed runtime manifest.

The launcher requires the declared Node version, resolves from its own module URL, rejects unsafe manifest paths and symlinks, and invokes emitted JavaScript with `process.execPath` and an argument array. It never runs TypeScript, installs packages, searches global modules, or falls back to repository source.

Review lifecycle scripts, optional packages, native addons, conditional exports, and platform-specific dependencies. Exclude development dependencies, package-manager shims, tests, unnecessary declarations, and source maps that expose private build paths.

## Native release projection

Compile the same source entrypoint into one executable for each pinned OS/architecture target. Bun is one supported compiler strategy, not a portable-format requirement. Pin compiler version and target, test on the matching native runner, and compare stable behavior with emitted JavaScript.

The native stage contains `scripts/<command>[.exe]` and excludes the source launcher, `runtime/`, `node_modules`, TypeScript, application source, lockfiles, and build configuration.

## Required checks

- Run the copied source Skill with Node and no repository access.
- Test dependency closure and license inventory against the lockfile.
- Reject unsupported Node and tampered runtime manifests.
- Run native binaries with Node, Bun, `NODE_PATH`, and package managers unavailable.
- Reject mixed `.mjs`/runtime and native executable material.
