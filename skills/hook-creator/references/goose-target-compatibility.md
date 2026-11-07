# Current Goose hook contract

For ordinary requests use current stable Goose and current official documentation:
[Hooks](https://goose-docs.ai/docs/guides/context-engineering/hooks) and
[Plugins](https://goose-docs.ai/docs/guides/context-engineering/plugins).
Read on 2026-11-07. Exact host versions and historical evidence live in the separate
[compatibility matrix](compatibility-matrix.md); they are not alternate default workflows.

## Native layout and authoring

Use `<plugin>/hooks/hooks.json` and contained executable command handlers.
Distributor namespaces are not native activation paths. Multiple layouts are rejected;
review preserves native hooks and blocks adapter-only migration without verified
activation. New component authoring must preserve manifest bytes unless a manifest
change is separately authorized. Structural review never proves lifecycle activation.
No retired creator init/validator command supplies that proof.

## Events and failure policy

Only PreToolUse and Stop are blocking events. `PreToolUseResult` is observation only;
it cannot change allow/deny. Matching observers are awaited and can add latency;
best-effort delivery is not durable audit evidence. Matchers are regular expressions,
not globs; anchor exact matches. Never log secrets in payloads or denial reasons.

Current command actions accept `on_failure` for PreToolUse: `allow` is the default,
`block` explicitly denies when a matching hook fails without a recognized decision.
This field is ignored for other events; Stop failures remain fail-open.
Explicit denial uses exit 2 with stderr reason or a documented block decision on stdout.
Ordinary nonzero exits are not themselves denial. Keep stdout for the decision and
stderr for diagnostics. Check the current documented protocol before modifying handlers.

## Verification boundary

Source documentation, direct handler tests and observed host activation are distinct.
Record running host version and actual checks; unavailable runtime evidence remains
unverified. Refresh official documentation and implementation before changing a public
contract. Historical snapshots remain retained format evidence, not current tooling.
