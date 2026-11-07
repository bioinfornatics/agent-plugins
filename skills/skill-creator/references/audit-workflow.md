# Audit a Skill

1. Read the actual candidate and requested scope without mutation. Identify its
   intended user outcome, activation responsibility and reachable resources.
2. Use [authoring](authoring.md) and relevant [patterns](skill-authoring-best-practices.md)
   to inspect metadata, ordered actions, permission boundaries, conditional links,
   resource containment and the 500-line ceiling. Apply recorded format sources,
   not host-specific frontmatter borrowed from another component.
3. Inspect scenarios using [scenario design](evaluation-design.md) when present or
   requested. Check whether natural questions reach the central claims and whether
   artifacts can independently prove each criterion. Missing fixtures or unsupported
   constraints are input defects, not candidate failures.
4. Run available read-only standalone format validation with the canonical path;
   record results separately from semantic findings. Cite file/section evidence for
   each actionable defect and its consequence. Prioritize concrete repairs and
   report missing proof. Stop without editing, installing or launching models.
