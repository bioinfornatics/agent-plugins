#!/usr/bin/env node
// Goose reference adapter for plugin-creator's provider-neutral two-phase CI contract.
// It never opens a browser or reads stdin. Replace the project-specific evaluator
// below with the repository's checked-in Goose evaluation instructions.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const phase=process.argv[2],requestPath=process.argv[3]==="--request"?process.argv[4]:null;
if(!requestPath||!["preflight","full_eval"].includes(phase)){console.error("usage: goose-host-adapter <preflight|full_eval> --request FILE");process.exit(2)}
const request=JSON.parse(readFileSync(requestPath,"utf8"));
if(phase==="preflight"){
 const version=spawnSync("goose",["--version"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 if(version.status!==0){console.log(JSON.stringify({status:"blocked",reason:"Goose CLI unavailable",capabilities:[],models:[]}));process.exit(0)}
 // Model/provider credentials remain Goose configuration; report only capabilities
 // actually established by your CI setup. Do not echo credentials.
 const verified=(process.env.GOOSE_CI_VERIFIED_MODELS??"").split(",").map(x=>x.trim()).filter(Boolean),missing=request.required_models.filter(x=>!verified.includes(x));
 if(missing.length){console.log(JSON.stringify({status:"blocked",reason:"models not preflight-verified: "+missing.join(", "),capabilities:["non-interactive","plugin-evaluation"],models:verified}));process.exit(0)}
 console.log(JSON.stringify({status:"ready",capabilities:["non-interactive","plugin-evaluation"],models:verified}));
}else{
 const prompt=`Evaluate the plugin at ${request.plugin_path}. Write all required typed receipts, benchmark.json, and review.html under ${request.workspace}. Do not prompt, browse, or claim missing evidence.`;
 const run=spawnSync("goose",["run","--no-session","--no-profile","--quiet","--output-format","text","--instructions","-"],{input:prompt,encoding:"utf8",timeout:request.limits.timeout_ms,maxBuffer:request.limits.max_output_bytes});
 console.log(JSON.stringify({status:run.status===0?"pass":"fail",reason:run.status===0?"Goose evaluation completed":"Goose evaluation failed"}));
}
