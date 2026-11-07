# Fixture owner contract

This is a dependency-free interpreted JS fixture, not a native binary or distributed creator runtime. Invoke the declared entrypoint with Node >=22.22.2: `node launch.mjs <operation> [args...]`. `echo` writes its remaining literal argv as one JSON array plus newline and returns 0; `fail` writes `fixture failure` plus newline to stderr and returns 7; unknown operation writes `unknown operation` plus newline and returns 2. Invalid artifact mapping/hash/link/missing file returns 1 with `fixture refused` plus newline, without payload stdout.

artifact.json is only this fixture owner's supplied contract: profile interpreted-js, relative entry and SHA-256. It is not plugin metadata. The payload has zero dependencies. Copies may be mutated for tests; retained inputs must not change. No compilation, installation or model is needed. No native, host, general loader-security or race-resistance guarantee is supplied.
