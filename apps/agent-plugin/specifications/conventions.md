# Code conventions and discoverability

Read before adding or moving contracts, implementations or shared helpers.

## Discoverability and naming

- Each meaningful reusable contract SHOULD have a dedicated, descriptive file.
  Named concrete boundary implementations SHOULD be in a separate nearby file
  and explicitly declare `implements` where it improves navigation.
- Keep `CliOutput` in `adapters/inbound/cli/cli-output.ts` and
  `StreamCliOutput implements CliOutput` in `stream-cli-output.ts`.
  Do not hide its production implementation in an anonymous object in main/index.
  Small test doubles may remain inline.
- `CliOutput` is a CLI-local contract, not a domain/application port. Commander
  configuration belongs in `create-cli.ts`, not in the output contract file.
- The composition root assembles dependencies and factories only; command policy,
  presentation and error translation live in named inbound handlers.
- Nontrivial production callbacks MUST have a discoverable named implementation.
  Keep `EvaluationHandler` beside its factory `createEvaluationCommandHandler`
  in `handle-evaluation-command.ts`; consumers that only need the callback
  signature use a type-only import. Simple contract aliases may share a cohesive
  module with their implementation; do not require one file per type.
  Inline callbacks remain appropriate for simple wiring and test doubles.
- Files use kebab-case; classes/types PascalCase; functions/values camelCase.
  Prefer operation/capability names over generic `Manager`, `Service` or `Utils` buckets.
- Prefer pure functions and plain data for rules and transformations. Use classes
  when state, resource ownership or a named implementation clarifies a boundary.
  Do not require a class per use case or interface per class.
- Avoid speculative base classes, dependency-injection containers, empty contract
  types, barrel exports and framework abstractions without a concrete need.
  Preserve the existing `.gitkeep` placeholders until their directories gain code.


Keep tests under `tests/` and new implementation under `src/`. Document changes
to responsibilities in [architecture.md](architecture.md). Product decisions belong
in [product.md](product.md) and Beads, not undocumented helper defaults.
