# TypeScript / JavaScript external packaging

Use for TS/JS or an unspecified implementation language; this is not a universal runtime requirement. [Historical snapshot](historical/language-typescript.md) is not current creator tooling.

Keep editable TS, tests, package manifest and sole lock in the build workspace. Emit JavaScript before distribution. A Node profile can carry a contained launcher, emitted JS, runtime resources, exact locked transitive production dependencies and notices. Do not require installation-time npm or execute editable TypeScript. Record the actual Node floor rather than assuming this distribution's version for every external runtime.

Resolve from the launcher's module location; verify safe declared paths, hashes and runtime compatibility before spawning emitted JS with the current Node executable and an argument array. Remove undeclared module search/loader fallback. Review lifecycle scripts, optional packages, native addons, conditional exports and platform dependencies. An empty dependency graph still needs evidence, not a fictional node_modules tree.

For explicitly requested native builds, establish and pin a compiler and supported targets; Bun is a possible external strategy, not a supplied creator executable. Compare stable stdout/stderr/exit behavior on matching native runners. Cross-compilation is artifact production only.

Required proof: isolated-copy success and failure commands; literal spaces/Unicode/metacharacters in argv; tampered hash/path/symlink/missing entrypoint rejected before child output; dependency/license inventory against locked inputs; native runs without Node/build tools only for targets actually built. Do not claim five-platform/native readiness from an interpreted fixture.
