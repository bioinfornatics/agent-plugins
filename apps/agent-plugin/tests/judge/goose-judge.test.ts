import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { FilesystemJudgeInstructionWriter, instructionLocation } from "../../src/adapters/outbound/storage/judge-instruction-files.ts";
import { judgmentPacket } from "../../src/adapters/outbound/judge/judgment-packet.ts";
import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startNodeProcess } from "../helpers/subprocess.ts";
import { fileURLToPath } from "node:url";
import { GooseJudge } from "../../src/adapters/outbound/judge/goose-judge.ts";
import type { JudgeRequest } from "../../src/application/ports/judge.ts";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const request: JudgeRequest = { task: "Check output", expectedOutput: "A correct result", criteria: [{ id: "profile-with-goose", text: "Result is present" }], artifacts: [{ path: "with/goose/profile/result.txt", sha256: createHash("sha256").update("correct result").digest("hex"), kind: "text", text: "correct result" }] };
const nestedSecret = 'sensitive"quote\\slash\nline';
async function setup(mode = "good", pathSuffix = "") {
  const root = await mkdtemp(join(tmpdir(), `judge-test-${pathSuffix}`)); roots.push(root);
  const original = join(root, "original"); await mkdir(original);
  await writeFile(join(original, "config.yaml"), 'GOOSE_MODEL: native-config\nGOOSE_PROVIDER: native-provider\nplugins:\n  ambient-profile:\n    enabled: true\n');
  await writeFile(join(original, "secrets.yaml"), 'TOKEN: config-secret-sentinel\n');
  const executable = join(root, "fake-goose.mjs"), log = join(root, "calls.jsonl");
  await writeFile(executable, `#!${process.execPath}
import {readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const args=process.argv.slice(2), base=process.env.XDG_CONFIG_HOME ? process.env.HOME : undefined;
if(process.env.GOOSE_PATH_ROOT !== undefined) throw Error('non-native path override');
const config=base?join(process.env.XDG_CONFIG_HOME,'goose','config.yaml'):join(process.env.ORIGINAL,'config.yaml');
appendFileSync(process.env.CALLS,JSON.stringify({args,home:process.env.HOME,cwd:process.cwd()})+'\\n');
if(args[0]==='info') console.log('Version: fake-1\\nConfig yaml: '+config+'\\nSessions DB: '+join(process.env.XDG_DATA_HOME||process.env.ORIGINAL,'goose','sessions','sessions.db')+'\\nLogs dir: '+join(process.env.XDG_STATE_HOME||process.env.ORIGINAL,'goose','logs'));
else if(args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model --with-extension --no-profile stream-json --format json');
else if(args[0]==='run') {
 const stdin=readFileSync(0,'utf8');
 const instructionPath=args[args.indexOf('--instructions')+1];
 const prompt=instructionPath==='-'?stdin:readFileSync(instructionPath,'utf8');
 if(stdin!=='' || instructionPath==='-') throw Error('file transport required');
 const command=args[args.indexOf('--with-extension')+1];
 if(!args.includes('--no-profile') || !command.startsWith('judge_evidence:')) throw Error('closed reader required');
 // Transcription of inspected Goose v1.57.0 split_command_args, not shell parsing.
 const tokens=[]; let current='', double=false, single=false;
 for(const c of command.slice('judge_evidence:'.length)) {
  if(c==='"'&&!single) double=!double;
  else if(c===String.fromCharCode(39)&&!double&&(single||current==='')) single=!single;
  else if(/\\s/u.test(c)&&!double&&!single) {if(current) {tokens.push(current);current='';}}
  else current+=c;
 }
 if(double||single) throw Error('Unmatched quote'); if(current) tokens.push(current);
 const child=spawn(tokens[0],tokens.slice(1),{stdio:['pipe','pipe','pipe']});
 let response=''; child.stdout.on('data',data=>response+=data); child.stderr.on('data',()=>{});
 child.stdin.end([
 {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fake',version:'1'}}},
 {jsonrpc:'2.0',method:'notifications/initialized'},
 {jsonrpc:'2.0',id:2,method:'tools/list'},
 {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_manifest',arguments:{}}},
 {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'read_artifact',arguments:{path:'artifact-1',offset:0,length:8192}}}
 ].map(m=>JSON.stringify(m)).join('\\n')+'\\n');
 const code=await new Promise(resolve=>child.on('close',resolve));
 const replies=response.trim().split('\\n').map(line=>JSON.parse(line));
 if(code!==0 || replies[1].result.tools.map(t=>t.name).join(',')!=='list_manifest,read_artifact' || JSON.parse(replies[3].result.content[0].text).text!=='correct result') throw Error('reader handshake/slice failed');

 appendFileSync(process.env.CALLS,JSON.stringify({prompt,config:readFileSync(config,'utf8'),model:process.env.GOOSE_MODEL,provider:process.env.GOOSE_PROVIDER,workspace:readdirSync('.'),agents:existsSync(join(process.env.HOME,'.agents'))})+'\\n');
 writeFileSync(join(base,'prompt'),prompt); writeFileSync(join(base,'name'),args[args.indexOf('--name')+1]);
 if(process.env.MODE==='timeout') setInterval(()=>{},1000);
 if(process.env.MODE==='deep-nested') {let text=process.env.NESTED_TOKEN;for(let i=0;i<18;i++) text=JSON.stringify({toolError:text});console.log(text);process.exitCode=9;}
 if(process.env.MODE==='nested-run') {console.log(JSON.stringify({message:JSON.stringify({tool:{error:process.env.NESTED_TOKEN}})}));console.error(JSON.stringify({error:JSON.stringify({detail:process.env.NESTED_TOKEN})}));process.exitCode=9;}
 if(process.env.MODE.startsWith('malformed-diagnostic-')) {
  const mode=process.env.MODE;
  const encoded=String.fromCharCode(92)+'u0065nv-secret-sentinel';
  const token=mode.endsWith('invalid')?'"'+String.fromCharCode(92)+'u00ZZ'+encoded+'"':'"'+encoded;
  console.log('event: {"error":'+token); console.error('event: {"error":'+token);process.exitCode=9;
 }
 if(process.env.MODE==='nonzero') {console.error('env-secret-sentinel config-secret-sentinel');process.exitCode=9;}
 if(process.env.MODE==='overflow') process.stdout.write('x'.repeat(17*1024*1024));
} else if(args[0]==='session') {
 if(args[args.indexOf('--name')+1]!==readFileSync(join(base,'name'),'utf8')) throw Error('session mismatch');
 if(process.env.MODE==='export') process.exit(7);
 if(process.env.MODE==='export-timeout') {setInterval(()=>{},1000); await new Promise(()=>{});}
 if(process.env.MODE==='malformed') {console.log('not JSON');process.exit(0);}
 const prompt=readFileSync(join(base,'prompt'),'utf8');
 const answer={status:'completed',judgments:[{id:'criterion-1',verdict:'pass',rationale:process.env.MODE==='secret'?'env-secret-sentinel':'Inspected result',evidence:[{path:'artifact-1',sha256:'22f56565d0c6d5e759fff74ca8abeb7b1b40f65fa142159995bbf83d0a1779f3',quote:'correct result'}]}]};
 if(process.env.MODE==='verdict') answer.judgments[0].verdict='great';
 if(process.env.MODE==='secret-quote') answer.judgments[0].evidence[0].quote='env-secret-sentinel';
 if(process.env.MODE==='wrong-hash') answer.judgments[0].evidence[0].sha256='b'.repeat(64);
 if(process.env.MODE==='unknown-path') answer.judgments[0].evidence[0].path='profile-with-goose';
 if(process.env.MODE==='nested-export') answer.judgments[0].rationale=process.env.NESTED_TOKEN;
 if(process.env.MODE==='nested-quote') answer.judgments[0].evidence[0].quote=process.env.NESTED_TOKEN;
 const final={role:'assistant',content:JSON.stringify(answer)};
 if(process.env.MODE==='nested-export') console.error(JSON.stringify({error:JSON.stringify({detail:process.env.NESTED_TOKEN})}));
 if(process.env.MODE==='fence') final.content='\u0060\u0060\u0060json\\n'+final.content+'\\n\u0060\u0060\u0060';
 if(process.env.MODE==='two-values') final.content+=' {}';
 if(process.env.MODE==='terminal') final.content='Not a judgment';
 if(process.env.MODE==='tool-block') final.content=[{type:'text',text:final.content},{type:'toolRequest',id:'x'}];
 if(process.env.MODE==='text-block') final.content=[{type:'text',text:final.content}];
 if(process.env.MODE==='tool') final.role='tool';
 if(process.env.MODE==='user') final.role='user';
 console.log(JSON.stringify({messages:[{role:'user',content:process.env.MODE==='attribution'?'wrong':prompt},{role:'assistant',content:JSON.stringify(answer)},...(process.env.MODE==='later-task'?[{role:'user',content:'unrelated task'}]:[]),final]}));
}
`, { mode: 0o700 });
  const transport = new GooseJudge({ instructionWriter: new FilesystemJudgeInstructionWriter(), executable, tempRoot: root, env: { PATH: process.env.PATH, ORIGINAL: original, CALLS: log, MODE: mode, API_KEY: "env-secret-sentinel", NESTED_TOKEN: nestedSecret, GOOSE_MODEL: "env-model", GOOSE_PROVIDER: "env-provider", GOOSE_PROFILE: "ambient-profile" } });
  const judge = { judge: (input: JudgeRequest) => transport.judge({ ...input, instructionLocation: input.instructionLocation ?? instructionLocation(root, randomUUID(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222") }) };
  return { root, original, log, judge };
}
test("judge defaults preserve native config and map blinded evidence back to exact sources", async () => {
  const { judge, root, original, log } = await setup();
  const before = await readFile(join(original, "config.yaml"), "utf8");
  const result = await judge.judge(request);
  assert.equal(result.outcome.status, "completed");
  if (result.outcome.status === "completed") assert.deepEqual(result.outcome.judgments, [{ ...request.criteria[0], verdict: "pass", rationale: "Inspected result", evidence: [{ path: request.artifacts[0]?.path, sha256: createHash("sha256").update("correct result").digest("hex"), quote: "correct result" }] }]);
  assert.equal(result.provenance.packetVersion, 2);
  assert.equal(result.provenance.limits.timeout, 600);
  assert.equal(result.provenance.limits.maxTurns, 20);
  assert.deepEqual(result.provenance.model, { source: "configuration-default", effective: "unknown" });
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const run = calls.find(call => call.args?.[0] === "run" && !call.args.includes("--help"));
  const artifact = result.provenance.instructionArtifact;
  assert.ok(artifact);
  assert.equal(run.args[run.args.indexOf("--instructions") + 1], artifact.path);
  assert.equal(await readFile(artifact.path, "utf8"), judgmentPacket(request).instructions);
  assert.equal(artifact.sha256, createHash("sha256").update(await readFile(artifact.path)).digest("hex"));
  assert.equal((await lstat(artifact.path)).mode & 0o777, 0o600);
  assert.equal(await readFile(join(root, "judging", artifact.gradeId, "evidence", "artifact-1"), "utf8"), "correct result");
  assert.ok((await readFile(join(root, "judging", artifact.gradeId, "reader-trace.jsonl"), "utf8")).includes('"deliveredBytes"'));

  assert.equal((await lstat(join(root, "judging"))).mode & 0o777, 0o700);
  assert.equal((await lstat(join(root, "judging", artifact.gradeId))).mode & 0o777, 0o700);
  assert.ok(!run.args.includes("--model")); assert.ok(run.args.includes("20"));
  const packet = calls.find(call => call.prompt);
  assert.ok(!packet.prompt.includes("profile-with-goose")); assert.ok(!packet.prompt.includes("with/goose/profile"));
  assert.ok(packet.prompt.includes("artifact-1")); assert.ok(packet.prompt.includes("untrusted"));
  assert.ok(packet.config.includes("native-config")); assert.ok(!packet.config.includes("ambient-profile"));
  assert.equal(packet.model, "env-model"); assert.equal(packet.provider, "env-provider");
  assert.deepEqual(packet.workspace, []); assert.equal(packet.agents, false);
  assert.ok(calls.every(call => !call.args?.includes("--check") && !call.args?.includes("--verbose")));
  assert.equal(await readFile(join(original, "config.yaml"), "utf8"), before);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith("agent-plugin-judge-")), []);
});

test("explicit model and limits are exact, provenance is outside the packet and sessions are fresh", async () => {
  const { judge, log } = await setup();
  const override = { ...request, options: { model: "custom model/string", maxTurns: 7, timeout: 3 } };
  const first = await judge.judge(override), second = await judge.judge(override);
  assert.equal(first.outcome.status, "completed"); assert.equal(second.outcome.status, "completed");
  assert.deepEqual(first.provenance.model, { requested: "custom model/string", source: "override", effective: "unknown" });
  assert.deepEqual(first.provenance.limits, { maxTurns: 7, timeout: 3, preflightTimeout: 10, exportTimeout: 10, outputBytes: 16777216 });
  assert.deepEqual(first.provenance.host, { id: "goose", version: "fake-1" });
  assert.match(first.provenance.instructionsSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.notEqual(first.provenance.sessionName, second.provenance.sessionName);
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const runs = calls.filter(call => call.args?.[0] === "run" && !call.args.includes("--help"));
  assert.equal(runs.length, 2); assert.notEqual(runs[0].home, runs[1].home); assert.notEqual(runs[0].cwd, runs[1].cwd);
  for (const run of runs) { assert.equal(run.args[run.args.indexOf("--model") + 1], "custom model/string"); assert.equal(run.args[run.args.indexOf("--max-turns") + 1], "7"); }
  for (const call of calls.filter(call => call.prompt)) assert.ok(!call.prompt.includes("custom model/string") && !call.prompt.includes("fake-1"));
});

test("blank overrides, invalid limits and known environment credentials fail before any host process", async () => {
  const { judge, log, root } = await setup();
  const invalid: JudgeRequest[] = [
    { ...request, options: { model: "  " } }, { ...request, options: { maxTurns: 0 } },
    { ...request, options: { timeout: -1 } }, { ...request, options: { timeout: 2147484 } },
    { ...request, options: { model: "env-secret-sentinel" } },
    { ...request, task: "env-secret-sentinel" },
    { ...request, artifacts: [{ path: "source", sha256: createHash("sha256").update("correct result").digest("hex"), kind: "text", text: "env-secret-sentinel" }] },
  ];
  for (const input of invalid) {
    const result = await judge.judge(input); assert.equal(result.outcome.status, "technical-error");
    assert.ok(!JSON.stringify(result).includes("env-secret-sentinel"));
  }
  await assert.rejects(readFile(log), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, "judging")), { code: "ENOENT" });
});

test("config credentials never enter packet/run and response credentials are redacted", async () => {
  const { judge, root, log } = await setup("secret");
  const rejected = await judge.judge({ ...request, task: "Inspect config-secret-sentinel" });
  assert.equal(rejected.outcome.status, "technical-error");
  const earlyCalls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(!earlyCalls.some(call => call.args[0] === "run"));
  await assert.rejects(lstat(join(root, "judging")), { code: "ENOENT" });
  assert.ok(!JSON.stringify(rejected).includes("config-secret-sentinel"));
  const redacted = await judge.judge(request);
  assert.equal(redacted.outcome.status, "completed");
  if (redacted.outcome.status === "completed") assert.equal(redacted.outcome.judgments[0]?.rationale, "[REDACTED]");
  assert.ok(!JSON.stringify(redacted).includes("env-secret-sentinel"));
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith("agent-plugin-judge-")), []);
});

for (const mode of ["terminal", "tool", "user", "tool-block", "attribution", "later-task", "secret-quote", "wrong-hash", "unknown-path", "fence", "two-values", "verdict", "malformed", "export", "export-timeout", "nonzero", "overflow", "timeout"]) {
  test(`${mode} is technical-error, never earlier valid JSON or a latest-session fallback, and cleans up`, async () => {
    const { judge, root, log } = await setup(mode);
    const result = await judge.judge({ ...request, options: { timeout: mode === "timeout" ? 1 : 0 } });
    assert.equal(result.outcome.status, "technical-error");
    assert.ok(!JSON.stringify(result).includes("env-secret-sentinel") && !JSON.stringify(result).includes("config-secret-sentinel"));
    assert.ok(result.provenance.instructionArtifact);
    assert.equal(await readFile(result.provenance.instructionArtifact.path, "utf8"), judgmentPacket(request).instructions);
    const gradeRoot = join(root, "judging", result.provenance.instructionArtifact.gradeId);
    assert.equal((await lstat(join(gradeRoot, "host-run.stdout"))).mode & 0o777, 0o600);
    assert.ok(!(await readFile(join(gradeRoot, "host-run.stderr"), "utf8")).includes("env-secret-sentinel"));

    const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const exports = calls.filter(call => call.args?.[0] === "session" && !call.args.includes("--help"));
    assert.equal(exports.length, ["nonzero", "overflow", "timeout"].includes(mode) ? 0 : 1);
    for (const call of exports) { assert.ok(call.args.includes("--name")); assert.ok(!call.args.includes("--latest")); }
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith("agent-plugin-judge-")), []);
  });
}

test("terminal text blocks are supported and packet projection rejects metadata injection by omission", async () => {
  const { judge, log } = await setup("text-block");
  const result = await judge.judge({ ...request, host: "hidden-host", profile: "hidden-profile", condition: "hidden-arm", artifacts: [{ ...request.artifacts[0], identity: "hidden-artifact" }] } as unknown as JudgeRequest);
  assert.equal(result.outcome.status, "completed");
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const prompt = calls.find(call => call.prompt).prompt;
  for (const hidden of ["hidden-host", "hidden-profile", "hidden-arm", "hidden-artifact"]) assert.ok(!prompt.includes(hidden));
  const packet = JSON.parse(prompt.split("JUDGMENT PACKET:\n")[1]);
  assert.deepEqual(Object.keys(packet), ["version", "task", "assertions", "expectedOutput", "manifest", "conversation"]);
  assert.equal(packet.manifest, "evidence/manifest.json");
  assert.ok(!Object.hasOwn(packet, "artifacts"));
});

test("import and construction perform no process or filesystem operations and do not load SQLite", async () => {
  const { root } = await setup();
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, XDG_CONFIG_HOME: root, XDG_DATA_HOME: root };
  delete env.NODE_TEST_CONTEXT;
  const { completed } = startNodeProcess(["--input-type=module", "--eval", `
    import * as cp from 'node:child_process';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    cp.default.spawn = () => { throw Error('spawn on import'); };
    for (const name of ['mkdtemp','mkdir','chmod','writeFile','open','rm']) fs[name] = () => { throw Error('I/O on import'); };
    syncBuiltinESMExports();
    const { GooseJudge } = await import(${JSON.stringify(new URL("../../src/adapters/outbound/judge/goose-judge.ts", import.meta.url).href)});
    new GooseJudge();
  `], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env });
  assert.deepEqual(await completed, { exitCode: 0, signal: null, stdout: "", stderr: "" });
});


test("async judge maps named export only to authority captured before its first await", async () => {
  const { judge } = await setup();
  const input: JudgeRequest = { task: request.task, criteria: request.criteria.map(value => ({ ...value })), artifacts: request.artifacts.map(value => ({ ...value })) };
  const pending = judge.judge(input);
  // judge is paused at its first info await; no caller references may survive it.
  assert.ok(input.criteria[0]); assert.ok(input.artifacts[0]);
  Object.assign(input.criteria[0], { id: "reattributed-id", text: "Changed criterion" });
  Object.assign(input.artifacts[0], { path: "reattributed/path", sha256: "b".repeat(64), text: "changed evidence" });
  input.criteria.length = 0; input.artifacts.length = 0;
  const result = await pending;
  assert.deepEqual(result.outcome, { status: "completed", judgments: [{ id: "profile-with-goose", text: "Result is present", verdict: "pass", rationale: "Inspected result", evidence: [{ path: "with/goose/profile/result.txt", sha256: createHash("sha256").update("correct result").digest("hex"), quote: "correct result" }] }] });
});

test("instruction write fault is technical, never runs Goose, and leaves no temporary HOME", async () => {
  const { root, original, log } = await setup();
  const failure = new GooseJudge({ executable: join(root, "fake-goose.mjs"), tempRoot: root,
    env: { PATH: process.env.PATH, ORIGINAL: original, CALLS: log },
    instructionWriter: { write: async () => { throw new Error("Instruction persistence failed"); } } });
  const result = await failure.judge({ ...request, instructionLocation: instructionLocation(root, randomUUID(), "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222") });
  assert.deepEqual(result.outcome, { status: "technical-error", message: "Instruction persistence failed" });
  assert.equal(result.provenance.instructionArtifact, undefined);
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(!calls.some(call => call.args?.[0] === "run" && !call.args.includes("--help")));
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith("agent-plugin-judge-")), []);
});

test("standalone judge refuses a missing persistent destination instead of creating an orphan temp file", async () => {
  const { root, log } = await setup();
  const result = await new GooseJudge({ tempRoot: root }).judge(request);
  assert.equal(result.outcome.status, "technical-error");
  await assert.rejects(readFile(log), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, "judging")), { code: "ENOENT" });
});

for (const mode of ["nested-run", "nested-export"]) test(`${mode} retains diagnostic structure but removes nested escaped credentials`, async () => {
  const { judge } = await setup(mode);
  const result = await judge.judge(request);
  assert.equal(result.outcome.status, mode === "nested-run" ? "technical-error" : "completed");
  const artifact = result.provenance.instructionArtifact; assert.ok(artifact);
  for (const name of mode === "nested-run" ? ["host-run.stdout", "host-run.stderr"] : ["host-export.json", "host-export.stderr"]) {
    let text = await readFile(join(artifact.path, "..", name), "utf8");
    assert.ok(text.includes("[REDACTED]"), name);
    for (let i = 0; i < 5; i++) {
      assert.ok(!text.includes(nestedSecret), name);
      text = text.replace(/"(?:[^"\\]|\\.)*"/g, token => { try { return JSON.parse(token); } catch { return token; } });
    }
  }
  assert.ok(!JSON.stringify(result).includes("sensitive"));
});

test("reader launch supports spaces, apostrophes, double quotes, Unicode and literal shell metacharacters", async () => {
  for (const suffix of ["space 'é$;&", 'space "é$;&']) {
    const { judge } = await setup("good", suffix);
    assert.equal((await judge.judge(request)).outcome.status, "completed");
  }
});
test("mixed quotes are refused before persistent instruction allocation", async () => {
  const { judge, root, log } = await setup("good", `both'" `);
  const result = await judge.judge(request);
  assert.equal(result.outcome.status, "technical-error");
  assert.equal(result.provenance.instructionArtifact, undefined);
  assert.ok(!(await readdir(root)).includes("judging"));
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(!calls.some(call => call.args?.[0] === "run" && !call.args.includes("--help")));
});

test("excessively nested diagnostics fail closed with bounded work and original secret quotes cannot validate", async () => {
  for (const mode of ["deep-nested", "nested-quote"]) {
    const { judge } = await setup(mode);
    const result = await judge.judge(request);
    assert.equal(result.outcome.status, "technical-error");
    const artifact = result.provenance.instructionArtifact; assert.ok(artifact);
    const text = await readFile(join(artifact.path, "..", mode === "deep-nested" ? "host-run.stdout" : "host-export.json"), "utf8");
    assert.ok(!text.includes("sensitive"));
    if (mode === "deep-nested") assert.equal(text, "[OMITTED: diagnostic sanitization limit]");
  }
});

for (const mode of ["malformed-diagnostic-unterminated", "malformed-diagnostic-invalid"]) {
  test(`${mode} omits prefixed undecodable encoded credentials`, async () => {
    const { judge } = await setup(mode);
    const result = await judge.judge(request);
    assert.equal(result.outcome.status, "technical-error");
    const artifact = result.provenance.instructionArtifact; assert.ok(artifact);
    for (const name of ["host-run.stdout", "host-run.stderr"]) {
      assert.equal(await readFile(join(artifact.path, "..", name), "utf8"), "[OMITTED: diagnostic sanitization limit]");
    }
  });
}
