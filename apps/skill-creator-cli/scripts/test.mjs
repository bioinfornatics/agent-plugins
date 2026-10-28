// Bound file-level subprocess fan-out; engine concurrency and test deadlines remain unchanged.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const build=spawnSync(process.execPath,[path.join(root,"scripts","build.mjs")],{stdio:"inherit"});
if(build.status!==0)process.exit(build.status??1);
const tests=readdirSync(path.join(root,"tests")).filter(n=>n.endsWith(".test.ts")).map(n=>path.join(root,"tests",n));
const skillRoot=path.resolve(root,"..","..","skills","skill-creator");
const env={...process.env,SKILL_CREATOR_SKILL_ROOT:skillRoot};
delete env.PLAYWRIGHT_MODULE_PATH;
delete env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
delete env.CHROME;
delete env.NODE_PATH;
const result=spawnSync(process.execPath,["--test","--test-concurrency=2",...tests],{cwd:root,stdio:"inherit",env});
process.exit(result.status??1);
