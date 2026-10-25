# Production distribution

This branch is generated from develop. Do not author source here or merge develop into main. Use a development checkout for implementation, tests and promotion tooling. Preserve self-contained Skill runtimes; no dependency installation is required for this distribution. Node.js 22+ is the declared prerequisite.

Repository self-evaluation sets and fixtures are development-only. Mentions of `evals/evals.json` or `assets/evaluation-fixtures/` in creator guides describe source regression scenarios or illustrative user inputs, not installed files. Use the develop checkout for repository regression campaigns; evaluate user-created capabilities with the installed evaluation commands. Golden journey inputs, schemas and research protocols required by public commands remain bundled.

Each Skill owns its instructions/resources and runtime. Route Skill, agent, hook and plugin work to the corresponding creator. Never reference sibling/repository development paths from an installed Skill. Do not mutate live host installations in automated tests.
