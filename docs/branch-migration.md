# Branch distribution migration

## Feasibility

OK for bioinfornatics/agent-plugins: default branch main, confirmed push/admin capability, Git-only Goose installer, self-contained node-bundled Skills. KO for ServierHub with the current account: no push capability. Do not alter that remote or credentials.

## Branch contract

- development owns source, tests, build configuration, offline build dependencies and generated runtime mirrors. Feature branches merge into development through reviewed pull requests.
- main is a generated distribution. Never merge development into main or edit product files there. Promotion commits have previous main as their sole parent; normal fast-forward push only.
- Production includes plugin.json, license, production README/AGENTS, self-contained Skills, a hashed provenance manifest and the workflows needed to dispatch promotion from the default branch.
- No optional source branch. No platform-native binaries on main. Node.js 22+ remains an explicit prerequisite.
- Existing tags remain unchanged. New native-release tags target development commits because native CI requires authoring sources.

## Acceptance and gates

1. Preserve source history on development and backup/pre-production-migration-20261024 (initial SHA 2997167045d287104e1a9c7517ab98987e13e103).
2. Clean artifacts only; preserve committed runtime directories, source and evaluations. Support legacy output locations during transition; new production output uses ignored .artifacts/.
3. Verify vendored dependencies, builds, full tests, clean-source reproducibility, deterministic production projection, CLI smoke tests and isolated Goose Git install/update.
4. Use a strict production allowlist; reject symlinks, incomplete runtimes and unexpected runtime additions. Hash paths, sizes, modes and bytes. Record exact source commit/tree.
5. Promotion requires clean development source and expected main SHA. Generate twice, verify the exact candidate, recheck remote main, then push without force. Concurrent changes must fail closed.
6. CI is read-only for PR tests. Manual promotion runs verification first, is serialized, and grants contents:write only to publication. Keep promotion workflow on main for default-branch workflow discovery.

## Sequence

Create backup/development before cleaning production. Implement and test gates, commit, then push backup/development first. Publish verified generated main with a normal fast-forward commit. Leave developer checkout on development. Verify remote default-branch Git installation in isolated HOME/config. No source branch or unrelated directory renames.

## Rollback

Never reset or force-push main. Stop promotion. Create a new production commit using the recorded previous main tree and current main as parent, then push normally after checking remote SHA. Source remains preserved on development and backup. Existing installations remain usable if updating fails.

## Policy and limits

No automatic branch-protection changes: required checks and publisher permissions need repository-specific approval. Do not claim enforced review without configured rules. ServierHub migration remains separately blocked. Keep development app/config paths stable to avoid unrelated path/public-contract churn; the production checkout removes those roots regardless.
