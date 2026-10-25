import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {canonicalSerialize} from "../dist/evaluation_run_manifest.js";
import {createEvidenceAttestation,validateEvidenceEnvelope,verifyEvidenceAttestation,PAYLOAD_TYPE,STATEMENT_TYPE,PREDICATE_TYPE} from "../dist/evidence_attestation.js";

type Env="local"|"ci";
function fixture(environment:Env="local",kind:"test"|"evaluation"="evaluation"){
  const root=mkdtempSync(join(tmpdir(),"hook-attest-"));mkdirSync(join(root,"source"));
  for(const [n,v] of [["source/code","code"],["artifact","artifact"],["manifest","manifest"],["result","result"]])writeFileSync(join(root,n),v);
  return{root,spec:{evidence_kind:kind,subject:{name:"hook",path:"artifact"},source:{revision:"abcdef1",path:"source"},...(kind==="evaluation"?{manifest:"manifest"}:{}),result:{status:"pass",path:"result"},command:["node","--test"],exit_code:0,environment:{platform:"linux",arch:"x64",node:"v22",variables:{CI:environment==="ci"?"true":"false"}},issuer:{id:environment==="ci"?"https://ci.example/release":"local:developer",environment},issued_at:"2026-09-18T06:00:00Z",expires_at:"2026-09-19T06:00:00Z"}};
}
function keys(){const k=generateKeyPairSync("ed25519");return{privateKey:k.privateKey,privateKeyPem:k.privateKey.export({type:"pkcs8",format:"pem"}).toString(),publicKeyPem:k.publicKey.export({type:"spki",format:"pem"}).toString()}}
function policy(e:any,p:string){return{version:"hook-attestation-trust-policy/v1",issuers:[{id:"https://ci.example/release",keyid:e.signatures[0].keyid,public_key_pem:p}]}}
function statement(e:any){return JSON.parse(Buffer.from(e.payload,"base64").toString("utf8"))}
function setPayload(e:any,s:any,canonical=true){e.payload=Buffer.from(canonical?canonicalSerialize(s):JSON.stringify(s,null,2)).toString("base64");return e}
function pae(type:string,payload:Buffer){return Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${payload.length} `),payload])}
const VALID_NOW=new Date("2026-09-18T07:00:00Z");

test("freshness is issued_at <= now < expires_at at exact boundaries for local and CI",()=>{
  for(const environment of ["local","ci"] as const){const f=fixture(environment),k=keys();try{
    const e=createEvidenceAttestation(f.spec,f.root,environment==="ci"?{privateKeyPem:k.privateKeyPem}:{}),options=environment==="ci"?{trustPolicy:policy(e,k.publicKeyPem)}:{};
    assert.equal(verifyEvidenceAttestation(e,{...options,now:new Date("2026-09-18T05:59:59.999Z")}).state,"invalid");
    assert.match(verifyEvidenceAttestation(e,{...options,now:new Date("2026-09-18T05:59:59.999Z")}).errors[0],/not yet valid/);
    assert.equal(verifyEvidenceAttestation(e,{...options,now:new Date("2026-09-18T06:00:00.000Z")}).ok,true);
    assert.equal(verifyEvidenceAttestation(e,{...options,now:new Date("2026-09-19T05:59:59.999Z")}).ok,true);
    assert.equal(verifyEvidenceAttestation(e,{...options,now:new Date("2026-09-19T06:00:00.000Z")}).state,"expired");
  }finally{rmSync(f.root,{recursive:true,force:true})}}
});

test("enforces DSSE and in-toto types, canonical payload, PAE, and signature cardinality",()=>{const f=fixture("ci"),k=keys();try{
  const good=createEvidenceAttestation(f.spec,f.root,{privateKeyPem:k.privateKeyPem}),p=policy(good,k.publicKeyPem);
  for(const [field,value] of [["payloadType","text/plain"],["extra",true]] as const){const e=structuredClone(good);(e as any)[field]=value;assert.equal(verifyEvidenceAttestation(e,{trustPolicy:p,now:VALID_NOW}).state,"invalid")}
  for(const [field,value] of [["_type","https://in-toto.io/Statement/v0.1"],["predicateType","wrong"]] as const){const e=structuredClone(good),s=statement(e);s[field]=value;setPayload(e,s);assert.equal(verifyEvidenceAttestation(e,{trustPolicy:p,now:VALID_NOW}).state,"invalid")}
  const noncanonical=structuredClone(good);setPayload(noncanonical,statement(noncanonical),false);assert.match(verifyEvidenceAttestation(noncanonical,{trustPolicy:p,now:VALID_NOW}).errors[0],/canonical/);
  const wrongPae=structuredClone(good),payload=Buffer.from(wrongPae.payload,"base64");wrongPae.signatures[0].sig=sign(null,payload,k.privateKey).toString("base64");assert.match(verifyEvidenceAttestation(wrongPae,{trustPolicy:p,now:VALID_NOW}).errors[0],/signature verification/);
  const resigned=structuredClone(good);resigned.signatures[0].sig=sign(null,pae(PAYLOAD_TYPE,payload),k.privateKey).toString("base64");assert.equal(verifyEvidenceAttestation(resigned,{trustPolicy:p,now:VALID_NOW}).ok,true);
  const noSig=structuredClone(good);noSig.signatures=[];assert.match(verifyEvidenceAttestation(noSig,{now:VALID_NOW}).errors[0],/CI evidence must be signed/);
  const two=structuredClone(good);two.signatures.push(two.signatures[0]);assert.match(verifyEvidenceAttestation(two,{now:VALID_NOW}).errors[0],/zero or one/);
  const local=fixture("local");try{const e=createEvidenceAttestation(local.spec,local.root);e.signatures=[good.signatures[0]];assert.match(verifyEvidenceAttestation(e,{now:VALID_NOW}).errors[0],/local evidence must be unsigned/)}finally{rmSync(local.root,{recursive:true,force:true})}
}finally{rmSync(f.root,{recursive:true,force:true})}});

test("rejects strict-base64 violations, unknown properties, wrong key types, and malformed timestamps",()=>{const f=fixture("ci"),k=keys();try{
  const good=createEvidenceAttestation(f.spec,f.root,{privateKeyPem:k.privateKeyPem}),p=policy(good,k.publicKeyPem);
  for(const bad of [good.payload.replace(/.$/,"-"),good.payload+"=","e30"]){const e=structuredClone(good);e.payload=bad;const r=verifyEvidenceAttestation(e,{trustPolicy:p,now:VALID_NOW});assert.equal(r.state,"invalid");assert.match(r.errors[0],/base64/)}
  const badSig=structuredClone(good);badSig.signatures[0].sig="AA-_";assert.equal(verifyEvidenceAttestation(badSig,{trustPolicy:p,now:VALID_NOW}).state,"invalid");
  for(const path of ["statement","predicate","issuer","source","digest","result","invocation","environment","subject","signature"]){const e=structuredClone(good);if(path==="signature")e.signatures[0].unknown=1;else{const s=statement(e),target:any=path==="statement"?s:path==="predicate"?s.predicate:path==="issuer"?s.predicate.issuer:path==="source"?s.predicate.source:path==="digest"?s.subject[0].digest:path==="result"?s.predicate.result:path==="invocation"?s.predicate.invocation:path==="environment"?s.predicate.invocation.environment:s.subject[0];target.unknown=1;setPayload(e,s)}assert.equal(verifyEvidenceAttestation(e,{trustPolicy:p,now:VALID_NOW}).state,"invalid",path)}
  const rsa=generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({type:"spki",format:"pem"}).toString(),badPolicy=structuredClone(p);badPolicy.issuers[0].public_key_pem=rsa;assert.equal(verifyEvidenceAttestation(good,{trustPolicy:badPolicy,now:VALID_NOW}).state,"invalid");
  const unknownPolicy=structuredClone(p);unknownPolicy.extra=true;assert.equal(verifyEvidenceAttestation(good,{trustPolicy:unknownPolicy,now:VALID_NOW}).state,"untrusted-issuer");
  for(const value of ["2026-09-18","2026-09-18T06:00:00+00:00","2026-02-30T06:00:00Z","not-a-time",1]){const e=structuredClone(good),s=statement(e);s.predicate.issued_at=value;setPayload(e,s);assert.equal(verifyEvidenceAttestation(e,{trustPolicy:p,now:VALID_NOW}).state,"invalid",String(value))}
}finally{rmSync(f.root,{recursive:true,force:true})}});

test("every mutable payload leaf is signature-bound with schema-preserving tampering",()=>{const f=fixture("ci"),k=keys();try{
  const good=createEvidenceAttestation(f.spec,f.root,{privateKeyPem:k.privateKeyPem}),p=policy(good,k.publicKeyPem);
  const mutations:Record<string,(s:any)=>void>={
    "subject[0].name":s=>{s.subject[0].name="other-hook"},
    "subject[0].digest.sha256":s=>{s.subject[0].digest.sha256="1".repeat(64)},
    "predicate.evidence_kind":s=>{s.predicate.evidence_kind="test"},
    "predicate.issuer.id":s=>{s.predicate.issuer.id+="/evil"},
    "predicate.source.revision":s=>{s.predicate.source.revision="deadbeef"},
    "predicate.source.digest.sha256":s=>{s.predicate.source.digest.sha256="2".repeat(64)},
    "predicate.manifest.sha256":s=>{s.predicate.manifest.sha256="3".repeat(64)},
    "predicate.result.status":s=>{s.predicate.result.status="fail"},
    "predicate.result.sha256":s=>{s.predicate.result.sha256="4".repeat(64)},
    "predicate.invocation.command[0]":s=>{s.predicate.invocation.command[0]="bun"},
    "predicate.invocation.command[1]":s=>{s.predicate.invocation.command[1]="--test-only"},
    "predicate.invocation.exit_code":s=>{s.predicate.invocation.exit_code=1},
    "predicate.invocation.cwd":s=>{s.predicate.invocation.cwd="/tmp/other"},
    "predicate.invocation.environment.platform":s=>{s.predicate.invocation.environment.platform="darwin"},
    "predicate.invocation.environment.arch":s=>{s.predicate.invocation.environment.arch="arm64"},
    "predicate.invocation.environment.node":s=>{s.predicate.invocation.environment.node="v24"},
    "predicate.invocation.environment.variables.CI":s=>{s.predicate.invocation.environment.variables.CI="false"},
    "predicate.issued_at":s=>{s.predicate.issued_at="2026-09-18T06:30:00Z"},
    "predicate.expires_at":s=>{s.predicate.expires_at="2026-09-19T05:30:00Z"},
  };
  for(const [leaf,mutate] of Object.entries(mutations)){const e=structuredClone(good),s=statement(e);mutate(s);setPayload(e,s);const tamperPolicy=structuredClone(p);tamperPolicy.issuers[0].id=s.predicate.issuer.id;const result=verifyEvidenceAttestation(e,{trustPolicy:tamperPolicy,now:VALID_NOW});assert.equal(result.state,"invalid",leaf);assert.match(result.errors[0],/signature verification/,leaf)}
  // This discriminator cannot stay schema-valid for a signed CI envelope: changing it
  // to local correctly fails the envelope's signedness invariant before crypto verification.
  const issuerEnvironment=structuredClone(good),s=statement(issuerEnvironment);s.predicate.issuer.environment="local";setPayload(issuerEnvironment,s);assert.match(verifyEvidenceAttestation(issuerEnvironment,{trustPolicy:p,now:VALID_NOW}).errors[0],/local evidence must be unsigned/);
}finally{rmSync(f.root,{recursive:true,force:true})}});

test("trusted production CLI E2E is offline, rejects manual status, and never leaks private key",()=>{const f=fixture("ci"),k=keys(),cli=join(import.meta.dirname,"..","dist","cli.js");try{
  const now=Date.now();f.spec.issued_at=new Date(now-60_000).toISOString();f.spec.expires_at=new Date(now+60_000).toISOString();
  const spec=join(f.root,"spec.json"),key=join(f.root,"private.pem"),envelope=join(f.root,"evidence.json"),trust=join(f.root,"trust.json");writeFileSync(spec,JSON.stringify(f.spec));writeFileSync(key,k.privateKeyPem,{mode:0o600});
  const env={...process.env,HTTP_PROXY:"http://127.0.0.1:1",HTTPS_PROXY:"http://127.0.0.1:1",NO_PROXY:""};
  const created=spawnSync(process.execPath,[cli,"--format=json","attestation","create",spec,envelope,"--private-key",key],{encoding:"utf8",env});assert.equal(created.status,0,created.stderr);assert.equal((created.stdout+created.stderr).includes(k.privateKeyPem),false);assert.doesNotMatch(readFileSync(envelope,"utf8"),/PRIVATE KEY/);
  const e=JSON.parse(readFileSync(envelope,"utf8"));writeFileSync(trust,JSON.stringify(policy(e,k.publicKeyPem)));
  const verified=spawnSync(process.execPath,[cli,"--format=json","attestation","verify",envelope,"--policy","production","--trust-policy",trust],{encoding:"utf8",env});assert.equal(verified.status,0,verified.stderr);assert.equal(JSON.parse(verified.stdout).state,"ci-attested");assert.equal((verified.stdout+verified.stderr).includes(k.privateKeyPem),false);
  const manual=spawnSync(process.execPath,[cli,"--format=json","attestation","verify",envelope,"--policy","production","--trust-policy",trust,"--tests-status","pass"],{encoding:"utf8",env});assert.equal(manual.status,1);assert.match(JSON.parse(manual.stdout).errors.join(" "),/manual --tests-status/);
}finally{rmSync(f.root,{recursive:true,force:true})}});

test("production CLI rejects local unsigned evidence with an explicit trust diagnostic",()=>{const f=fixture("local"),cli=join(import.meta.dirname,"..","dist","cli.js");try{
  const now=Date.now();f.spec.issued_at=new Date(now-60_000).toISOString();f.spec.expires_at=new Date(now+60_000).toISOString();
  const spec=join(f.root,"spec.json"),envelope=join(f.root,"evidence.json");writeFileSync(spec,JSON.stringify(f.spec));
  const created=spawnSync(process.execPath,[cli,"--format=json","attestation","create",spec,envelope],{encoding:"utf8"});assert.equal(created.status,0,created.stderr);assert.equal(JSON.parse(created.stdout).signed,false);
  const verified=spawnSync(process.execPath,[cli,"--format=json","attestation","verify",envelope,"--policy","production"],{encoding:"utf8"});assert.equal(verified.status,1,verified.stderr);const diagnostic=JSON.parse(verified.stdout);assert.equal(diagnostic.state,"local");assert.equal(diagnostic.trust,"low");assert.match(diagnostic.errors.join(" "),/production requires trusted CI evidence/);
}finally{rmSync(f.root,{recursive:true,force:true})}});

test("exports the documented media and statement types",()=>{assert.equal(PAYLOAD_TYPE,"application/vnd.in-toto+json");assert.equal(STATEMENT_TYPE,"https://in-toto.io/Statement/v1");assert.equal(PREDICATE_TYPE,"https://openplugins.dev/attestation/hook-evidence/v1");assert.throws(()=>validateEvidenceEnvelope({payloadType:PAYLOAD_TYPE,payload:"e30=",signatures:[]}))});
