#!/usr/bin/env node
/** Canonically refresh source-derived compatibility discovery counts and frozen fixture hashes. */
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,statSync,writeFileSync} from "node:fs";
import {dirname,join,relative,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {discoverArtifactNames,discoverFromSources} from "./discover-compatibility-producers.mjs";
const contractRoot=resolve(dirname(fileURLToPath(import.meta.url)),".."),repo=resolve(contractRoot,"..",".."),base=join(contractRoot,"fixtures","compatibility"),manifestPath=join(base,"producer-discovery.json");
const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
for(const rule of manifest.artifactDiscovery){const source=readFileSync(join(repo,rule.sourceFile),"utf8"),actual=discoverArtifactNames(source),rows=[...manifest.producerSiteAliases,...manifest.structuralExclusions].filter(row=>row.sourceFile===rule.sourceFile);for(const artifact of actual){const site=rule.sourceFile+"::"+artifact,matches=rows.filter(row=>(row.siteId??row.site)===site&&row.sourceFieldOrArtifact===artifact);if(matches.length!==1)throw Error("Refusing to refresh unclassified artifact "+site);}rule.expected=actual;for(const row of rows){const count=source.split(row.sourceEvidence).length-1;if(count<1)throw Error("Refusing to refresh missing evidence "+(row.siteId??row.site));row.evidenceOccurrences=count;}}
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
discoverFromSources(manifest,file=>readFileSync(join(repo,file),"utf8"));
function files(dir){return readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?files(p):[relative(base,p).replaceAll("\\","/")];});}
const hashPath=join(base,"fixture-hashes.sha256.json"),names=files(base).filter(x=>x!=="fixture-hashes.sha256.json").sort(),sha=b=>createHash("sha256").update(b).digest("hex"),hashes={schemaVersion:"1.0.0",algorithm:"sha256",files:Object.fromEntries(names.map(name=>[name,sha(readFileSync(join(base,name)))]))};writeFileSync(hashPath,JSON.stringify(hashes,null,2)+"\n");
console.log("Refreshed "+manifest.artifactDiscovery.length+" discovery rules and "+names.length+" fixture hashes.");
