# Installation review without retired diagnostics

Use only for an explicitly selected installation or distribution. Installation,
repair, network access and execution are separate permissions.

1. Identify the intended host, distribution source and selected path. Consult
   current official [Goose plugin documentation](https://goose-docs.ai/docs/guides/context-engineering/plugins)
   before proposing host commands; do not launch suspect resources to diagnose them.
2. Review the supplied manifest, component inventory, contained paths and stated
   runtime requirements. Compare hashes only against a trusted supplied inventory;
   matching replaceable local manifests is not authenticated publisher provenance.
3. Report missing/modified files and exact scope. Use a complete trusted distribution
   for an authorized repair; do not prescribe npm installs/builds for an installed
   Git distribution or mutate live installations during review.
4. Separate static integrity, installed discovery, actual activation, behavioral
   effectiveness and publication approval. Missing host evidence stays unverified.

No current plugin-creator `doctor`, `verify`, `install` or native executable is
supplied. Shared Skill format validation and evaluation do not replace installation
integrity checks. The [historical diagnostic contract](historical/pre-ap-9ato/references/installation-diagnostics.md)
is retained only as original evidence, not an executable fallback.
