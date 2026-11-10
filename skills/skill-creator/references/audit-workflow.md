# Audit a Skill

1. Read the actual candidate and requested scope without mutation. Identify its
   intended user outcome, activation responsibility and reachable resources.
2. Use [authoring](authoring.md) and relevant [patterns](skill-authoring-best-practices.md)
   and the [assessment checklist](assessment-guide.md#authoritative-assessment-checklist)
   on actual source before classifying findings. Record every rule with evidence or
   an explicit N/A/unverified reason; inspect metadata, ordered actions, permission boundaries, conditional links,
   resource containment and the 500-line ceiling. Apply recorded format sources,
   not host-specific frontmatter borrowed from another component.
3. Inspect scenarios using [scenario design](evaluation-design.md) when present or
   requested. Check whether natural questions reach the central claims and whether
   artifacts can independently prove each criterion. Missing fixtures or unsupported
   constraints are input defects, not candidate failures.
4. Run available read-only standalone format validation with the canonical path;
   record results separately from semantic findings. Cite file/section evidence for
   each actionable defect and its consequence. Prioritize concrete repairs and
   report missing proof. Revisit the checklist against the final findings before
   delivery; recommendations are not executed repairs or behavior proof. Stop without editing, installing or launching models.
