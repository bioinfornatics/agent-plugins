# External runtime architecture

These are packaging principles for a requested external runtime, not supplied tooling or a new Agent Plugins schema. Only the current documented contract is applicable.

## Contract before layout

Identify the declared logical command, argv, stdout/stderr, exit/signal behavior, side effects, runtime floor, target set and artifact profile. Read the owner's actual manifest/runtime contract. Portable plugin metadata does not by itself standardize executable selection; use only documented vendor fields, or record missing decisions in prose. Whole-manifest conformance review belongs to plugin-creator.

## Source and artifact ownership

Editable application sources, tests, manifests and locks belong in the build workspace. Each installed Skill must carry its executable closure with no repository or sibling fallback. Build before installation: end users must not install dependencies, compile or access a package index.

Choose the language-specific artifact, not a universal Node layout: emitted JavaScript plus locked dependencies; Python interpreter artifact plus locked packages/resources; Rust exact prebuilt target binaries or unsupported Git mode. A packaged Python artifact necessarily contains interpreted code; excluding editable build trees does not mean prohibiting interpreted runtime code.

## Launcher boundary

Resolve mappings from the installed component, not cwd. Reject absolute/traversal paths and symlink components/escapes before invocation; check declared hashes and target identity. Forward an argument array without shell interpolation and preserve stdout, stderr, exit status and signals. Missing entrypoints are blockers, not permission to search PATH or rebuild.

A containment check is not an OS sandbox or protection from concurrent hostile filesystem replacement. Test deterministic failures before child execution, not merely an error message after it.

## Profiles and publication

Generate requested stages using the project's declared tooling and locked inputs. Stage atomically into a clean tree, retain resources/licenses/notices and inventory hashes. Check mixed material against the actual profile contract: reject ambiguous or contract-incompatible entrypoints; do not invent precedence. Explicitly governed multi-profile archives are not automatically defective.

Native production requires an independently established compiler/freezer, ABI/target and dependency closure. A source run proves neither native execution nor host activation. Matching-target execution and separately authorized installation/publication are different gates.
