import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareEvaluation } from "../../src/application/use-cases/prepare-evaluation.ts";
import { FilesystemEvaluationSource } from "../../src/adapters/outbound/filesystem/filesystem-evaluation-source.ts";
import { createCli } from "../../src/adapters/inbound/cli/create-cli.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root,{recursive:true,force:true}))); });
async function workspace() { const root=await mkdtemp(join(tmpdir(),"profile-test-")); roots.push(root);return root; }
async function skill(root: string) {
  await mkdir(join(root,"evals"),{recursive:true});
  await writeFile(join(root,"SKILL.md"),"initial capability");
  await writeFile(join(root,"evals","evals.json"),JSON.stringify({evals:[{id:1,prompt:"task",expectations:["criterion"],fixtures:"fixtures"}]}));
  await mkdir(join(root,"evals","fixtures"));
  await writeFile(join(root,"evals","fixtures","input.txt"),"original fixture");
  return root;
}
const options={agents:["goose"],repetitions:1,maxTurns:5,timeout:0,parallelism:3};
const source=new FilesystemEvaluationSource();

test("unordered selection and labels preserve profile identity; captured content changes revision only",async()=>{
  const root=await workspace(),a=await skill(join(root,"a")),b=await skill(join(root,"b"));
  const first=await prepareEvaluation({...options,skills:[a,b],plugins:[],profileName:"Analysis"},source);
  const reordered=await prepareEvaluation({...options,skills:[b,a,b],plugins:[],profileName:"Renamed"},source);
  assert.strictEqual(reordered.profile.id, first.profile.id);
  assert.strictEqual(reordered.profile.revision, first.profile.revision);
  assert.strictEqual(first.profile.name, "Analysis");
  assert.strictEqual(reordered.profile.name, "Renamed");
  assert.strictEqual(first.candidateRuns, 4);
  await writeFile(join(a,"SKILL.md"),"updated capability");
  await writeFile(join(a,"evals","fixtures","input.txt"),"updated fixture");
  const changed=await prepareEvaluation({...options,skills:[a,b],plugins:[]},source);
  assert.strictEqual(changed.profile.id, first.profile.id);
  assert.notStrictEqual(changed.profile.revision, first.profile.revision);
  assert.strictEqual(changed.profile.name, `profile-${first.profile.id.slice(0,12)}`);
  const capturedSkill=first.profile.components[0]?.files.find(f=>f.path==="SKILL.md");
  const capturedFixture=first.profile.scenarios[0]?.fixturesFiles?.[0];
  if (!capturedSkill || !capturedFixture) throw new Error("Missing captured inputs");
  assert.strictEqual(Buffer.from(capturedSkill.content,"base64").toString(), "initial capability");
  assert.strictEqual(Buffer.from(capturedFixture.content,"base64").toString(), "original fixture");
  assert.strictEqual(first.profile.components.flatMap(t=>t.files).some(f=>f.path.includes("evals")), false);
});

test("Plugin plus its explicit child is one installation and one suite, without losing whole Plugin",async()=>{
  const root=await workspace(),plugin=join(root,"bundle");
  await mkdir(plugin);
  await writeFile(join(plugin,"plugin.json"),'{"name":"bundle"}');
  const child=await skill(join(plugin,"skills","child"));
  const plan=await prepareEvaluation({...options,skills:[child],plugins:[plugin]},source);
  assert.deepStrictEqual(plan.profile.components.map(t=>[t.kind,t.root]), [["plugin",plugin]]);
  assert.strictEqual((plan.profile.scenarios).length, 1);
  assert.strictEqual(plan.candidateRuns, 2);
  const pluginOnly=await prepareEvaluation({...options,skills:[],plugins:[plugin]},source);
  assert.strictEqual(plan.profile.id, pluginOnly.profile.id);
  assert.strictEqual(plan.profile.revision, pluginOnly.profile.revision);
});

test("ambiguous Skill capability names and Plugin installation names reject before execution",async()=>{
  const root=await workspace(),a=await skill(join(root,"left","same")),b=await skill(join(root,"right","same"));
  await assert.rejects(prepareEvaluation({...options,skills:[a,b],plugins:[]},source), /Ambiguous profile installation: same/);
  const plugins=[];
  for(const [i,name] of [[1,"one"],[2,"two"]] as const) {
    const p=join(root,`plugin-${i}`);await mkdir(p);await writeFile(join(p,"plugin.json"),'{"name":"same-plugin"}');
    await skill(join(p,"skills",name));plugins.push(p);
  }
  await assert.rejects(prepareEvaluation({...options,skills:[],plugins},source), /Ambiguous profile installation/);
});

test("snapshot revision includes executable intent and rejects links rather than following external content",async()=>{
  const root=await skill(await workspace());
  const before=await source.load({kind:"skill",root});
  await chmod(join(root,"SKILL.md"),0o700);
  const executable=await source.load({kind:"skill",root});
  assert.notStrictEqual(executable.fingerprint, before.fingerprint);
  await symlink(join(root,"SKILL.md"),join(root,"external-link"));
  await assert.rejects(source.load({kind:"skill",root}), /symlinks/);
});

test("CLI exposes profile naming and only the singular Plugin selector",async()=>{
  let input: unknown;
  const cli=createCli({writeOut:()=>{},writeErr:()=>{}},async value=>{input=value;});
  await cli.parseAsync(["evaluation","--plugin","bundle","--profile-name","Analysis","--dry-run"],{from:"user"});
  assert.deepStrictEqual({ plugins: (input as { plugins: unknown; profileName: unknown }).plugins, profileName: (input as { plugins: unknown; profileName: unknown }).profileName }, {plugins:["bundle"],profileName:"Analysis"});
  await assert.rejects(createCli({writeOut:()=>{},writeErr:()=>{}},async()=>{}).parseAsync(["evaluation","--plugins","bundle"],{from:"user"}), {code:"commander.unknownOption"});
});
