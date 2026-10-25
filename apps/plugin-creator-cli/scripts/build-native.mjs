import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const out=path.join(root,"bin","plugin-creator"+(process.platform==="win32"?".exe":""));
mkdirSync(path.dirname(out),{recursive:true}); rmSync(out,{force:true});
const result=spawnSync(process.env.BUN_EXECUTABLE||"bun",["build","--compile",`--outfile=${out}`,path.join(root,"scripts/bun-entry.ts")],{cwd:root,stdio:"inherit"});
if(result.error)throw result.error; if(result.status!==0)process.exit(result.status??1); if(process.platform!=="win32")chmodSync(out,0o755);
