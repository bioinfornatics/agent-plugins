import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GooseHost } from "../../src/adapters/outbound/hosts/goose/goose-host.ts";
import { SqliteEvaluationStore } from "../../src/adapters/outbound/storage/sqlite-evaluation-store.ts";
import { executeEvaluation } from "../../src/application/use-cases/execute-evaluation.ts";
import { buildMatrix } from "../../src/domain/evaluation.ts";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup(exportFailure = false, nonzero = false, userOnly = false) {
  const root = await mkdtemp(join(tmpdir(), "goose-campaign-")); roots.push(root);
  const original = join(root, "original"); await mkdir(original);
  await writeFile(join(original, "config.yaml"), 'GOOSE_MODEL: fake\nextensions:\n  developer:\n    type: builtin\n    enabled: true\n  ambient:\n    type: stdio\n    cmd: dangerous\n');
  await writeFile(join(original, "secrets.yaml"), 'OPENAI_API_KEY: sentinel-secret-123\n');
  const target = join(root, "target"); await mkdir(join(target, "evals"), { recursive: true });
  await writeFile(join(target, "SKILL.md"), '---\nname: target\ndescription: example\n---\n');
  await writeFile(join(target, "evals", "evals.json"), '{"hidden":"judge criterion"}');
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
 writeFileSync('result.json',JSON.stringify({withTarget:existsSync(skill),prompt,credential:process.env.OPENAI_API_KEY}));
 console.log(JSON.stringify({type:'message',text:'sentinel-secret-123'}));
 process.exitCode=${nonzero ? 7 : 0};
} else if(args[0]==='session') { if(${exportFailure}) process.exitCode=4; else console.log(JSON.stringify({messages:[{role:'user',content:'Candidate task'},...(${userOnly} ? [] : [{role:'assistant',content:'sentinel-secret-123 result'}])]})); }
`, { mode: 0o700 });
  const scenario = { id: "target/1", sourceId: 1, skill: target, suite: join(target,"evals","evals.json"), prompt: "Candidate task", expectations: ["judge criterion"] };
  const plan = buildMatrix([{ kind: "skill", root: target, scenarios: [scenario] }], { agents: ["goose"], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 3 });
  const host = new GooseHost({ executable, tempRoot: root, env: { PATH: process.env.PATH, ORIGINAL_CONFIG: original, OPENAI_API_KEY: "sentinel-secret-123", GOOSE_MOIM_MESSAGE_FILE: "/operator/context" } });
  return { root, original, plan, host };
}

test("two native-style trials have dedicated redacted conversations and hashed SQLite evidence", async () => {
  const { root, original, plan, host } = await setup();
  const before = await readFile(join(original,"config.yaml"),"utf8");
  const campaign = await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output")));
  expect(campaign.completed).toBe(2); expect(campaign.failed).toBe(0);
  const db = new Database(join(campaign.output,"evaluation.sqlite"),{readonly:true});
  const trials = db.query('SELECT * FROM trials ORDER BY id').all() as {id:string;condition:string;status:string;collection:string;receipt_json:string}[];
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
 const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,'output')));
 expect(result.completed).toBe(0);expect(result.failed).toBe(2);
 const db=new Database(join(result.output,'evaluation.sqlite'),{readonly:true});
 const rows=db.query('SELECT status,collection FROM trials').all();
 expect(rows).toEqual(failure==='export'?[{status:'completed',collection:'unavailable'},{status:'completed',collection:'unavailable'}]:[{status:'nonzero',collection:'partial'},{status:'nonzero',collection:'partial'}]);db.close();
});

test("user-only session export never counts as a complete execution", async () => {
  const {root,plan,host}=await setup(false,false,true);
  const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output")));
  expect(result.completed).toBe(0); expect(result.failed).toBe(2);
});

test("inline and file MCP declarations are refused before candidate launch", async () => {
  for (const declaration of ["inline", ".mcp.json", "mcp.json"]) {
    const {root,plan,host}=await setup();
    const target=plan.targets[0]; if(!target) throw new Error("Missing fixture target"); target.kind="plugin";
    await writeFile(join(target.root,"plugin.json"),JSON.stringify({name:"target", ...(declaration==="inline"?{mcpServers:{unsafe:{command:"external"}}}:{})}));
    if(declaration!=="inline") await writeFile(join(target.root,declaration),"{}");
    const result=await executeEvaluation(plan,new Map([["goose",host]]),new SqliteEvaluationStore(join(root,"output")));
    expect(result.completed).toBe(0); expect(result.failed).toBe(2);
    const db=new Database(join(result.output,"evaluation.sqlite"),{readonly:true});
    expect(db.query("SELECT count(*) AS count FROM artifacts").get()).toEqual({count:0}); db.close();
  }
});
