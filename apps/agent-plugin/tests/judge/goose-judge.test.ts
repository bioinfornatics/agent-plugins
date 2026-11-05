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
const request: JudgeRequest = { task: "Check output", expectedOutput: "A correct result", criteria: [{ id: "profile-with-goose", text: "Result is present" }], artifacts: [{ path: "with/goose/profile/result.txt", sha256: "a".repeat(64), kind: "text", text: "correct result" }] };
async function setup(mode = "good") {
  const root = await mkdtemp(join(tmpdir(), "judge-test-")); roots.push(root);
  const original = join(root, "original"); await mkdir(original);
  await writeFile(join(original, "config.yaml"), 'GOOSE_MODEL: native-config\nGOOSE_PROVIDER: native-provider\nplugins:\n  ambient-profile:\n    enabled: true\n');
  await writeFile(join(original, "secrets.yaml"), 'TOKEN: config-secret-sentinel\n');
  const executable = join(root, "fake-goose.mjs"), log = join(root, "calls.jsonl");
  await writeFile(executable, `#!${process.execPath}
import {readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2), base=process.env.GOOSE_PATH_ROOT;
const config=base?join(base,'config','config.yaml'):join(process.env.ORIGINAL,'config.yaml');
appendFileSync(process.env.CALLS,JSON.stringify({args,home:process.env.HOME,cwd:process.cwd()})+'\\n');
if(args[0]==='info') console.log('Version: fake-1\\nConfig yaml: '+config+'\\nSessions DB: '+join(base||process.env.ORIGINAL,'sessions.db')+'\\nLogs dir: '+join(base||process.env.ORIGINAL,'logs'));
else if(args.includes('--help')) console.log('--instructions --name --max-turns --quiet --output-format --model stream-json --format json');
else if(args[0]==='run') {
 const prompt=readFileSync(0,'utf8');
 appendFileSync(process.env.CALLS,JSON.stringify({prompt,config:readFileSync(config,'utf8'),model:process.env.GOOSE_MODEL,provider:process.env.GOOSE_PROVIDER,workspace:readdirSync('.'),agents:existsSync(join(process.env.HOME,'.agents'))})+'\\n');
 writeFileSync(join(base,'prompt'),prompt); writeFileSync(join(base,'name'),args[args.indexOf('--name')+1]);
 if(process.env.MODE==='timeout') setInterval(()=>{},1000);
 if(process.env.MODE==='nonzero') {console.error('env-secret-sentinel config-secret-sentinel');process.exitCode=9;}
 if(process.env.MODE==='overflow') process.stdout.write('x'.repeat(17*1024*1024));
} else if(args[0]==='session') {
 if(args[args.indexOf('--name')+1]!==readFileSync(join(base,'name'),'utf8')) throw Error('session mismatch');
 if(process.env.MODE==='export') process.exit(7);
 if(process.env.MODE==='export-timeout') {setInterval(()=>{},1000); await new Promise(()=>{});}
 if(process.env.MODE==='malformed') {console.log('not JSON');process.exit(0);}
 const prompt=readFileSync(join(base,'prompt'),'utf8');
 const answer={status:'completed',judgments:[{id:'criterion-1',verdict:'pass',rationale:process.env.MODE==='secret'?'env-secret-sentinel':'Inspected result',evidence:[{path:'artifact-1',sha256:'a'.repeat(64),quote:'correct result'}]}]};
 if(process.env.MODE==='verdict') answer.judgments[0].verdict='great';
 if(process.env.MODE==='secret-quote') answer.judgments[0].evidence[0].quote='env-secret-sentinel';
 if(process.env.MODE==='wrong-hash') answer.judgments[0].evidence[0].sha256='b'.repeat(64);
 if(process.env.MODE==='unknown-path') answer.judgments[0].evidence[0].path='profile-with-goose';
 const final={role:'assistant',content:JSON.stringify(answer)};
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
  const judge = new GooseJudge({ executable, tempRoot: root, env: { PATH: process.env.PATH, ORIGINAL: original, CALLS: log, MODE: mode, API_KEY: "env-secret-sentinel", GOOSE_MODEL: "env-model", GOOSE_PROVIDER: "env-provider", GOOSE_PROFILE: "ambient-profile" } });
  return { root, original, log, judge };
}
test("judge defaults preserve native config and map blinded evidence back to exact sources", async () => {
  const { judge, root, original, log } = await setup();
  const before = await readFile(join(original, "config.yaml"), "utf8");
  const result = await judge.judge(request);
  assert.equal(result.outcome.status, "completed");
  if (result.outcome.status === "completed") assert.deepEqual(result.outcome.judgments, [{ ...request.criteria[0], verdict: "pass", rationale: "Inspected result", evidence: [{ path: request.artifacts[0]?.path, sha256: "a".repeat(64), quote: "correct result" }] }]);
  assert.deepEqual(result.provenance.model, { source: "configuration-default", effective: "unknown" });
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const run = calls.find(call => call.args?.[0] === "run" && !call.args.includes("--help"));
  assert.ok(!run.args.includes("--model")); assert.ok(run.args.includes("50"));
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
  const { judge, log } = await setup();
  const invalid: JudgeRequest[] = [
    { ...request, options: { model: "  " } }, { ...request, options: { maxTurns: 0 } },
    { ...request, options: { timeout: -1 } }, { ...request, options: { timeout: 2147484 } },
    { ...request, options: { model: "env-secret-sentinel" } },
    { ...request, task: "env-secret-sentinel" },
    { ...request, artifacts: [{ path: "source", sha256: "a".repeat(64), kind: "text", text: "env-secret-sentinel" }] },
  ];
  for (const input of invalid) {
    const result = await judge.judge(input); assert.equal(result.outcome.status, "technical-error");
    assert.ok(!JSON.stringify(result).includes("env-secret-sentinel"));
  }
  await assert.rejects(readFile(log), { code: "ENOENT" });
});

test("config credentials never enter packet/run and response credentials are redacted", async () => {
  const { judge, root, log } = await setup("secret");
  const rejected = await judge.judge({ ...request, task: "Inspect config-secret-sentinel" });
  assert.equal(rejected.outcome.status, "technical-error");
  const earlyCalls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(!earlyCalls.some(call => call.args[0] === "run"));
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
  const packet = JSON.parse(prompt.split("EVIDENCE JSON:\n")[1]);
  assert.deepEqual(Object.keys(packet), ["task", "expectedOutput", "criteria", "artifacts"]);
  assert.deepEqual(Object.keys(packet.artifacts[0]), ["path", "sha256", "kind", "text"]);
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
  assert.deepEqual(result.outcome, { status: "completed", judgments: [{ id: "profile-with-goose", text: "Result is present", verdict: "pass", rationale: "Inspected result", evidence: [{ path: "with/goose/profile/result.txt", sha256: "a".repeat(64), quote: "correct result" }] }] });
});
