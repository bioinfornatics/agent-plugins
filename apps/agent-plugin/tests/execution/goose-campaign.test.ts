import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GooseHost } from "../../src/adapters/outbound/hosts/goose/goose-host.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup(exportFailure = false, nonzero = false, userOnly = false, whitespace = false, wrongPrompt = false) {
  const root = await mkdtemp(join(tmpdir(), "goose-campaign-")); roots.push(root);
  const original = join(root, "original"); await mkdir(original);
  await writeFile(join(original, "config.yaml"), 'GOOSE_MODEL: fake\nextensions:\n  developer:\n    type: builtin\n    enabled: true\n  ambient:\n    type: stdio\n    cmd: dangerous\n');
  await writeFile(join(original, "secrets.yaml"), 'OPENAI_API_KEY: sentinel-secret-123\n');
  const target = join(root, "target"); await mkdir(join(target, "evals"), { recursive: true });
  await writeFile(join(target, "SKILL.md"), '---\nname: target\ndescription: example\n---\n');
  await writeFile(join(target, "evals", "evals.json"), JSON.stringify({evals:[{id:1,prompt:'Candidate task',expectations:['judge criterion']}]}));
  const executable = join(root, "fake-goose");
  await writeFile(executable, `#!${process.execPath}\nimport { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const args=process.argv.slice(2), base=process.env.GOOSE_PATH_ROOT;
const config=base ? join(base,'config','config.yaml') : join(process.env.ORIGINAL_CONFIG,'config.yaml');
if(args[0]==='info') { console.log('Version: 1.57.0\\nConfig dir: '+(base?join(base,'config'):process.env.ORIGINAL_CONFIG)+'\\nConfig yaml: '+config+'\\nSessions DB (sqlite): '+join(base||process.env.ORIGINAL_CONFIG,'data','sessions','sessions.db')+'\\nLogs dir: '+join(base||process.env.ORIGINAL_CONFIG,'state','logs')); }
else if(args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model stream-json --format json');
else if(args[0]==='run') {
 const prompt=readFileSync(0,'utf8');
 if(prompt!=='Candidate task') throw Error('criteria leaked');
 const cfg=readFileSync(config,'utf8'); if(cfg.includes('dangerous')) throw Error('ambient extension');
 if(process.env.GOOSE_MOIM_MESSAGE_FILE) throw Error('ambient context');
 const home=process.env.HOME; const skill=join(home,'.agents','skills','target');
 if(existsSync(join(skill,'evals'))) throw Error('evals leaked');
 writeFileSync(join(base,'run-name'),args[args.indexOf('--name')+1]);
 writeFileSync('result.json',JSON.stringify({withTarget:existsSync(skill),prompt,credential:process.env.OPENAI_API_KEY}));
 console.log(JSON.stringify({type:'message',text:'sentinel-secret-123'}));
 process.exitCode=${nonzero ? 7 : 0};
} else if(args[0]==='session') { if(readFileSync(join(base,'run-name'),'utf8')!==args[args.indexOf('--name')+1]) throw Error('wrong export session'); if(${exportFailure}) process.exitCode=4; else console.log(JSON.stringify({messages:[{role:'user',content:${wrongPrompt ? JSON.stringify('wrong prompt') : JSON.stringify('Candidate task')}},...(${userOnly} ? [] : [{role:'assistant',content:${whitespace ? JSON.stringify('   ') : JSON.stringify('sentinel-secret-123 result')}}])]})); }
`, { mode: 0o700 });
  const plan = await prepareEvaluation({ skills:[target],plugins:[],agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3 },new FilesystemEvaluationSource());
  const host = new GooseHost({ executable, tempRoot: root, env: { PATH: process.env.PATH, ORIGINAL_CONFIG: original, OPENAI_API_KEY: "sentinel-secret-123", GOOSE_MOIM_MESSAGE_FILE: "/operator/context" } });
  return { root, original, plan, host, executable, target };
}

test("two native-style trials have dedicated redacted conversations and hashed SQLite evidence", async () => {
  const { root, original, plan, host } = await setup();
  const before = await readFile(join(original,"config.yaml"),"utf8");
  const campaign = await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID);
  expect(campaign.completed).toBe(2); expect(campaign.failed).toBe(0);
  const db = new Database(campaign.registry ?? "",{readonly:true});
  const trials = db.query('SELECT t.* FROM trials t JOIN planned_trials p ON p.campaign_id=t.campaign_id AND p.trial_id=t.trial_id ORDER BY p.sequence').all() as {id:string;condition:string;status:string;collection:string;receipt_json:string}[];
  expect(trials.map(t=>[t.condition,t.status,t.collection])).toEqual([["with","completed","complete"],["without","completed","complete"]]);
  expect(new Set(trials.map(t=>JSON.parse(t.receipt_json).sessionName)).size).toBe(2);
  for (const trial of trials) expect(JSON.parse(trial.receipt_json).host).toEqual({id:"goose",version:"1.57.0"});
  for(const trial of trials) {
    const result = JSON.parse(await readFile(join(campaign.output,"artifacts",trial.id,"workspace/result.json"),"utf8"));
    expect(result.withTarget).toBe(trial.condition==="with"); expect(result.credential).toBe("[REDACTED]");
    const conversation = await readFile(join(campaign.output,"artifacts",trial.id,"goose/conversation.json"),"utf8");
    expect(conversation).toContain("[REDACTED]"); expect(conversation).not.toContain("sentinel-secret-123");
  }
  const artifacts = db.query('SELECT * FROM artifacts').all() as {trial_id:string;path:string;sha256:string;bytes:number}[];
  for(const a of artifacts) {
    const content=await readFile(join(campaign.output,"artifacts",a.trial_id,a.path));
    expect(createHash('sha256').update(content).digest('hex')).toBe(a.sha256); expect(content.length).toBe(a.bytes);
    expect(a.path).not.toContain("secrets.yaml");
  }
  db.close();
  expect(await readFile(join(original,"config.yaml"),"utf8")).toBe(before);
  expect((await readdir(root)).filter(n=>n.startsWith('agent-plugin-goose-'))).toEqual([]);
});

for(const failure of ['export','nonzero']) test(`${failure} cannot become a complete successful campaign`,async()=>{
 const {root,plan,host}=await setup(failure==='export',failure==='nonzero');
 const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID);
 expect(result.completed).toBe(0);expect(result.failed).toBe(2);
 const db=new Database(result.registry ?? "",{readonly:true});
 const rows=db.query('SELECT status,collection FROM trials').all();
 expect(rows).toEqual(failure==='export'?[{status:'completed',collection:'unavailable'},{status:'completed',collection:'unavailable'}]:[{status:'nonzero',collection:'partial'},{status:'nonzero',collection:'partial'}]);db.close();
});

test("user-only session export never counts as a complete execution", async () => {
  const {root,plan,host}=await setup(false,false,true);
  const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID);
  expect(result.completed).toBe(0); expect(result.failed).toBe(2);
});

test("inline and file MCP declarations are refused before candidate launch", async () => {
  for (const declaration of ["inline", ".mcp.json", "mcp.json"]) {
    const {root,plan,host}=await setup();
    const target=plan.profile.components[0]; if(!target) throw new Error("Missing fixture target"); target.kind="plugin";
    await writeFile(join(target.root,"plugin.json"),JSON.stringify({name:"target", ...(declaration==="inline"?{mcpServers:{unsafe:{command:"external"}}}:{})}));
    if(declaration!=="inline") await writeFile(join(target.root,declaration),"{}");
    const files = await new FilesystemEvaluationSource().load({kind:"skill",root:target.root});
    target.files=files.files;
    await expect(executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output"),join(root,"registry","evaluations.sqlite")),randomUUID)).rejects.toThrow("MCP");
    expect((await readdir(root)).includes("output")).toBe(false);

  }
});


test("mixed profile installs both Plugins and standalone Skill from frozen bytes in every with trial", async () => {
  const {root,host,executable,target}=await setup();
  const plugins:string[]=[];
  for(const name of ["plugin-a","plugin-b"]) {
    const plugin=join(root,name);await mkdir(join(plugin,"skills",name),{recursive:true});
    await writeFile(join(plugin,"plugin.json"),JSON.stringify({name}));
    await writeFile(join(plugin,"skills",name,"SKILL.md"),"frozen Plugin Skill");
    await mkdir(join(plugin,"skills",name,"evals"));
    await writeFile(join(plugin,"skills",name,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"Candidate task",expectations:["criterion"]}]}));
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
 }
 if(expected && readFileSync(join(home,'.agents','skills','target','SKILL.md'),'utf8').includes('changed')) throw Error('live Skill installed');`));
  const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),join(root,"registry","evaluations.sqlite")),randomUUID);
  expect(result.completed).toBe(6);expect(result.failed).toBe(0);
});


for(const evidence of ["whitespace","wrong-prompt"] as const) test(`${evidence} export never supplies complete candidate evidence`,async()=>{
 const {root,plan,host}=await setup(false,false,false,evidence==="whitespace",evidence==="wrong-prompt");
 const campaign=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"proofs"),join(root,"registry","evaluations.sqlite")),randomUUID);
 expect(campaign.completed).toBe(0);expect(campaign.failed).toBe(2);
 const db=new Database(campaign.registry??"",{readonly:true});expect(db.query("SELECT collection FROM trials").all()).toEqual([{collection:"unavailable"},{collection:"unavailable"}]);db.close();
});
