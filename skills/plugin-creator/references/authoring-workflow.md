# Author or migrate a Plugin

1. Identify the desired outcome, target host and authorized destination. Before
   writing, read [format](goose-plugin-format.md) and [portable conformance](portable-conformance.md).
   Inventory existing files; preserve originals. Ask only about missing choices
   that block safe output, not a blanket questionnaire.
2. For migration classify each source component portable/adapt/replace/unsupported.
   Keep a separate destination and retain unmapped content plus migration notes.
   A custom agent is a separate host surface, not a portable plugin component.
3. Author canonical 1.0.0 root plugin.json and only requested resources. Route
   bundled Skill content to skill-creator. For MCP use root mcp.json with closed
   transports; document prerequisites without credential values. A declaration
   does not implement or prove an MCP server. Route executable implementation or
   closure to the available packaging specialist rather than inventing runtime proof.
4. If Goose activation is requested, review the selected source contract and
   governed MCP path. Block duplicate non-exclusive activation and obtain approval
   before changing selection. For native hooks read [target compatibility](goose-target-compatibility.md)
   before event selection; preserve hooks/hooks.json and route handler safety.
5. Compare produced documents to recorded schemas, strict authoring needs and
   target-host constraints separately. Check contained paths and changed component
   resources; report exact source files and findings, not a retired validator pass.
6. Verify preservation using original/destination inventories and hashes when
   available. Report created files, mapping decisions, defects and unverified
   activation/behavior. Stop at the requested scope; archive, installation,
   evaluation and publication are not automatic follow-up phases.
