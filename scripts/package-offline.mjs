#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),config=JSON.parse(readFileSync(join(root,"bun-release.json"),"utf8"));
const releaseKey=process.env.RELEASE_KEY||process.platform+"-"+process.arch,target=config.targets[releaseKey];
if(!target){console.error("Unsupported native release target: "+releaseKey);process.exit(1);}
const output=resolve(process.argv[2]??join(root,"dist","agent-plugins.zip")),stage=join(root,config.stagingRoot,releaseKey),binary=join(stage,"skills","plugin-creator","scripts","plugin-creator"+(process.platform==="win32"?".exe":""));
function run(command,args){const result=spawnSync(command,args,{cwd:root,stdio:"inherit"});if(result.error){console.error(result.error.message);process.exit(1);}if(result.status!==0)process.exit(result.status??1);}
run(process.execPath,[join(root,"scripts","build-bun-executables.mjs"),"--target="+target]);
const manifestPath=join(stage,"release-manifest.json");
if(!existsSync(manifestPath)||!existsSync(binary)){console.error("Validated staging is incomplete");process.exit(2);}
const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));if(manifest.runtimeMode!=="native-bun"){console.error("Mixed or unsupported staging runtime mode: "+String(manifest.runtimeMode));process.exit(2);}
mkdirSync(dirname(output),{recursive:true});run(binary,["package",stage,output,"--profile","authoring"]);if(!existsSync(output))process.exit(2);console.log(JSON.stringify({status:"packaged",releaseKey,staging:stage,output}));
