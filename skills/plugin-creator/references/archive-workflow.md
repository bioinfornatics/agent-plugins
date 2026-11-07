# Requested archive workflow

1. Confirm the input package and new output path. Read [format](goose-plugin-format.md)
   and review components before packaging. Use an isolated copy, preserving originals.
2. Route executable dependencies/native packaging to plugin-script-packaging when
   applicable. Ordinary local archive tooling may package approved source files;
   no creator package command is supplied. Do not install dependencies or run
   bundled handlers/MCP servers merely to create an archive.
3. Establish intended root identity from manifest name. Include only the required
   canonical package contents, not fixture suffixes, temporary files, secrets,
   repository metadata or historical evaluation workspaces. Reject unsafe links,
   special entries or paths escaping the root rather than following them.
4. Inspect archive entries, exact required contents, root identity and integrity
   with actual tooling. Compare extracted bytes with source inventory/hashes if
   extraction is permitted; do not rely solely on a packaging command's exit code.
5. Report path and observed checks, unresolved prerequisites and proof gaps.
   Archive integrity and manual format review do not establish installation,
   host activation, behavioral effectiveness or publication approval. No model
   campaign or obsolete full-eval/receipt workflow is required to deliver an archive.
