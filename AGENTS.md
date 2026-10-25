# Production distribution

This branch is generated from develop. Do not author source here or merge develop into main. Use a development checkout for implementation, tests and promotion tooling. Preserve self-contained Skill runtimes; no dependency installation is required for this distribution. Node.js 22+ is the declared prerequisite.

Each Skill owns its instructions/resources and runtime. Route Skill, agent, hook and plugin work to the corresponding creator. Never reference sibling/repository development paths from an installed Skill. Do not mutate live host installations in automated tests.
