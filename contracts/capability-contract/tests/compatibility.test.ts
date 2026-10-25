import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,statSync} from "node:fs";
import {dirname,join,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {COMPATIBILITY_POLICY_VERSION,COMPATIBILITY_REGISTRY,MIGRATION_PREVIEW_MAX_FILE_ENTRIES,MIGRATION_PREVIEW_MAX_TOTAL_BYTES,RESULT_CONTRACT_REFERENCE,previewMigration,readPublicSurface,validateSurfaceShape} from "../dist/index.js";
import {RESULT_CONTRACT_SCHEMA_ID,RESULT_CONTRACT_VERSION} from "../dist/result-types.js";
import {discoverArtifactNames,discoverArtifactSurfaceMappings,discoverFromSources,discoverHostDeclarations,discoverSchemaRegistrations,discoverVersionEvidence} from "../scripts/discover-compatibility-producers.mjs";
const root=join(dirname(fileURLToPath(import.meta.url)),".."),repo=join(root,"..",".."),base=join(root,"fixtures","compatibility"),gold=join(base,"golden");
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const fixture=(n:string)=>readFileSync(join(gold,n));
const outcomeFixture=(n:string)=>readFileSync(join(base,n));
const discovery=JSON.parse(readFileSync(join(base,"producer-discovery.json"),"utf8"));
const expected=JSON.parse(readFileSync(join(base,"expected-public-surfaces.json"),"utf8"));
const loadSource=(file:string)=>readFileSync(join(repo,file),"utf8");
function filesBelow(dir:string):string[]{return readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?filesBelow(p):[relative(base,p).split(String.fromCharCode(92)).join("/")];});}

test("recommendation schema and API package surfaces are explicitly classified",()=>{
  const pkg=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  assert.deepEqual(Object.keys(pkg.exports).filter((key:string)=>key.includes("recommendation")).sort(),["./recommendation","./recommendation-schema/1.0.0","./recommendation-types"]);
  assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id==="contract.artifact-recommendation.v1")?.validatorId,"schema:artifact-recommendation");
  assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id==="schema.artifact-recommendation.v1")?.supportState,"supported");
  assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id==="api.recommend-artifact.v1")?.supportState,"unsupported");
});

test("outcome metrics schema, API, input contract, and report are explicitly classified and strict",()=>{
  const pkg=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  assert.deepEqual(Object.keys(pkg.exports).filter((key:string)=>key.includes("outcome-metrics")).sort(),["./outcome-metrics","./outcome-metrics-schema/1.0.0","./outcome-metrics-types"]);
  assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id==="api.compute-outcome-metrics.v1")?.supportState,"unsupported");
  for(const id of ["contract.outcome-metrics-input.v1","contract.outcome-metrics-report.v1","schema.outcome-metrics.v1"])assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id===id)?.supportState,"supported",id);
  for(const id of ["contract.outcome-metrics-input.v1","contract.outcome-metrics-report.v1"]){const row:any=expected.outcomes.find((x:any)=>x.id===id);const value=JSON.parse(outcomeFixture(row.expectedOutcome.fixture).toString());const nested=id.includes("report")?value.guardrails:value.metricContract;nested.compatibilityProbe=true;assert.equal(validateSurfaceShape(id,value).valid,false,id+" nested extras");}
});

test("feedback annotation schemas, contracts, APIs, revisions, and hashes are explicitly classified",()=>{
  const pkg=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  assert.deepEqual(Object.keys(pkg.exports).filter((key:string)=>key.includes("feedback")).sort(),["./feedback-annotation","./feedback-annotation-schema/1.0.0","./feedback-annotation-types","./feedback-decision-result-schema/1.0.0","./feedback-decision-schema/1.0.0","./feedback-proposal-schema/1.0.0"]);
  for(const id of ["contract.feedback-annotation.v1","contract.feedback-interpretation.v1","contract.feedback-proposal.v1","contract.feedback-preview.v1","contract.feedback-decision.v1","contract.feedback-revision.v1","contract.feedback-decision-result.v1","schema.feedback-annotation.v1","schema.feedback-proposal.v1","schema.feedback-decision.v1","schema.feedback-decision-result.v1"])assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id===id)?.supportState,"supported",id);
  for(const row of COMPATIBILITY_REGISTRY.filter(x=>x.id.startsWith("api.")&&x.sourceFile.endsWith("feedback-annotation.ts")))assert.equal(row.supportState,"unsupported",row.id);
  for(const id of ["contract.feedback-annotation.v1","contract.feedback-interpretation.v1","contract.feedback-proposal.v1","contract.feedback-preview.v1","contract.feedback-decision.v1","contract.feedback-revision.v1","contract.feedback-decision-result.v1"]){const row:any=expected.outcomes.find((x:any)=>x.id===id),value=JSON.parse(outcomeFixture(row.expectedOutcome.fixture).toString());assert.equal(validateSurfaceShape(id,value).valid,true,id);value.__unexpectedCompatibilityField=true;assert.equal(validateSurfaceShape(id,value).valid,false,id+" root extras");}
  const annotation:any=JSON.parse(outcomeFixture("cases/contract.feedback-annotation.v1.json").toString());annotation.instruction="tampered";assert.equal(validateSurfaceShape("contract.feedback-annotation.v1",annotation).valid,false,"annotation hash binding");
  const revision:any=JSON.parse(outcomeFixture("cases/contract.feedback-revision.v1.json").toString());revision.content.screen.button="tampered";assert.equal(validateSurfaceShape("contract.feedback-revision.v1",revision).valid,false,"revision content hash binding");
});

test("updated skill viewer source artifacts and decision template are classified",()=>{
  const rule=discovery.artifactDiscovery.find((x:any)=>x.sourceFile==="apps/skill-creator-cli/eval-viewer/generate_review.ts");
  assert.ok(rule.expected.includes("benchmark.json"));assert.ok(rule.expected.includes("timing.json"));
  const viewer=COMPATIBILITY_REGISTRY.find(x=>x.id==="skill.viewer-html.unversioned")!;assert.equal(viewer.sourceEvidence,'readFileSync(join(HERE,"viewer.html"),"utf8")');
  assert.equal(validateSurfaceShape(viewer.id,loadSource("apps/skill-creator-cli/eval-viewer/viewer.html")).valid,true);
});

test("production approval artifact and schema are explicit supported surfaces",()=>{
  assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id==="hook.production-approval.v1")?.validatorId,"artifact:production-approval");
  assert.equal(COMPATIBILITY_REGISTRY.find(x=>x.id==="schema.hook-production-approval.v1")?.supportState,"supported");
});

test("source-derived discovery metadata and outcome IDs exactly match the registry",()=>{
  assert.equal(discovery.manifestVersion,"2.0.0");
  assert.equal(expected.manifestVersion,"2.0.0");
  assert.deepEqual(Object.keys(expected).sort(),["manifestVersion","outcomes"]);
  assert.deepEqual(COMPATIBILITY_REGISTRY,discovery.surfaces);
  const registryIds=COMPATIBILITY_REGISTRY.map(x=>x.id).sort();
  assert.equal(new Set(registryIds).size,registryIds.length);
  assert.deepEqual(expected.outcomes.map((x:any)=>x.id).sort(),registryIds);
  for(const rule of discovery.versionRules){
    assert.ok(loadSource(rule.sourceFile).includes(rule.sourceEvidence),rule.id+": stale source evidence "+rule.sourceEvidence);
  }
});

test("source-only helpers detect complete Host declarations, event variants and synthetic drift",()=>{
  const source=loadSource(discovery.host.sourceFile);
  const actual=discoverHostDeclarations(source);
  assert.deepEqual(actual.exports,discovery.host.exports.map((x:any)=>x.name));
  assert.deepEqual(actual.eventVariants,discovery.host.eventVariants.map((x:any)=>x.name));
  assert.equal(actual.protocolVersion,discovery.surfaces.find((x:any)=>x.id==="contract.host.adapter-protocol-version.v1").emittedVersion);
  assert.notDeepEqual(discoverHostDeclarations(source+`
export interface HostSyntheticProbe {}
`).exports,actual.exports);
  assert.notDeepEqual(discoverHostDeclarations(source.replace("export interface HostRunRequest {","interface HostRunRequest {")).exports,actual.exports);
  assert.notDeepEqual(discoverHostDeclarations(source.replace("  accepted: {","  synthetic: {")).eventVariants,actual.eventVariants);
});

test("source-only helpers detect schema registrations and synthetic schema drift",()=>{
  const source=loadSource(discovery.schemaRegistry.sourceFile);
  const actual=discoverSchemaRegistrations(source);
  assert.deepEqual(actual.documents,discovery.schemaRegistry.registrations[0].documents);
  for(const registration of actual.registrations)assert.equal(registration.declaredVersion,registration.version);
  assert.deepEqual(actual.registrations.map(({declaredVersion,isDefault,...x}:any)=>x),discovery.schemaRegistry.registrations);
  const added=source.replace('  "1.1.0": registration("1.1.0", "draft", false),',`  "1.1.0": registration("1.1.0", "draft", false),
  "9.9.9": registration("9.9.9", "draft", false),`);
  assert.notDeepEqual(discoverSchemaRegistrations(added).registrations,actual.registrations);
  const changed=source.replace('"1.1.0": registration("1.1.0", "draft", false)','"1.2.0": registration("1.2.0", "draft", false)');
  assert.notDeepEqual(discoverSchemaRegistrations(changed).registrations,actual.registrations);
});

test("source-derived creator eval forms remain one-to-one",()=>{
  const discovered=readdirSync(join(repo,"skills"),{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name.endsWith("-creator")).map(x=>"skills/"+x.name+"/evals/evals.json").filter(p=>{try{return statSync(join(repo,p)).isFile()}catch{return false}}).sort();
  const registered=discovery.surfaces.filter((x:any)=>x.id.endsWith(".evals-form.unversioned")).map((x:any)=>x.sourceFile).sort();
  assert.deepEqual(discovered,registered);
});

test("source-only artifact and version helpers detect additions, removals and mutations",()=>{
  const live=discoverFromSources(discovery,loadSource);
  for(const [index,rule] of discovery.artifactDiscovery.entries()){
    const actual=live.artifacts[index];
    assert.equal(actual.sourceFile,rule.sourceFile);
    assert.deepEqual(actual.actual,rule.expected,rule.sourceFile);
    const source=loadSource(rule.sourceFile);
    const probeArtifact=`synthetic-compatibility-output-${index}.json`;
    const withProbe=source+`\nconst syntheticCompatibilityOutput${index}="${probeArtifact}";`;
    const added=discoverArtifactNames(withProbe);
    assert.notDeepEqual(added,rule.expected,rule.sourceFile+" addition");
    const removed=discoverArtifactNames(withProbe.replace(`"${probeArtifact}"`,""));
    assert.notDeepEqual(removed,added,rule.sourceFile+" removal");
    assert.deepEqual(removed,rule.expected,rule.sourceFile+" removal restores source discovery");
  }
  assert.deepEqual(live.versions,discovery.versionRules.map((x:any)=>({id:x.id,matched:true,emittedVersion:x.emittedVersion})));
  for(const rule of discovery.versionRules){
    const source=loadSource(rule.versionSourceFile);
    assert.equal(discoverVersionEvidence(source,rule.versionEvidence),true,rule.id);
    assert.equal(discoverVersionEvidence(source.replaceAll(rule.versionEvidence,"__synthetic_version_change__"),rule.versionEvidence),false,rule.id+" version mutation");
  }
});

test("every expected outcome executes with its declared format or exact typed diagnostic",()=>{
  const registryById=new Map(COMPATIBILITY_REGISTRY.map(x=>[x.id,x]));
  for(const row of expected.outcomes){
    const entry=registryById.get(row.id);
    assert.ok(entry,row.id);
    const outcome=row.expectedOutcome;
    assert.equal(outcome.format,entry.artifactFormat,row.id+" format");
    assert.equal(typeof outcome.fixture,"string",row.id+" fixture");
    const result=readPublicSurface(outcomeFixture(outcome.fixture),row.id);
    if(outcome.mode==="read-supported"){
      assert.equal(result.ok,true,row.id);
      assert.equal(result.supportState,"supported",row.id);
      assert.deepEqual(result.diagnostics.map((d:any)=>d.code),[],row.id);
    }else if(outcome.mode==="read-legacy"){
      assert.equal(result.ok,true,row.id);
      assert.equal(result.supportState,"legacy-readable",row.id);
      assert.deepEqual(result.diagnostics.map((d:any)=>d.code),[outcome.diagnostic],row.id);
    }else{
      assert.equal(outcome.mode,"unsupported-diagnostic",row.id);
      assert.equal(result.ok,false,row.id);
      assert.equal(result.supportState,"unsupported",row.id);
      assert.deepEqual(result.diagnostics.map((d:any)=>d.code),[outcome.diagnostic],row.id);
    }
  }
  const ambiguous=readPublicSurface(fixture("unversioned.json"));
  assert.equal(ambiguous.supportState,"ambiguous");
  assert.equal(ambiguous.diagnostics[0].code,"COMPATIBILITY_SURFACE_REQUIRED");
});


test("every registry sourceEvidence is byte-exact",()=>{for(const row of COMPATIBILITY_REGISTRY)assert.ok(loadSource(row.sourceFile).includes(row.sourceEvidence),row.id+": "+JSON.stringify(row.sourceEvidence));});

test("artifact discovery accounts for every producer site exactly once",()=>{
  const registryIds=COMPATIBILITY_REGISTRY.map(row=>row.id);
  const canonicalIds=discovery.canonicalArtifacts.map((row:any)=>row.canonicalArtifactId);
  const aliasSiteIds=discovery.producerSiteAliases.map((row:any)=>row.siteId);
  const excludedSiteIds=discovery.structuralExclusions.map((row:any)=>row.site);
  assert.equal(canonicalIds.findIndex((id:string,index:number)=>canonicalIds.indexOf(id)!==index),-1,"canonicalArtifactId values must be unique");
  assert.equal(aliasSiteIds.findIndex((id:string,index:number)=>aliasSiteIds.indexOf(id)!==index),-1,"alias siteId values must be unique");
  assert.equal(excludedSiteIds.findIndex((id:string,index:number)=>excludedSiteIds.indexOf(id)!==index),-1,"excluded site values must be unique");
  const live=discoverFromSources(discovery,loadSource),discoveredSites:string[]=[];
  for(const [index,rule] of discovery.artifactDiscovery.entries()){
    const source=loadSource(rule.sourceFile);
    assert.deepEqual(rule.expected,live.artifacts[index].actual,rule.sourceFile+" exact artifacts");
    assert.equal(live.artifacts[index].mappings.length,live.artifacts[index].actual.length,rule.sourceFile+" exact site cardinality");
    discoveredSites.push(...live.artifacts[index].actual.map((artifact:string)=>rule.sourceFile+"::"+artifact));
    assert.throws(()=>discoverArtifactSurfaceMappings(source+`\nconst syntheticCompatibilityOutput="synthetic-output.json";`,rule,discovery.producerSiteAliases,discovery.structuralExclusions),/Artifact discovery drift/,rule.sourceFile+" source-only addition");
  }
  for(const siteId of discoveredSites)assert.equal([...aliasSiteIds,...excludedSiteIds].filter((id:string)=>id===siteId).length,1,siteId+" must occur exactly once as an alias or exclusion");
  for(const row of [...discovery.producerSiteAliases,...discovery.structuralExclusions])assert.equal((row.siteId??row.site),row.sourceFile+"::"+row.sourceFieldOrArtifact,"site identity must be explicit and stable");
  for(const row of discovery.producerSiteAliases){assert.ok(["producer","consumer","producer-consumer","structural-member"].includes(row.role),row.siteId+" role");assert.ok(loadSource(row.sourceFile).includes(row.sourceEvidence),row.siteId+" source evidence");assert.ok(canonicalIds.includes(row.canonicalArtifactId),row.siteId+" canonical artifact");}
  for(const row of discovery.structuralExclusions){assert.ok(row.rationale.trim(),row.site+" rationale");assert.ok(loadSource(row.sourceFile).includes(row.sourceEvidence),row.site+" source evidence");}
  for(const row of discovery.canonicalArtifacts){
    assert.ok(row.canonicalArtifactId&&row.format&&row.validatorId,JSON.stringify(row));
    if(row.serialized===false){assert.ok(row.structuralExclusion?.trim(),row.canonicalArtifactId+" explicit non-serialized exclusion");assert.equal(row.registrySurfaceId,undefined,row.canonicalArtifactId+" non-serialized registry link");continue;}
    assert.equal(typeof row.registrySurfaceId,"string",row.canonicalArtifactId+" serialized registry link");
    const registry=COMPATIBILITY_REGISTRY.find(x=>x.id===row.registrySurfaceId);
    assert.ok(registry,row.canonicalArtifactId);
    assert.equal(row.format,registry!.artifactFormat);
    assert.equal(row.validatorId,registry!.validatorId);
  }
  for(const surfaceId of discovery.producerBackedSurfaceIds){assert.equal(registryIds.filter(id=>id===surfaceId).length,1,surfaceId+" registry row");const canonical=discovery.canonicalArtifacts.find((row:any)=>row.registrySurfaceId===surfaceId);assert.ok(canonical,surfaceId+" canonical link");assert.ok(discovery.producerSiteAliases.some((row:any)=>row.canonicalArtifactId===canonical.canonicalArtifactId),surfaceId+" site link");}
  const alias=(source:string,artifact:string)=>discovery.producerSiteAliases.find((row:any)=>row.sourceFile===source&&row.sourceFieldOrArtifact===artifact).canonicalArtifactId;
  const skillViewer="apps/skill-creator-cli/eval-viewer/generate_review.ts",agentViewer="apps/agent-creator-cli/eval-viewer/generate_review.ts";
  assert.notEqual(alias(skillViewer,"metrics.json"),alias("apps/skill-creator-cli/scripts/aggregate_benchmark.ts","benchmark.json"));
  assert.notEqual(alias(skillViewer,"user_notes.md"),alias(skillViewer,"feedback.json"));
  assert.equal(alias(skillViewer,"metrics.json"),alias(agentViewer,"metrics.json"),"identical viewer copies may share canonical identity");
});

test("required secret filename matrix rejects exact names and separator/case variants",()=>{
  const names=["secret.txt","token.json","password.txt","credentials.json","private_key.txt","SECRET.TXT","client-token.json","nested/private-key.txt","nested\\credentials.json","github-token.txt","aws_session_token.json","basic-auth.txt","clientSecret.json","privateKey.pem"];
  for(const name of names){const path="runs/eval-1/with_skill/run-1/outputs/"+name,result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular(path)]});assert.equal(result.status,"blocked",name);assert.equal(result.diagnostics[0].code,"MIGRATION_SECRET_REJECTED",name);assert.equal(result.diagnostics[0].path,"files/0",name);assert.ok(!JSON.stringify(result.diagnostics).includes(name),name);}
});

test("required secret content matrix rejects without echoing values",()=>{
  const values=["token=credential-value-never-echo","AWS_ACCESS_KEY_ID=AKI\u0041ABCDEFGHIJKLMNOP","AWS_SECRET_ACCESS_KEY=credential-value-never-echo","AWS_SESSION_TOKEN=credential-value-never-echo","Authorization: Bearer credential-value-never-echo","Authorization: Basic YWRtaW46Y3JlZGVudGlhbA==","gh\u0070_abcdefghijklmnopqrstuvwxyz123456","github\u005fpat_abcdefghijklmnopqrstuvwxyz123456","eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature987654","-----BEGIN PRIVATE KEY-----\ncredential-value-never-echo\n-----END PRIVATE KEY-----","password: credential-value-never-echo","api_key=credential-value-never-echo","api-token=credential-value-never-echo","apiKey=credential-value-never-echo","access_token=credential-value-never-echo","accessToken=credential-value-never-echo","auth_token=credential-value-never-echo","client_secret=credential-value-never-echo","clientSecret=credential-value-never-echo","private_key=credential-value-never-echo","private-key=credential-value-never-echo","privateKey=credential-value-never-echo",'{"apiToken":"credential-value-never-echo"}','{"awsSessionToken":"credential-value-never-echo"}'];
  for(const bytes of values){const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/eval-1/with_skill/run-1/outputs/result.txt",bytes)]});assert.equal(result.status,"blocked",bytes.slice(0,20));assert.equal(result.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");assert.ok(!JSON.stringify(result.diagnostics).includes("credential-value-never-echo"));}
});

test("secret policy covers names, contents, encodings, and precedence without disclosure",()=>{
  const names=["secret","token","password","credential","authorization","jwt","githubToken","gh\u0070_probe","github\u005fpat_probe","awsAccessKeyId","awsSecretAccessKey","awsSessionToken","apiKey","api-token","accessToken","clientSecret","privateKey","BasicAuth","BearerAuth"];
  for(const name of names){const originalPath="runs/eval-1/with_skill/run-1/outputs/"+name+".txt";const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular(originalPath)]});assert.equal(result.status,"blocked",name);assert.equal(result.diagnostics[0].code,"MIGRATION_SECRET_REJECTED",name);assert.equal(result.diagnostics[0].path,"files/0",name);assert.ok(!JSON.stringify(result.diagnostics).includes(originalPath),name);}
  const contents=["gh\u0070_abcdefghijklmnopqrstuvwxyz123456","github\u005fpat_abcdefghijklmnopqrstuvwxyz123456","AKI\u0041ABCDEFGHIJKLMNOP","AWS_SECRET_ACCESS_KEY=credential-value-never-echo","AWS_SESSION_TOKEN=credential-value-never-echo","Authorization: Basic YWRtaW46Y3JlZGVudGlhbA==","Authorization: Bearer credential-value-never-echo","eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature987654",'-----BEGIN RSA PRIVATE KEY-----\ncredential-value-never-echo','{\"clientSecret\":\"credential-value-never-echo\"}'];
  for(const content of contents){const originalPath="runs/../unsafe-result.txt";const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular(originalPath,content)]});assert.equal(result.status,"blocked",content.slice(0,20));assert.equal(result.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");assert.equal(result.diagnostics[0].path,"files/0");const rendered=JSON.stringify(result.diagnostics);assert.ok(!rendered.includes(originalPath));assert.ok(!rendered.includes("credential-value-never-echo"));}
  const nonsecret=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/../ordinary-result.txt","ordinary public output")]});assert.equal(nonsecret.diagnostics[0].code,"MIGRATION_PATH_UNSAFE");
});

test("secret classifier decodes UTF-8 BOM, UTF-16LE/BE BOM and NUL-interleaved ASCII",()=>{
  const texts=["apiToken=credential-value-never-echo","{\"awsSessionToken\":\"credential-value-never-echo\"}","Authorization: Bearer credential-value-never-echo"];
  const encodings:{name:string;encode:(text:string)=>Uint8Array}[]=[{name:"utf8",encode:text=>Buffer.from(text,"utf8")},{name:"utf8-bom",encode:text=>Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(text,"utf8")])},{name:"utf16le-bom",encode:text=>Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,"utf16le")])},{name:"utf16be-bom",encode:text=>{const le=Buffer.from(text,"utf16le");for(let i=0;i<le.length;i+=2){const x=le[i];le[i]=le[i+1];le[i+1]=x;}return Buffer.concat([Buffer.from([0xfe,0xff]),le]);}},{name:"nul-interleaved",encode:text=>Buffer.from([...text].flatMap(ch=>[ch.charCodeAt(0),0]))}];
  for(const encoding of encodings)for(const text of texts){const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/eval-1/with_skill/run-1/outputs/result.txt",encoding.encode(text))]});assert.equal(result.status,"blocked",encoding.name+" "+text.slice(0,20));assert.equal(result.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");assert.equal(result.diagnostics[0].path,"files/0");assert.ok(!JSON.stringify(result.diagnostics).includes("credential-value-never-echo"));}
});

test("representative mutations fail every validator family",()=>{
  const families=new Map<string,any>();for(const row of expected.outcomes){if(row.expectedOutcome.mode!=="unsupported-diagnostic"&&!families.has(row.expectedOutcome.validatorId))families.set(row.expectedOutcome.validatorId,row);}
  for(const [validatorId,row] of families){const entry=COMPATIBILITY_REGISTRY.find(x=>x.id===row.id)!;if(entry.artifactFormat!=="json")continue;const value=JSON.parse(outcomeFixture(row.expectedOutcome.fixture).toString());const mutated=Array.isArray(value)?{}:{...value};for(const key of Object.keys(mutated))delete mutated[key];assert.equal(validateSurfaceShape(row.id,mutated).valid,false,validatorId+" / "+row.id);assert.equal(readPublicSurface(JSON.stringify(mutated),row.id).diagnostics[0].code,entry.versionField?"COMPATIBILITY_VERSION_REQUIRED":"COMPATIBILITY_SHAPE_INVALID",row.id);}
  for(const [id,bad] of [["skill.review-html.unversioned","<div>fragment</div>"],["skill.benchmark-markdown.unversioned","plain text"],["workspace.skill-eval.current.v1",JSON.stringify({paths:[]})]] as const)assert.equal(validateSurfaceShape(id,bad).valid,false,id);
  const unsupported=expected.outcomes.find((x:any)=>x.expectedOutcome.validatorId==="unsupported:typescript-only");assert.equal(readPublicSurface(outcomeFixture(unsupported.expectedOutcome.fixture),unsupported.id).diagnostics[0].code,"COMPATIBILITY_SURFACE_NOT_SERIALIZED");
});

test("every significant semantic site is removal-sensitive and every discovered artifact addition or removal drifts",()=>{
  for(const rule of discovery.artifactDiscovery){
    const source=loadSource(rule.sourceFile);
    const rows=[...discovery.producerSiteAliases,...discovery.structuralExclusions].filter((row:any)=>row.sourceFile===rule.sourceFile);
    assert.ok(rows.length>0,rule.sourceFile+" has no classified significant sites");
    for(const row of rows){
      assert.ok(source.includes(row.sourceEvidence),row.siteId??row.site);
      const removed=source.replaceAll(row.sourceEvidence,"__compatibility_site_removed__");
      assert.throws(()=>discoverArtifactSurfaceMappings(removed,rule,discovery.producerSiteAliases,discovery.structuralExclusions),/drift/i,(row.siteId??row.site)+" removal");
      const added=source+"\n/* "+row.sourceEvidence+" */\n";
      assert.throws(()=>discoverArtifactSurfaceMappings(added,rule,discovery.producerSiteAliases,discovery.structuralExclusions),/drift/i,(row.siteId??row.site)+" duplicate addition");
    }
    for(const artifact of rule.expected){
      const removed=source.replaceAll("\""+artifact+"\"","\"__compatibility_artifact_removed__\"").replaceAll("'"+artifact+"'","'__compatibility_artifact_removed__'");
      assert.throws(()=>discoverArtifactSurfaceMappings(removed,rule,discovery.producerSiteAliases,discovery.structuralExclusions),/drift/i,rule.sourceFile+"::"+artifact+" removal");
    }
  }
  const requiredSources=["apps/plugin-creator-cli/scripts/mcp_runtime.ts","apps/plugin-creator-cli/scripts/mcp_semantics.ts","apps/plugin-creator-cli/scripts/package_manifest.ts","apps/plugin-creator-cli/scripts/plugin_data_lifecycle.ts","apps/agent-creator-cli/scripts/agent_format.ts","apps/hook-creator-cli/scripts/validate_hook.ts"];
  for(const sourceFile of requiredSources)assert.ok(discovery.artifactDiscovery.some((rule:any)=>rule.sourceFile===sourceFile),sourceFile);
});

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const pointerToken=(value:string)=>value.replaceAll("~","~0").replaceAll("/","~1");
const pointerParts=(path:string)=>path.split("/").slice(1).map(value=>value.replaceAll("~1","/").replaceAll("~0","~"));
function visitJson(value:any,path:string,visit:(parent:any,key:string|number,path:string,value:any)=>void):void{
  if(Array.isArray(value))for(let index=0;index<value.length;index++){visit(value,index,path+"/"+index,value[index]);visitJson(value[index],path+"/"+index,visit);}
  else if(value&&typeof value==="object")for(const key of Object.keys(value)){const childPath=path+"/"+pointerToken(key);visit(value,key,childPath,value[key]);visitJson(value[key],childPath,visit);}
}

test("every readable JSON validator family recursively rejects invalid type mutations and closed-shape extras",()=>{
  const representatives=new Map<string,any>();
  for(const row of expected.outcomes){if(row.expectedOutcome.mode!=="unsupported-diagnostic"&&row.expectedOutcome.format==="json"&&!representatives.has(row.expectedOutcome.validatorId))representatives.set(row.expectedOutcome.validatorId,row);}
  for(const [validatorId,row] of representatives){
    const original=JSON.parse(outcomeFixture(row.expectedOutcome.fixture).toString());const objectPaths:string[]=[];const wrongTypes:{path:string;mutated:any}[]=[];
    if(original&&typeof original==="object"&&!Array.isArray(original))objectPaths.push("");
    visitJson(original,"",(_parent,_key,path,value)=>{if(value&&typeof value==="object"&&!Array.isArray(value))objectPaths.push(path);const mutated=clone(original);let target=mutated;const parts=pointerParts(path);for(const part of parts.slice(0,-1))target=target[Array.isArray(target)?Number(part):part];const last=parts.at(-1)!;target[Array.isArray(target)?Number(last):last]=Array.isArray(value)?{}:value&&typeof value==="object"?"__invalid_object__":{};wrongTypes.push({path,mutated});});
    for(const path of objectPaths){const mutated=clone(original);let target=mutated;for(const part of pointerParts(path))target=target[Array.isArray(target)?Number(part):part];target.__unexpectedCompatibilityField=true;assert.equal(validateSurfaceShape(row.id,mutated).valid,false,validatorId+" "+row.id+" extra at "+(path||"/"));}
    for(const mutation of wrongTypes)assert.doesNotThrow(()=>validateSurfaceShape(row.id,mutation.mutated),validatorId+" must be total at "+mutation.path);
    assert.equal(wrongTypes.filter(mutation=>validateSurfaceShape(row.id,mutation.mutated).valid).length,0,validatorId+" "+row.id+" accepted an invalid recursive type mutation");
  }
});

test("full-eval validators accept emitted cancellation envelopes and deeply validate durable jobs",()=>{
  const plugin=JSON.parse(outcomeFixture("cases/plugin.full-eval.v1.json").toString());
  const skill=JSON.parse(outcomeFixture("cases/skill.full-eval.v1.json").toString());
  assert.equal(plugin.status,"cancelled");assert.equal(skill.status,"cancelled");
  assert.equal(validateSurfaceShape("plugin.full-eval.v1",plugin).valid,true);
  assert.equal(validateSurfaceShape("skill.full-eval.v1",skill).valid,true);
  assert.equal(skill.schema_version,"1.1");assert.equal(skill.checkpoint,null);assert.deepEqual(skill.executable_actions,[]);
  const legacySkill=clone(skill);legacySkill.schema_version="1.0";delete legacySkill.checkpoint;delete legacySkill.executable_actions;assert.equal(validateSurfaceShape("skill.full-eval.v1",legacySkill).valid,true);

  const malformedPluginJobs=[{}, {...plugin.jobs[0],status:"unknown"}, {...plugin.jobs[0],depends_on:[7]}, {...plugin.jobs[0],input_hash:"bad"}, {...plugin.jobs[0],idempotency_key:"bad"}, {...plugin.jobs[0],output_hashes:{artifact:"bad"}}, {...plugin.jobs[0],extra:true}];
  for(const job of malformedPluginJobs){const value=clone(plugin);value.jobs=[job];assert.equal(validateSurfaceShape("plugin.full-eval.v1",value).valid,false,JSON.stringify(job));}
  const emptySkillJob=clone(skill);emptySkillJob.job={};assert.equal(validateSurfaceShape("skill.full-eval.v1",emptySkillJob).valid,false);
  const malformedSkillPhases=[{}, {...skill.job.phases[0],status:"unknown"}, {...skill.job.phases[0],depends_on:[7]}, {...skill.job.phases[0],input_hash:"bad"}, {...skill.job.phases[0],artifact_hashes:{artifact:"bad"}}, {...skill.job.phases[0],extra:true}];
  for(const phase of malformedSkillPhases){const value=clone(skill);value.job.phases=[phase];assert.equal(validateSurfaceShape("skill.full-eval.v1",value).valid,false,JSON.stringify(phase));}
  for(const [id,source] of [["plugin.full-eval.v1",plugin],["skill.full-eval.v1",skill]] as const){const value=clone(source);value.status="unknown";assert.equal(validateSurfaceShape(id,value).valid,false);}
});

test("strict targeted validators reject known nested and discriminator mutations",()=>{
  const cases:[string,(value:any)=>void][]=[["contract.evaluation-plan.v1",v=>{v.configurations[0].modelRoles[0].role={};}],["contract.host.run-request.v1",v=>{v.plan.configurations[0].budget={maxTurns:"many"};}],["schema.host-adapter.v1",v=>{v.$defs.runRequest.properties.plan={type:"number"};}],["skill.cli.envelope.unversioned",v=>{v.output.valid="yes";}],["skill.full-eval.v1",v=>{v.eval_set=7;}],["skill.evals-form.unversioned",v=>{v.evals[0].target={kind:"skill",extra:true};}],["skill.eval-metadata.unversioned",v=>{v.target={kind:"skill",extra:true};}],["agent.transcript.unversioned",v=>{v.messages[0].content[0].type="unknown";}],["skill.benchmark.unversioned",v=>{v.runs={};}],["plugin.mcp.v1",v=>{v.mcpServers.sample.type="unknown";}]];
  const rows=new Map(expected.outcomes.map((row:any)=>[row.id,row]));for(const [id,mutate] of cases){const row:any=rows.get(id);const value=JSON.parse(outcomeFixture(row.expectedOutcome.fixture).toString());mutate(value);assert.equal(validateSurfaceShape(id,value).valid,false,id);}
});

test("exhaustive accepted same-format ordered golden pairs exactly equal compatibleSurfaceAliases",()=>{
  const readable=expected.outcomes.filter((row:any)=>row.expectedOutcome.mode!=="unsupported-diagnostic");const accepted:string[]=[];
  for(const from of readable)for(const to of readable){if(from.id===to.id||from.expectedOutcome.format!==to.expectedOutcome.format)continue;if(readPublicSurface(outcomeFixture(from.expectedOutcome.fixture),to.id).ok)accepted.push(from.id+" -> "+to.id);}
  const declared=discovery.compatibleSurfaceAliases.map((pair:any)=>pair.from+" -> "+pair.to);assert.deepEqual(accepted.sort(),declared.sort());for(const pair of discovery.compatibleSurfaceAliases)assert.ok(typeof pair.reason==="string"&&pair.reason.trim().length>0,pair.from+" -> "+pair.to);
});

test("all compatibility and migration fixture bytes are frozen",()=>{const h=JSON.parse(readFileSync(join(base,"fixture-hashes.sha256.json"),"utf8"));const actual=filesBelow(base).filter(x=>x!=="fixture-hashes.sha256.json").sort();assert.deepEqual(Object.keys(h.files).sort(),actual);for(const [name,digest] of Object.entries(h.files))assert.equal(sha(readFileSync(join(base,name))),digest,name);});
test("malformed, missing and unknown versions are exact diagnostics",()=>{assert.equal(readPublicSurface(fixture("malformed.json"),"skill.full-eval.v1").diagnostics[0].code,"COMPATIBILITY_MALFORMED_JSON");assert.equal(readPublicSurface(fixture("unknown-version.json"),"skill.full-eval.v1").diagnostics[0].code,"COMPATIBILITY_VERSION_UNSUPPORTED");assert.equal(readPublicSurface(fixture("unversioned.json"),"skill.full-eval.v1").diagnostics[0].code,"COMPATIBILITY_VERSION_REQUIRED");assert.equal(readPublicSurface("{}","missing.surface").diagnostics[0].code,"COMPATIBILITY_SURFACE_UNKNOWN");});
const regular=(path:string,bytes:string|Uint8Array="{}\n")=>({path,bytes,entryType:"regular-file" as const});
test("migration preview is deterministic copy-only non-mutating and hashes originals",()=>{const paths=["runs/eval-1/with_skill/run-1/outputs/response.md","runs/eval-1/with_skill/run-1/grading.json","runs/eval-1/with_skill/run-1/timing.json"],files=paths.map(path=>regular(path,readFileSync(join(base,"migration","legacy-workspace",path)))),before=files.map(x=>Buffer.from(x.bytes));const a=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files}),b=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[...files].reverse()});assert.deepEqual(a,b);assert.equal(a.status,"ready");assert.equal(a.mode,"dry-run");assert.ok(a.operations.every(x=>x.kind==="copy"&&x.preservesOriginal&&x.to===x.from.slice(5)));assert.deepEqual(files.map(x=>Buffer.from(x.bytes)),before);for(const f of files)assert.equal(a.originalSha256[f.path],sha(f.bytes));});
test("secret rejection uses the original input index and always outranks unsafe-path diagnostics",()=>{
  const files=[regular("eval-1/without_skill/run-1/timing.json"),regular("runs/../secret-token.txt","credential-value-never-echo")];
  const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files});
  assert.equal(result.status,"blocked");assert.equal(result.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");assert.equal(result.diagnostics[0].path,"files/1");assert.ok(!JSON.stringify(result.diagnostics).includes(files[1].path));assert.ok(!JSON.stringify(result.diagnostics).includes("credential-value-never-echo"));
});

test("migration rejects traversal, platform ambiguity, controls and arbitrary layouts while preserving secret precedence",()=>{const unsafe=["runs/a/../eval-1/with_skill/run-1/timing.json","../x","/runs/eval-1/with_skill/run-1/timing.json","C:/runs/eval-1/with_skill/run-1/timing.json","C:\\runs\\eval-1\\with_skill\\run-1\\timing.json","runs\\eval-1\\with_skill\\run-1\\timing.json","runs/eval-1/with_skill/run-1/outputs/a\u0000b","runs/eval-1/with_skill/run-1/outputs/a\u001fb","runs/eval-x/with_skill/run-1/timing.json","runs/eval-1/other/run-1/timing.json","runs/eval-1/with_skill/run-0/timing.json","runs/eval-1/with_skill/run-1/arbitrary.json"];for(const path of unsafe){const r=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular(path)]});assert.equal(r.status,"blocked",JSON.stringify(path));assert.equal(r.diagnostics[0].code,"MIGRATION_PATH_UNSAFE",JSON.stringify(path));assert.equal(r.operations.length,0);}for(const path of ["runs/../secret","runs/etc/passwd","runs/eval-1/with_skill/run-1/outputs/client-secret.json"]){const r=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular(path)]});assert.equal(r.status,"blocked");assert.equal(r.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");assert.equal(r.diagnostics[0].path,"files/0");assert.ok(!JSON.stringify(r.diagnostics).includes(path));assert.equal(r.operations.length,0);}});
test("migration rejects likely secret bytes and every non-regular entry without following symlinks",()=>{for(const bytes of ["PASSWORD=correct-horse-battery-staple","api_key: abcdefghijklmnop","-----BEGIN PRIVATE KEY-----\nabc"]){const r=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/eval-1/with_skill/run-1/outputs/result.txt",bytes)]});assert.equal(r.status,"blocked");assert.equal(r.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");}for(const entryType of ["directory","symlink"] as const){const r=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[{path:"runs/eval-1/with_skill/run-1/timing.json",bytes:"{}",entryType,symlinkTarget:"../../../../secret"}]});assert.equal(r.status,"blocked");assert.equal(r.diagnostics[0].code,"MIGRATION_ENTRY_UNSAFE");}});
test("migration permits only corresponding root targets for conflict checks",()=>{const c=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/eval-1/old_skill/run-2/grading.json","old"),regular("eval-1/old_skill/run-2/grading.json","new")]});assert.equal(c.status,"blocked");assert.equal(c.diagnostics.at(-1)?.code,"MIGRATION_SOURCE_CONFLICT");assert.equal(c.operations.length,0);const n=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("eval-1/without_skill/run-1/timing.json")]});assert.equal(n.status,"not-applicable");assert.equal(n.diagnostics[0].code,"MIGRATION_NOT_APPLICABLE");});
test("exit mappings reference the Result Contract",()=>{assert.equal(COMPATIBILITY_POLICY_VERSION,"1.0.0");assert.deepEqual(RESULT_CONTRACT_REFERENCE,{version:RESULT_CONTRACT_VERSION,schemaId:RESULT_CONTRACT_SCHEMA_ID,mappingExport:"LEGACY_STATUS_MAPPINGS",classifierExport:"classifyResultExit"});assert.deepEqual(COMPATIBILITY_REGISTRY.filter(x=>x.kind==="status-exit-family").map(x=>x.creator),["skill-creator","agent-creator","hook-creator","plugin-creator"]);});

test("migration preview is total for malformed runtime values and reports only safe locations",()=>{
  const malformed:any[]=[undefined,null,{}, {migrationId:null,files:null},{migrationId:7,files:{}},{migrationId:"workspace.skill-eval.runs-to-root.v1",files:[null,7,{}, {path:null,bytes:"",entryType:"regular-file"},{path:"runs/eval-1/with_skill/run-1/timing.json",bytes:null,entryType:"regular-file"}]}];
  for(const value of malformed){let result:any;assert.doesNotThrow(()=>{result=previewMigration(value as any);});assert.equal(result.status,"blocked");assert.ok(result.diagnostics.every((d:any)=>d.path==="/"||d.path==="/migrationId"||d.path.startsWith("/files")||/^files\/\d+(?:\/(?:path|bytes|entryType))?$/.test(d.path)));}
});

test("migration preview is total for hostile proxies and throwing getters without leaking errors",()=>{
  const secret="accessor-secret-must-not-leak";
  const throwing=()=>{throw new Error(secret);};
  const optionProxy=new Proxy({} as any,{get:throwing});
  const optionGetter=Object.defineProperty({},"files",{get:throwing});
  const fileProxy=new Proxy({} as any,{get:throwing});
  const bytesProxy=new Proxy(new Uint8Array([1,2,3]),{get:throwing});
  const values:any[]=[optionProxy,optionGetter,{migrationId:"workspace.skill-eval.runs-to-root.v1",files:[fileProxy]},{migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/eval-1/with_skill/run-1/timing.json",bytesProxy)]}];
  for(const value of values){let result:any;assert.doesNotThrow(()=>{result=previewMigration(value);});assert.equal(result.status,"blocked");assert.deepEqual(result.diagnostics,[{code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/",message:"Migration preview input could not be safely inspected.",remediation:"Provide plain data properties and unproxied string or Uint8Array file content."}]);assert.ok(!JSON.stringify(result).includes(secret));}
});

test("migration preview rejects oversized sparse file arrays before inspecting entries",()=>{
  const files:any[]=[];files.length=MIGRATION_PREVIEW_MAX_FILE_ENTRIES+1;Object.defineProperty(files,0,{get(){throw new Error("sparse-entry-must-not-be-read");}});
  const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files});
  assert.equal(result.status,"blocked");assert.deepEqual(result.diagnostics,[{code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/files",message:"Migration preview exceeds the maximum permitted file-entry count.",remediation:"Provide a reviewed file list no larger than the documented preview limit."}]);assert.equal(result.operations.length,0);
});

test("migration preview rejects proxy length bypass and dense-array violations with constant diagnostics",()=>{
  const target=[regular("runs/eval-1/with_skill/run-1/timing.json")];const proxy=new Proxy(target,{get(value,key,receiver){return key==="length"?0:Reflect.get(value,key,receiver);}});
  const sparse:any[]=[];sparse.length=MIGRATION_PREVIEW_MAX_FILE_ENTRIES;const extra:any[]=[...target];extra.metadata="untrusted";
  const unreadable={code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/",message:"Migration preview input could not be safely inspected.",remediation:"Provide plain data properties and unproxied string or Uint8Array file content."};
  const unsafeArray={code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/files",message:"Migration preview files must be a dense plain array without additional properties.",remediation:"Provide a reviewed dense array containing only indexed migration file entries."};
  assert.deepEqual(previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:proxy}).diagnostics,[unreadable]);for(const files of [sparse,extra])assert.deepEqual(previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files}).diagnostics,[unsafeArray]);
});
test("migration preview enforces aggregate bytes before secret decoding and creates no partial operations",()=>{
  const half=MIGRATION_PREVIEW_MAX_TOTAL_BYTES/2+1,files=[regular("runs/eval-1/with_skill/run-1/outputs/first.bin",new Uint8Array(half)),regular("runs/eval-1/with_skill/run-1/outputs/second.bin",new Uint8Array(half))];const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files});
  assert.equal(result.status,"blocked");assert.deepEqual(result.operations,[]);assert.deepEqual(result.originalSha256,{});assert.deepEqual(result.diagnostics,[{code:"MIGRATION_ENTRY_UNSAFE",severity:"error",path:"/files",message:"Migration preview exceeds the maximum permitted aggregate byte size.",remediation:"Provide reviewed files whose combined size is no larger than the documented preview limit."}]);
});

test("migration preview bounds file inspection and NUL-interleaved decoding without disclosure",()=>{
  const huge=new Uint8Array(8*1024*1024+1);const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/eval-1/with_skill/run-1/outputs/result.txt",huge)]});
  assert.equal(result.status,"blocked");assert.equal(result.diagnostics[0].code,"MIGRATION_ENTRY_UNSAFE");assert.equal(result.diagnostics[0].path,"files/0/bytes");assert.equal(result.diagnostics[0].message,"A migration preview file exceeds the maximum permitted size.");
  const text="token=credential-value-never-echo",bytes=new Uint8Array(text.length*2);for(let i=0;i<text.length;i++)bytes[i*2]=text.charCodeAt(i);
  const secret=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular("runs/eval-1/with_skill/run-1/outputs/result.txt",bytes)]});assert.equal(secret.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");
});

test("migration secret-name policy checks every path component",()=>{
  for(const path of ["runs/eval-1/with_skill/run-1/outputs/token/report.txt","runs/eval-1/with_skill/run-1/outputs/client-secret/report.txt"]){const result=previewMigration({migrationId:"workspace.skill-eval.runs-to-root.v1",files:[regular(path)]});assert.equal(result.status,"blocked");assert.equal(result.diagnostics[0].code,"MIGRATION_SECRET_REJECTED");assert.ok(!JSON.stringify(result.diagnostics).includes(path));}
});

test("compatibility and migration diagnostics never echo attacker-controlled identifiers or paths",()=>{
  const probes=["surface-attacker-value","version-attacker-value","migration-attacker-value","path-attacker-value"];
  const unknown=readPublicSurface("{}",probes[0]);
  const unsupported=readPublicSurface(JSON.stringify({schema_version:probes[1]}),"skill.full-eval.v1");
  const migration=previewMigration({migrationId:probes[2],files:[regular(probes[3])]});
  for(const diagnostics of [unknown.diagnostics,unsupported.diagnostics,migration.diagnostics]){const rendered=JSON.stringify(diagnostics);for(const probe of probes)assert.ok(!rendered.includes(probe),rendered);}
});

test("historical grading identity readers are explicitly classified and fail closed on missing coverage",()=>{
  for(const sourceFile of ["apps/skill-creator-cli/scripts/full_eval.ts","apps/skill-creator-cli/scripts/paired_execution.ts"]){
    const rule=discovery.artifactDiscovery.find((row:any)=>row.sourceFile===sourceFile);
    const source=loadSource(sourceFile);
    const mappings=discoverArtifactSurfaceMappings(source,rule,discovery.producerSiteAliases,discovery.structuralExclusions);
    const siteId=sourceFile+"::run-identity.json";
    const mapping=mappings.find((row:any)=>row.siteId===siteId);assert.ok(mapping,siteId);
    assert.equal(mapping.classification,"exclusion");assert.match(mapping.rationale,/internal|Internal/);
    const exclusions=discovery.structuralExclusions.filter((row:any)=>row.site!==siteId);
    assert.throws(()=>discoverArtifactSurfaceMappings(source,rule,discovery.producerSiteAliases,exclusions),/expected exactly one alias or exclusion/);
  }
});
