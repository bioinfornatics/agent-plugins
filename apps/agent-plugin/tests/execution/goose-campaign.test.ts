import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../../src/adapters/outbound/storage/sqlite-database.ts";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GooseHost } from "../../src/adapters/outbound/hosts/goose/goose-host.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { SqliteVerifiedAttemptReader } from "../../src/adapters/outbound/storage/sqlite-verified-attempt.ts";
import { judgmentPacket } from "../../src/adapters/outbound/judge/judgment-packet.ts";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup(exportFailure = false, nonzero = false, userOnly = false, whitespace = false, wrongPrompt = false) {
  const root = await mkdtemp(join(tmpdir(), "goose-campaign-")); roots.push(root);
  const original = join(root, "original"); await mkdir(original);
  await writeFile(join(original, "config.yaml"), 'GOOSE_PROVIDER: fake-provider\nGOOSE_MODEL: fake\nextensions:\n  developer:\n    type: builtin\n    enabled: true\n  ambient:\n    type: stdio\n    cmd: dangerous\n');
  await writeFile(join(original, "secrets.yaml"), 'OPENAI_API_KEY: sentinel-secret-123\n');
  const target = join(root, "target"); await mkdir(join(target, "evals"), { recursive: true });
  await writeFile(join(target, "SKILL.md"), '---\nname: target\ndescription: example\n---\n');
  await mkdir(join(target, "evals", "files"));
  await writeFile(join(target, "evals", "files", "input.txt"), "frozen pair input");
  await writeFile(join(target, "evals", "evals.json"), JSON.stringify({evals:[{id:1,prompt:'Candidate task',expectations:['judge criterion'],expected_output:"judge-only description",name:"case data",files:["evals/files/input.txt"]}]}));
  const executable = join(root, "fake-goose");
  await writeFile(executable, `#!${process.execPath}\nimport { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const args=process.argv.slice(2), base=process.env.XDG_CONFIG_HOME ? process.env.HOME : undefined;
if(process.env.GOOSE_PATH_ROOT) throw Error('non-native path override');
const configDir=base ? join(process.env.XDG_CONFIG_HOME,'goose') : process.env.ORIGINAL_CONFIG;
const config=join(configDir,'config.yaml');
if(args[0]==='info') { console.log('Version: 1.57.0\\nConfig dir: '+configDir+'\\nConfig yaml: '+config+'\\nSessions DB (sqlite): '+join(process.env.XDG_DATA_HOME||process.env.ORIGINAL_CONFIG,'goose','sessions','sessions.db')+'\\nLogs dir: '+join(process.env.XDG_STATE_HOME||process.env.ORIGINAL_CONFIG,'goose','logs')); }
else if(args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model stream-json --format json');
else if(args[0]==='run') {
 const prompt=readFileSync(0,'utf8');
 if(prompt!=='Candidate task') throw Error('criteria leaked');
 const cfg=readFileSync(config,'utf8'); if(cfg.includes('dangerous')) throw Error('ambient extension');
 if(process.env.GOOSE_MOIM_MESSAGE_FILE) throw Error('ambient context');
 const home=process.env.HOME; const skill=join(home,'.agents','skills','target');
 if(existsSync(join(skill,'evals'))) throw Error('evals leaked');
 writeFileSync(join(base,'run-name'),args[args.indexOf('--name')+1]);
 const input=readFileSync('evals/files/input.txt','utf8');
 if(input!=='frozen pair input') throw Error('input not frozen or mapped');
 if(existsSync('SKILL.md') || existsSync('secrets.yaml') || existsSync('.agents')) throw Error('workspace treatment or config leaked');
 writeFileSync('result.json',JSON.stringify({withTarget:existsSync(skill),prompt,input,credential:process.env.OPENAI_API_KEY}));
 console.log(JSON.stringify({type:'message',text:'sentinel-secret-123'}));
 process.exitCode=${nonzero ? 7 : 0};
} else if(args[0]==='session') { if(readFileSync(join(base,'run-name'),'utf8')!==args[args.indexOf('--name')+1]) throw Error('wrong export session'); if(${exportFailure}) { console.error('sensitive export failure sentinel-secret-123'); process.exitCode=4; } else console.log(JSON.stringify({messages:[{role:'user',content:${wrongPrompt ? JSON.stringify('wrong prompt') : JSON.stringify('Candidate task')}},...(${userOnly} ? [] : [{role:'assistant',content:${whitespace ? JSON.stringify('   ') : JSON.stringify('sentinel-secret-123 result')}}])]})); }
`, { mode: 0o700 });
  const plan = await prepareEvaluation({ skills:[target],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3 },new FilesystemEvaluationSource());
  const host = new GooseHost({ executable, tempRoot: root, env: { PATH: process.env.PATH, ORIGINAL_CONFIG: original, OPENAI_API_KEY: "sentinel-secret-123", GOOSE_MOIM_MESSAGE_FILE: "/operator/context" } });
  return { root, original, plan, host, executable, target };
}

test("two native-style trials have dedicated redacted conversations and hashed SQLite evidence", async () => {
  const { root, original, plan, host, target, executable } = await setup();
  // Representative named export: native context/tool results retain role=user.
  const script = await readFile(executable, "utf8");
  const originalMessages = '[{role:\'user\',content:"Candidate task"},...(false ? [] : [{role:\'assistant\',content:"sentinel-secret-123 result"}])]';
  assert.ok(script.includes(originalMessages));
  const nativeMessages = [{ role: "user", content: [{ type: "text", text: "Candidate task" }] },
    { role: "user", content: [{ type: "text", text: "runtime context" }], metadata: { turnContext: true } },
    { role: "assistant", content: [{ type: "toolRequest", id: "call-write" }] },
    { role: "user", content: [{ type: "toolResponse", id: "call-write", toolResult: { status: "success", value: { content: [{ type: "text", text: "Created result.json" }], isError: false } } }] },
    { role: "assistant", content: [{ type: "text", text: "sentinel-secret-123 result" }] }];
  await writeFile(executable, script.replace(originalMessages, JSON.stringify(nativeMessages)));
  await writeFile(join(target,"evals","files","input.txt"),"mutated after preparation");
  const before = await readFile(join(original,"config.yaml"),"utf8");
  const campaign = await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID);
  assert.strictEqual(campaign.completed, 2); assert.strictEqual(campaign.failed, 0);
  const db = new Database(campaign.registry ?? "",{readonly:true});
  const trials = db.query('SELECT t.* FROM trials t JOIN planned_trials p ON p.campaign_id=t.campaign_id AND p.trial_id=t.trial_id ORDER BY p.sequence').all() as {id:string;condition:string;status:string;collection:string;receipt_json:string}[];
  assert.deepStrictEqual(trials.map(t=>[t.condition,t.status,t.collection]), [["with","completed","complete"],["without","completed","complete"]]);
  assert.strictEqual(new Set(trials.map(t=>JSON.parse(t.receipt_json).sessionName)).size, 2);
  for (const trial of trials) assert.deepStrictEqual(JSON.parse(trial.receipt_json).host, {id:"goose",version:"1.57.0"});
  for(const trial of trials) {
    const result = JSON.parse(await readFile(join(campaign.output,"artifacts",trial.id,"workspace/result.json"),"utf8"));
    assert.strictEqual(result.input, "frozen pair input"); assert.strictEqual(result.withTarget, trial.condition==="with"); assert.strictEqual(result.credential, "[REDACTED]");
    const conversation = await readFile(join(campaign.output,"artifacts",trial.id,"goose/conversation.json"),"utf8");
    assert.ok((conversation).includes("[REDACTED]")); assert.ok(!(conversation).includes("sentinel-secret-123"));
  }
  const artifacts = db.query('SELECT * FROM artifacts').all() as {trial_id:string;path:string;sha256:string;bytes:number}[];
  for(const a of artifacts) {
    const content=await readFile(join(campaign.output,"artifacts",a.trial_id,a.path));
    assert.strictEqual(createHash('sha256').update(content).digest('hex'), a.sha256); assert.strictEqual(content.length, a.bytes);
    assert.ok(!(a.path).includes("secrets.yaml"));
  }
  db.close();
  assert.strictEqual(await readFile(join(original,"config.yaml"),"utf8"), before);
  assert.strictEqual(await readFile(join(target,"evals","files","input.txt"),"utf8"), "mutated after preparation");
  assert.deepStrictEqual((await readdir(root)).filter(n=>n.startsWith('agent-plugin-goose-')), []);
});

for(const failure of ['export','nonzero']) test(`${failure} cannot become a complete successful campaign`,async()=>{
 const {root,plan,host}=await setup(failure==='export',failure==='nonzero');
 const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID);
 assert.strictEqual(result.completed, 0);assert.strictEqual(result.failed, 2);
 const db=new Database(result.registry ?? "",{readonly:true});
 if (failure === 'export') {
   const receipts = db.query('SELECT receipt_json FROM trials').all() as { receipt_json: string }[];
   for (const row of receipts) {
     const receipt = JSON.parse(row.receipt_json);
     assert.ok(receipt.limitations.includes("Named session export failed: exitCode=4, timeout=false, overflow=false."));
     assert.ok(!row.receipt_json.includes("sensitive export failure"));
     assert.ok(!row.receipt_json.includes("sentinel-secret-123"));
   }
 }
 const rows=db.query('SELECT status,collection FROM trials').all();
 assert.deepStrictEqual(rows, failure==='export'?[{status:'completed',collection:'unavailable'},{status:'completed',collection:'unavailable'}]:[{status:'nonzero',collection:'partial'},{status:'nonzero',collection:'partial'}]);db.close();
});

test("user-only session export never counts as a complete execution", async () => {
  const {root,plan,host}=await setup(false,false,true);
  const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID);
  assert.strictEqual(result.completed, 0); assert.strictEqual(result.failed, 2);
});

test("inline and file MCP declarations are refused before candidate launch", async () => {
  for (const declaration of ["inline", ".mcp.json", "mcp.json"]) {
    const {root,plan,host}=await setup();
    const target=plan.profile.components[0]; if(!target) throw new Error("Missing fixture target"); target.kind="plugin";
    await writeFile(join(target.root,"plugin.json"),JSON.stringify({name:"target", ...(declaration==="inline"?{mcpServers:{unsafe:{command:"external"}}}:{})}));
    if(declaration!=="inline") await writeFile(join(target.root,declaration),"{}");
    const files = await new FilesystemEvaluationSource().load({kind:"skill",root:target.root});
    target.files=files.files;
    await assert.rejects(executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID), /MCP/);
    assert.strictEqual((await readdir(root)).includes("output"), false);

  }
});


test("mixed profile installs both Plugins and standalone Skill from frozen bytes in every with trial", async () => {
  const {root,host,executable,target}=await setup();
  const plugins:string[]=[];
  for(const name of ["plugin-a","plugin-b"]) {
    const plugin=join(root,name);await mkdir(join(plugin,"skills",name),{recursive:true});
    await writeFile(join(plugin,"plugin.json"),JSON.stringify({name}));
    await writeFile(join(plugin,"skills",name,"SKILL.md"),"frozen Plugin Skill");
    await mkdir(join(plugin,"skills",name,"evals","files"),{recursive:true});
    await writeFile(join(plugin,"skills",name,"evals","files","input.txt"),"frozen pair input");
    await writeFile(join(plugin,"skills",name,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"Candidate task",expectations:["criterion"],files:["evals/files/input.txt"]}]}));
    plugins.push(plugin);
  }
  const plan=await prepareEvaluation({skills:[target],plugins,agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3},new FilesystemEvaluationSource());
  // Mutating operator sources after preparation must not alter installed treatment.
  await writeFile(join(target,"SKILL.md"),"changed live Skill");
  for(const p of plugins) await writeFile(join(p,"plugin.json"),'{"name":"changed","mcpServers":{}}');
  const script=await readFile(executable,"utf8");
  await writeFile(executable,script.replace("const home=process.env.HOME;",`const home=process.env.HOME;
 const expected=existsSync(join(home,'.agents','skills','target'));
 for(const name of ['plugin-a','plugin-b']) {
   const p=join(home,'.agents','plugins',name);
   if(existsSync(p)!==expected) throw Error('partial profile');
   if(expected && (!cfg.includes(p) || !readFileSync(join(p,'plugin.json'),'utf8').includes(name))) throw Error('Plugin overwritten or live bytes installed');
   if(expected && !readFileSync(join(p,'skills',name,'SKILL.md'),'utf8').includes('name: '+name+':'+name)) throw Error('Plugin Skill namespace missing');
 }
 if(expected && readFileSync(join(home,'.agents','skills','target','SKILL.md'),'utf8').includes('changed')) throw Error('live Skill installed');`));
  const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),join(root,"registry","evaluations.sqlite")),randomUUID);
  assert.strictEqual(result.completed, 6);assert.strictEqual(result.failed, 0);
});


for(const evidence of ["whitespace","wrong-prompt"] as const) test(`${evidence} export never supplies complete candidate evidence`,async()=>{
 const {root,plan,host}=await setup(false,false,false,evidence==="whitespace",evidence==="wrong-prompt");
 const campaign=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),join(root,"registry","evaluations.sqlite")),randomUUID);
 assert.strictEqual(campaign.completed, 0);assert.strictEqual(campaign.failed, 2);
 const db=new Database(campaign.registry??"",{readonly:true});
 assert.deepStrictEqual(db.query("SELECT collection FROM trials").all(), [{collection:"unavailable"},{collection:"unavailable"}]);
 const reason = evidence === "whitespace" ? "Missing assistant output" : "Session prompt mismatch";
 const receipts = db.query("SELECT receipt_json FROM trials").all() as { receipt_json: string }[];
 for (const row of receipts) assert.ok(JSON.parse(row.receipt_json).limitations.includes(`Named session export failed: ${reason}.`));
 db.close();
});

for (const variant of ["escaped", "substring"] as const) test(`${variant} prompt export is bound to exact task text`, async () => {
  const { root, plan, host, executable } = await setup();
  const prompt = variant === "escaped" ? 'Line one\n"quoted" \\ path' : "Candidate task";
  const content = variant === "escaped" ? prompt : `prefix ${prompt} suffix`;
  // The export test changes the authored prompt consistently at both frozen views;
  // changing only the aggregate is now rejected as a corrupt profile before execution.
  for (const scenario of [...plan.profile.scenarios, ...plan.profile.components.flatMap(component => component.scenarios)]) scenario.prompt = prompt;
  const script = await readFile(executable, "utf8");
  await writeFile(executable, script
    .replace("if(prompt!=='Candidate task')", `if(prompt!==${JSON.stringify(prompt)})`)
    .replace("role:'user',content:\"Candidate task\"", `role:'user',content:${JSON.stringify(content)}`));
  const campaign = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "proofs"), join(root, "registry", "evaluations.sqlite")), randomUUID);
  assert.strictEqual(campaign.completed, variant === "escaped" ? 2 : 0);
  assert.strictEqual(campaign.failed, variant === "escaped" ? 0 : 2);
});

for (const variant of ["earlier-assistant", "later-unrelated", "repeated-request"] as const) test(`${variant} export attributes only assistant evidence after the latest exact user task`, async () => {
  const { root, plan, host, executable } = await setup();
  const script = await readFile(executable, "utf8");
  const original = '[{role:\'user\',content:"Candidate task"},...(false ? [] : [{role:\'assistant\',content:"sentinel-secret-123 result"}])]';
  assert.ok(script.includes(original), "fixture must replace the actual named export");
  const messages = variant === "earlier-assistant"
    ? [{ role: "assistant", content: "old answer" }, { role: "user", content: "Candidate task" }]
    : [{ role: "user", content: "Candidate task" }, { role: "assistant", content: "old answer" },
      { role: "user", content: variant === "later-unrelated" ? "different task" : "Candidate task" },
      { role: "assistant", content: [{ type: "toolRequest", id: "call" }] }, { role: "tool", content: "tool result" },
      { role: "assistant", content: [{ type: "text", text: "New answer" }, { type: "text", text: "second line" }] }];
  await writeFile(executable, script.replace(original, JSON.stringify(messages)));
  const campaign = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "proofs"), join(root, "registry", "evaluations.sqlite")), randomUUID);
  assert.equal(campaign.completed, variant === "repeated-request" ? 2 : 0);
  assert.equal(campaign.failed, variant === "repeated-request" ? 0 : 2);
  const db = new Database(campaign.registry ?? "", { readonly: true });
  try {
    assert.deepEqual(db.query("SELECT collection FROM trials").all(), Array.from({ length: 2 }, () => ({ collection: variant === "repeated-request" ? "complete" : "unavailable" })));
    if (variant === "repeated-request") {
      const row = db.query<{ id: string }, []>("SELECT id FROM trials LIMIT 1").get();
      assert.deepEqual(JSON.parse(await readFile(join(campaign.output, "artifacts", row?.id ?? "", "goose/conversation.json"), "utf8")).messages, messages, "retain the entire multi-tool trace in order");
    }
  } finally { db.close(); }
});

// Detects an installation filter accidentally applied to output evidence: the
// original task data, modified workspace copy and generated suite must coexist.
test("grading evidence retains original inputs and generated evals without private configuration", async () => {
  const { root, plan, host, executable, target } = await setup();
  const script = await readFile(executable, "utf8");
  await writeFile(executable, script.replace("writeFileSync('result.json'", `
 mkdirSync('meeting-actions/evals', {recursive:true});
 writeFileSync('meeting-actions/evals/evals.json', '{"evals":[{"id":1,"prompt":"Check action","assertions":["Owner is Leo"]}]}');
 writeFileSync('evals/files/input.txt', 'candidate modified input');
 writeFileSync('secrets.yaml', 'private config');
 mkdirSync('node_modules', {recursive:true}); writeFileSync('node_modules/hidden.txt', 'dependency');
 writeFileSync('result.json'`));
  await writeFile(join(target, "evals/files/input.txt"), "source changed after freeze");
  const registry = join(root, "evidence-registry/evaluations.sqlite");
  const result = await executeEvaluation(plan, new Map([["goose", host]]), new SqliteEvaluationStore(join(root, "evidence-output"), registry), randomUUID);
  assert.equal(result.failed, 0);
  const db = new Database(registry, {readonly:true});
  const attempts = db.query<{id:string}, [string]>("SELECT id FROM trials WHERE campaign_id=? ORDER BY id").all(result.id); db.close();
  for (const attempt of attempts) {
    const view = await new SqliteVerifiedAttemptReader(registry).readAttempt({campaignId:result.id, attemptId:attempt.id});
    const text = (path: string) => { const a = view.request.artifacts.find(a => a.path === path); return a?.kind === "text" ? a.text : undefined; };
    assert.equal(text("inputs/evals/files/input.txt"), "frozen pair input");
    assert.equal(text("workspace/evals/files/input.txt"), "candidate modified input");
    assert.equal(text("workspace/meeting-actions/evals/evals.json"), '{"evals":[{"id":1,"prompt":"Check action","assertions":["Owner is Leo"]}]}');
    assert.ok(!view.artifacts.some(a => a.path.includes("secrets.yaml") || a.path.includes("node_modules")));
    const manifest = JSON.parse(judgmentPacket(view.request).bundle.manifest);
    assert.ok(manifest.artifacts.some((a: {category?:string;logicalPath?:string}) => a.category === "input" && a.logicalPath === "evals/files/input.txt"));
    assert.ok(manifest.artifacts.some((a: {category?:string;logicalPath?:string}) => a.category === "workspace" && a.logicalPath === "meeting-actions/evals/evals.json"));
  }
});

// User-level authoring must be observable in both arms, but installed treatment
// content must never become a purported candidate-authored output.
test("new global Skill reaches grading from private HOME in both arms without treatment files", async () => {
  const { root, plan, host, executable } = await setup();
  const script = await readFile(executable, "utf8");
  await writeFile(executable, script.replace("writeFileSync('result.json'", `
 const authored=join(home,'.agents','skills','meeting-actions');
 mkdirSync(join(authored,'evals'),{recursive:true});
 writeFileSync(join(authored,'SKILL.md'),'---\\nname: meeting-actions\\ndescription: Extracts actions from meeting notes.\\n---\\nUse the brief.');
 writeFileSync(join(authored,'evals','evals.json'),'{"evals":[{"id":1,"prompt":"List actions","assertions":["Owner is Leo"]}]}');
 writeFileSync(join(authored,'secrets.yaml'),'not public');
 writeFileSync('result.json'`));
  const registry=join(root,"global-registry/evaluations.sqlite");
  const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"global-output"),registry),randomUUID);
  assert.equal(result.failed,0);
  const db=new Database(registry,{readonly:true});
  const attempts=db.query<{id:string},[string]>("SELECT id FROM trials WHERE campaign_id=? ORDER BY id").all(result.id);db.close();
  assert.equal(attempts.length,2);
  for(const attempt of attempts){
    const view=await new SqliteVerifiedAttemptReader(registry).readAttempt({campaignId:result.id,attemptId:attempt.id});
    const user=view.request.artifacts.filter(a=>a.path.startsWith("user-skills/"));
    assert.deepEqual(user.map(a=>a.path),["user-skills/meeting-actions/SKILL.md","user-skills/meeting-actions/evals/evals.json"]);
    assert.ok(user[0]?.kind==="text" && user[0].text.includes("name: meeting-actions"));
    assert.ok(!view.artifacts.some(a=>a.path.startsWith("user-skills/target/") || a.path.endsWith("secrets.yaml")));
    const manifest=JSON.parse(judgmentPacket(view.request).bundle.manifest);
    assert.ok(manifest.artifacts.some((a:{category?:string;logicalPath?:string})=>a.category==="user-skill" && a.logicalPath===".agents/skills/meeting-actions/SKILL.md"));
  }
});

test("changing an installed treatment Skill marks collection partial without exporting its bytes",async()=>{
  const {plan,host,executable}=await setup();
  const script=await readFile(executable,"utf8");
  await writeFile(executable,script.replace("writeFileSync('result.json'","if(existsSync(skill)) writeFileSync(join(skill,'SKILL.md'),'changed treatment'); writeFileSync('result.json'"));
  const trial=plan.trials.find(t=>t.condition==="with"); assert.ok(trial);const scenario=plan.profile.scenarios[0];assert.ok(scenario);
  const result=await host.run({id:randomUUID(),trialId:trial.id,pairId:trial.pairId,agent:trial.agent,condition:trial.condition,profile:plan.profile,scenario,options:plan.options});
  assert.equal(result.collection,"partial");
  assert.ok(result.limitations.some(x=>x.includes("User Skill collection was partial")));
  assert.ok(!result.artifacts.some(a=>a.path.startsWith("user-skills/target/")));
});

// Default identity must be resolved before admission, not invented from a provider default.
test("Goose model resolution respects environment, config and explicit model precedence", async () => {
  const { root, original, plan, executable } = await setup();
  const config = join(original, "config.yaml");
  await writeFile(config, "GOOSE_PROVIDER: config-provider\nGOOSE_MODEL: t1\n");
  const makeHost = (extra: NodeJS.ProcessEnv = {}) => new GooseHost({ executable, tempRoot: root, env: { ORIGINAL_CONFIG: original, ...extra } });
  assert.deepEqual(await makeHost().resolveModel(plan.options), { source: "configuration-default", provider: "config-provider", model: "t1" });
  await writeFile(config, "GOOSE_PROVIDER: config-provider\nGOOSE_MODEL: t2\n");
  assert.deepEqual(await makeHost().resolveModel(plan.options), { source: "configuration-default", provider: "config-provider", model: "t2" });
  const envHost = makeHost({ GOOSE_PROVIDER: "env-provider", GOOSE_MODEL: "env-model" });
  assert.deepEqual(await envHost.resolveModel(plan.options), { source: "configuration-default", provider: "env-provider", model: "env-model" });
  assert.deepEqual(await envHost.resolveModel({ ...plan.options, model: "explicit" }), { source: "override", provider: "env-provider", model: "explicit" });
});

// v1.57 config/providers.rs selects only the active provider, not enabled/configured flags.
test("Goose structured active-provider resolution matches legacy and environment precedence", async () => {
  const { root, original, plan, executable } = await setup();
  const config = join(original, "config.yaml");
  await writeFile(config, "active_provider: structured\nGOOSE_PROVIDER: legacy\nGOOSE_MODEL: legacy-model\nproviders:\n  structured:\n    model: structured-model\n  env-provider:\n    enabled: false\n    configured: false\n    model: env-entry-model\n");
  const makeHost = (extra: NodeJS.ProcessEnv = {}) => new GooseHost({ executable, tempRoot: root, env: { ORIGINAL_CONFIG: original, ...extra } });
  assert.deepEqual(await makeHost().resolveModel(plan.options), { source: "configuration-default", provider: "structured", model: "structured-model" });
  assert.deepEqual(await makeHost({ GOOSE_PROVIDER: "env-provider" }).resolveModel(plan.options), { source: "configuration-default", provider: "env-provider", model: "env-entry-model" });
  assert.deepEqual(await makeHost({ GOOSE_MODEL: "env-model" }).resolveModel(plan.options), { source: "configuration-default", provider: "structured", model: "env-model" });
  assert.deepEqual(await makeHost({ GOOSE_MODEL: "env-model" }).resolveModel({ ...plan.options, model: "explicit" }), { source: "override", provider: "structured", model: "explicit" });
  assert.deepEqual(await makeHost({ GOOSE_PROVIDER: "missing-entry" }).resolveModel(plan.options), { source: "configuration-default", provider: "missing-entry", model: "legacy-model" });
});

// Malformed ProviderEntry values are skipped; defaults and unknown fields remain valid.
test("Goose structured malformed entries fall back without guessing a provider model", async () => {
  const { root, original, plan, executable } = await setup();
  const config = join(original, "config.yaml");
  const host = new GooseHost({ executable, tempRoot: root, env: { ORIGINAL_CONFIG: original, OPENAI_API_KEY: "sentinel-secret-123" } });
  for (const entry of ["{}", "{model: ''}", "{model: null}", "{model: 123}", "{model: entry-model, enabled: nope}", "{model: entry-model, configured: null}", "null", "not-an-entry"]) {
    await writeFile(config, `active_provider: structured\nGOOSE_PROVIDER: legacy\nGOOSE_MODEL: legacy-model\nproviders:\n  structured: ${entry}\n`);
    assert.deepEqual(await host.resolveModel(plan.options), { source: "configuration-default", provider: "structured", model: "legacy-model" });
  }
  await writeFile(config, "active_provider: [malformed]\nGOOSE_PROVIDER: legacy\nGOOSE_MODEL: legacy-model\nproviders: []\n");
  assert.deepEqual(await host.resolveModel(plan.options), { source: "configuration-default", provider: "legacy", model: "legacy-model" });
  await writeFile(config, "active_provider: structured\nproviders:\n  structured: {model: exact-model, unrelated: ignored}\n");
  assert.deepEqual(await host.resolveModel(plan.options), { source: "configuration-default", provider: "structured", model: "exact-model" });
  for (const entry of ["{}", "{model: entry-model, enabled: nope}", "{model: sentinel-secret-123}", "{model: '  '}"]) {
    await writeFile(config, `active_provider: structured\nproviders:\n  structured: ${entry}\n`);
    await assert.rejects(host.resolveModel(plan.options), { message: "Unable to resolve a safe configured Goose provider/model identity." });
  }
  for (const content of [
    "active_provider: sentinel-secret-123\nGOOSE_PROVIDER: legacy\nGOOSE_MODEL: legacy-model\n",
    "active_provider: structured\nGOOSE_MODEL: legacy-model\nproviders:\n  structured: {model: sentinel-secret-123}\n",
    "GOOSE_MODEL: legacy-model\nproviders:\n  available: {enabled: true, configured: true, model: available-model}\n",
    "active_provider: ''\nGOOSE_PROVIDER: legacy\nGOOSE_MODEL: legacy-model\n",
  ]) {
    await writeFile(config, content);
    await assert.rejects(host.resolveModel(plan.options), { message: "Unable to resolve a safe configured Goose provider/model identity." });
  }
});

// A changed operator default cannot retarget a frozen run; export metadata is observation only.
test("frozen Goose identity controls environment and allowlisted matched export metadata", async () => {
  const { original, plan, host, executable } = await setup();
  await writeFile(join(original, "config.yaml"), "GOOSE_PROVIDER: changed\nGOOSE_MODEL: changed\n");
  const script = await readFile(executable, "utf8");
  await writeFile(executable, script.replace("const prompt=readFileSync(0,'utf8');", "if(process.env.GOOSE_PROVIDER!=='frozen-provider'||process.env.GOOSE_MODEL!=='frozen-model'||args.includes('--model')) throw Error('not frozen'); const prompt=readFileSync(0,'utf8');")
    .replace("JSON.stringify({messages:", "JSON.stringify({provider_name:process.env.GOOSE_PROVIDER,model_config:{model_name:process.env.GOOSE_MODEL,api_key:'sentinel-secret-123'},messages:"));
  const configured = { source: "configuration-default" as const, provider: "frozen-provider", model: "frozen-model" };
  const scenario = plan.profile.scenarios[0]; assert.ok(scenario);
  const result = await host.run({ id: randomUUID(), trialId: "trial-1", pairId: "pair", agent: "goose", condition: "without", profile: plan.profile, scenario, options: { ...plan.options, candidateModels: { goose: configured } } });
  assert.equal(result.status, "completed"); assert.equal(result.collection, "complete");
  assert.deepEqual(result.model, { configured, observed: { provider: "frozen-provider", model: "frozen-model" } });
  assert.ok(!JSON.stringify(result).includes("sentinel-secret-123"));
  assert.ok(!result.artifacts.some(a => Buffer.from(a.content).toString().includes("model_config")));
});

// Invalid identity/config inputs must fail closed with no credential/path/parser disclosure.
test("Goose resolver refuses missing, malformed, bounded and credential-bearing identities safely", async () => {
  const { root, original, plan, executable } = await setup();
  const config = join(original, "config.yaml");
  const cases = [
    "GOOSE_MODEL: t1\n", "GOOSE_PROVIDER: fake\n", "GOOSE_PROVIDER: fake\nGOOSE_MODEL: 123\n",
    "GOOSE_PROVIDER: fake\nGOOSE_MODEL: '  '\n", 'GOOSE_PROVIDER: fake\nGOOSE_MODEL: "t\\u0001"\n',
    `GOOSE_PROVIDER: fake\nGOOSE_MODEL: ${"x".repeat(513)}\n`,
    "GOOSE_PROVIDER: sentinel-secret-123\nGOOSE_MODEL: t1\n",
    "GOOSE_PROVIDER: fake\nGOOSE_MODEL: cfg-secret\nAPI_KEY: cfg-secret\n",
    "GOOSE_PROVIDER: [fake]\nGOOSE_MODEL: t1\n", "GOOSE_PROVIDER: fake\nGOOSE_MODEL: [unterminated\n",
    `GOOSE_PROVIDER: fake\nGOOSE_MODEL: t1\n#${"x".repeat(4 * 1024 * 1024)}\n`,
  ];
  for (const content of cases) {
    await writeFile(config, content);
    const host = new GooseHost({ executable, tempRoot: root, env: { ORIGINAL_CONFIG: original, OPENAI_API_KEY: "sentinel-secret-123" } });
    await assert.rejects(host.resolveModel(plan.options), { message: "Unable to resolve a safe configured Goose provider/model identity." });
  }
  await writeFile(config, "GOOSE_PROVIDER: safe\nGOOSE_MODEL: t1\n");
  for (const extra of [{ GOOSE_MODEL: "" }, { GOOSE_PROVIDER: "bad\nprovider" }, { GOOSE_MODEL: "sentinel-secret-123" }]) {
    const host = new GooseHost({ executable, tempRoot: root, env: { ORIGINAL_CONFIG: original, OPENAI_API_KEY: "sentinel-secret-123", ...extra } });
    await assert.rejects(host.resolveModel(plan.options), { message: "Unable to resolve a safe configured Goose provider/model identity." });
  }
});

test("Goose observation preserves mismatches, treats missing metadata as unknown and omits unsafe identity", async () => {
  const { plan, host, executable } = await setup();
  const script = await readFile(executable, "utf8");
  const configured = { source: "configuration-default" as const, provider: "frozen", model: "t1" };
  const scenario = plan.profile.scenarios[0]; assert.ok(scenario);
  const cases = [
    { fields: { provider_name: "other", model_config: { model_name: "t2" } }, observed: { provider: "other", model: "t2" }, collection: "partial", reason: "mismatches" },
    { fields: {}, observed: null, collection: "complete", reason: "unavailable" },
    { fields: { provider_name: "frozen", model_config: null }, observed: null, collection: "complete", reason: "unavailable" },
    { fields: { provider_name: "sentinel-secret-123", model_config: { model_name: "t1" } }, observed: null, collection: "partial", reason: "malformed or unsafe" },
    { fields: { provider_name: "frozen", model_config: { model_name: 42 } }, observed: null, collection: "partial", reason: "malformed or unsafe" },
    { fields: { provider_name: "frozen", model_config: { model_name: "x".repeat(513) } }, observed: null, collection: "partial", reason: "malformed or unsafe" },
    { fields: { provider_name: "frozen", model_config: { model_name: "t\n1" } }, observed: null, collection: "partial", reason: "malformed or unsafe" },
  ];
  for (const item of cases) {
    await writeFile(executable, script.replace("JSON.stringify({messages:", `JSON.stringify({...${JSON.stringify(item.fields)},messages:`));
    const result = await host.run({ id: randomUUID(), trialId: "trial-1", pairId: "pair", agent: "goose", condition: "without", profile: plan.profile, scenario, options: { ...plan.options, candidateModels: { goose: configured } } });
    assert.equal(result.status, "completed"); assert.equal(result.collection, item.collection);
    assert.deepEqual(result.model, { configured, observed: item.observed });
    assert.ok(result.limitations.some(l => l.includes(item.reason)));
    assert.ok(!JSON.stringify(result).includes("sentinel-secret-123"));
  }
  await writeFile(executable, script);
  const legacy = await host.run({ id: randomUUID(), trialId: "trial-1", pairId: "pair", agent: "goose", condition: "without", profile: plan.profile, scenario, options: plan.options });
  assert.equal(legacy.collection, "complete"); assert.equal(legacy.model, undefined);
});

// Stored identity must be revalidated against current known credentials before run/export.
test("frozen Goose identities are revalidated and explicit model conflicts never launch a candidate", async () => {
  const { original, plan, host, executable } = await setup();
  const scenario = plan.profile.scenarios[0]; assert.ok(scenario);
  await writeFile(join(original, "config.yaml"), "GOOSE_PROVIDER: fake-provider\nGOOSE_MODEL: fake\nAPI_KEY: config-secret\n");
  const script = await readFile(executable, "utf8");
  await writeFile(executable, script.replace("const prompt=readFileSync(0,'utf8');", "throw Error('candidate must not launch'); const prompt=readFileSync(0,'utf8');"));
  for (const model of ["sentinel-secret-123", "config-secret", "bad\nmodel", "x".repeat(513)]) {
    await assert.rejects(host.run({ id: randomUUID(), trialId: "trial-1", pairId: "pair", agent: "goose", condition: "without", profile: plan.profile, scenario, options: { ...plan.options, candidateModels: { goose: { source: "configuration-default", provider: "safe", model } } } }), { message: "Unable to resolve a safe configured Goose provider/model identity." });
  }
  await assert.rejects(host.run({ id: randomUUID(), trialId: "trial-1", pairId: "pair", agent: "goose", condition: "without", profile: plan.profile, scenario, options: { ...plan.options, model: "different", candidateModels: { goose: { source: "override", provider: "safe", model: "t1" } } } }), { message: "Frozen Goose model conflicts with explicit override." });
});

test("model metadata cannot bypass named conversation prompt authentication", async () => {
  const { plan, host, executable } = await setup(false, false, false, false, true);
  const script = await readFile(executable, "utf8");
  await writeFile(executable, script.replace("JSON.stringify({messages:", "JSON.stringify({provider_name:'safe',model_config:{model_name:'t1'},messages:"));
  const scenario = plan.profile.scenarios[0]; assert.ok(scenario);
  const configured = { source: "configuration-default" as const, provider: "safe", model: "t1" };
  const result = await host.run({ id: randomUUID(), trialId: "trial-1", pairId: "pair", agent: "goose", condition: "without", profile: plan.profile, scenario, options: { ...plan.options, candidateModels: { goose: configured } } });
  assert.equal(result.collection, "unavailable"); assert.deepEqual(result.model, { configured, observed: null });
  assert.ok(!result.artifacts.some(a => a.path === "goose/conversation.json"));
});

// Regular-file validation must reject symlink config sources rather than follow operator paths.
test("Goose resolver rejects a linked configuration without leaking its path", async () => {
  const { root, original, plan, executable } = await setup();
  const config = join(original, "config.yaml");
  const linked = join(root, "private-configuration.yaml");
  await writeFile(linked, "GOOSE_PROVIDER: safe\nGOOSE_MODEL: t1\n");
  await rm(config); await symlink(linked, config);
  const host = new GooseHost({ executable, tempRoot: root, env: { ORIGINAL_CONFIG: original } });
  await assert.rejects(host.resolveModel(plan.options), { message: "Unable to resolve a safe configured Goose provider/model identity." });
});

// Generic uppercase Config::get_param inputs must not silently change the captured identity.
test("model resolver refuses generic provider configuration overrides", async()=>{
 const {root,original,executable}=await setup();
 for(const key of ["ACTIVE_PROVIDER","PROVIDERS"]){
  const host=new GooseHost({executable,tempRoot:root,env:{PATH:process.env.PATH,ORIGINAL_CONFIG:original,[key]:"unexpected"}});
  await assert.rejects(host.resolveModel({agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:1}),/Unable to resolve a safe configured/);
 }
});
