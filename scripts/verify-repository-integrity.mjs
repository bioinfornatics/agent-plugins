#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fileHash=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const fail=m=>{throw new Error(`repository integrity: ${m}`)};
const manifest=JSON.parse(readFileSync(path.join(root,"vendor/build-node_modules/integrity-manifest.json"),"utf8"));
if(manifest.schemaVersion!==1||!Array.isArray(manifest.packages)||!manifest.packages.length)fail("invalid manifest");
for(const pkg of manifest.packages){
 if(!pkg.name||!pkg.version||!pkg.license||!Array.isArray(pkg.files)||!pkg.files.length)fail(`incomplete metadata for ${pkg.path}`);
 const base=path.join(root,"vendor/build-node_modules",pkg.path),expected=new Map(pkg.files.map(x=>[x.path,x.sha256])),actual=[];
 const walk=(d)=>{for(const n of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"))){const a=path.join(d,n.name),rel=path.relative(base,a).split(path.sep).join("/");if(n.isSymbolicLink())fail(`symlink ${pkg.path}/${rel}`);if(n.isDirectory())walk(a);else if(n.isFile())actual.push(rel);else fail(`unsupported file ${pkg.path}/${rel}`)}};walk(base);
 if(actual.length!==expected.size||actual.some(x=>!expected.has(x)))fail(`inventory mismatch for ${pkg.path}`);
 for(const rel of actual)if(fileHash(path.join(base,rel))!==expected.get(rel))fail(`SHA-256 mismatch for ${pkg.path}/${rel}`);
 const metadata=JSON.parse(readFileSync(path.join(base,"package.json"),"utf8"));if(metadata.name!==pkg.name||metadata.version!==pkg.version)fail(`package identity mismatch for ${pkg.path}`);
 const hasLicense=actual.some(x=>/(^|\/)(licen[cs]e|copying|notice)(\.|$)/i.test(x));if(!hasLicense&&pkg.license==="SEE LICENSE FILE")fail(`missing license material for ${pkg.name}`);
}
const playwright=manifest.packages.find(x=>x.name==="playwright-core");if(!playwright||playwright.version!=="1.60.0"||playwright.license!=="Apache-2.0")fail("playwright-core 1.60.0 Apache-2.0 metadata is required");
for(const f of ["LICENSE","NOTICE","ThirdPartyNotices.txt"])if(!existsSync(path.join(root,"vendor/build-node_modules/node_modules/playwright-core",f)))fail(`playwright-core ${f} missing`);
console.log(JSON.stringify({status:"passed",packages:manifest.packages.length,files:manifest.packages.reduce((n,p)=>n+p.files.length,0)}));
