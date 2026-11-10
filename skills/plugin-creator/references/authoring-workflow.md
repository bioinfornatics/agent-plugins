# Author or migrate a Plugin

1. Identify the desired outcome, target host and authorized destination. Before
   writing, read [portable format](portable-plugin-format.md) and [portable conformance](portable-conformance.md).
   Inventory existing files; preserve originals. For a Goose target or existing
   Goose migration/review, read [Goose integration](goose-plugin-format.md) before
   mapping or writing activation resources. Ask only about missing choices that
   block safe output, not a blanket questionnaire.
2. For migration classify each source component portable/adapt/replace/unsupported.
   Keep a separate destination and retain unmapped content plus migration notes.
   A custom agent is a separate host surface, not a portable plugin component.
3. Author canonical 1.0.0 root plugin.json and only requested resources. Route
   bundled Skill content to skill-creator. For MCP use root mcp.json with closed
   transports; document prerequisites without credential values. A declaration
   does not implement or prove an MCP server. Route executable implementation or
   closure to the available packaging specialist rather than inventing runtime proof.
4. Apply only the selected target-host integration. For Goose, preserve native
   hooks/MCP sources, block ambiguous layouts and obtain approval before changing
   selection. Route hook event/handler authoring and safety to hook-creator; do not
   author host integration merely because the harness is Goose.
5. Compare produced documents to recorded schemas, strict authoring needs and
   target-host constraints separately. Check contained paths and changed component
   resources; report exact source files and findings, not a retired validator pass.
6. Verify preservation using original/destination inventories and hashes when
   available. Report created files, mapping decisions, defects and unverified
   activation/behavior. Stop at the requested scope; archive, installation,
   evaluation and publication are not automatic follow-up phases.
