# Hook Creator evaluation fixtures

Immutable Open Plugin fixtures for hook creation and safety audits. Copy a fixture before modification or execution.

- `empty-plugin/`: valid plugin root with no hooks, used for creation.
- `exact-rm-guard/`: valid PreToolUse guard with executable allow/block behavior.
- `unsafe-stop-hook/`: intentionally invalid Stop hook with bare-star matcher and missing handler.
