#!/usr/bin/env node
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),config=JSON.parse(readFileSync(path.join(root,"bun-release.json"),"utf8")),args=process.argv.slice(2);let output;
for(let i=0;i<args.length;i++){if(args[i]==="--output")output=args[++i];else if(args[i].startsWith("--output="))output=args[i].slice(9);else{console.error("error: unknown option: "+args[i]);process.exit(1);}}if(!output&&args.includes("--output")){console.error("error: --output requires a path");process.exit(1);}output=path.resolve(output||path.join(root,"release-assets"));
function run(script,argv){const r=spawnSync(process.execPath,[path.join(root,"scripts",script),...argv],{cwd:root,stdio:"inherit"});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
const work=mkdtempSync(path.join(tmpdir(),"agent-plugins-release-input-")),staging=path.join(work,"staging"),artifacts=path.join(work,"artifacts");try{mkdirSync(artifacts);for(const [key,target] of Object.entries(config.targets)){run("build-bun-executables.mjs",["--target="+target,"--output="+staging]);cpSync(path.join(staging,key),path.join(artifacts,"creators-"+key+"-local"),{recursive:true});}run("package-bun-release-assets.mjs",[artifacts,output]);}finally{rmSync(work,{recursive:true,force:true});}console.log(JSON.stringify({status:"released",targets:Object.keys(config.targets),output}));
