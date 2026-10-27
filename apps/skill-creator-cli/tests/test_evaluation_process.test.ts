import test from "node:test";
import assert from "node:assert/strict";
import {runProcess, classifyDiagnostic, projectDiagnosticChannel, recoveryForFailure} from "../dist/scripts/evaluation_process.js";
const child = (code: string, timeout = 3) => runProcess([process.execPath,"-e",code],process.cwd(),process.env,"input",timeout);
const project = (text: string, reason = "completed", invalid = false) => projectDiagnosticChannel(text,Buffer.byteLength(text),reason,t=>t.replaceAll("fixture-private-value","[REDACTED]"),invalid);
test("process preserves independent observed bytes, exit and stdin",async()=>{
 const r=await child("process.stdin.resume();process.stdin.on('data',x=>process.stdout.write(x));process.stderr.write('err');process.exitCode=7");
 assert.equal(r.reason,"host-exit");assert.equal(r.code,7);assert.equal(r.stdout,"input");assert.equal(r.stderr,"err");assert.equal(r.stdoutBytes,5);assert.equal(r.stderrBytes,3);
});
test("fatal UTF8 handles split valid characters and trailing invalid sequence",async()=>{
 const valid=await child("process.stdout.write(Buffer.from([0xe2]));setTimeout(()=>process.stdout.write(Buffer.from([0x82,0xac])),20)");assert.equal(valid.stdout,"€");assert.equal(valid.stdoutBytes,3);
 const invalid=await child("process.stderr.write(Buffer.from([0xe2]))");assert.equal(invalid.reason,"invalid-utf8");assert.equal(invalid.stderrDecodeInvalid,true);assert.equal(invalid.stderrBytes,1);
});
test("aggregate guard applies across both channels",async()=>{
 const r=await child("process.stdout.write(Buffer.alloc(9*1024*1024,97));process.stderr.write(Buffer.alloc(9*1024*1024,98));setInterval(()=>{},1000)");
 assert.equal(r.reason,"output-limit");assert(r.stdoutBytes+r.stderrBytes>16*1024*1024);assert.equal(projectDiagnosticChannel(r.stdout,r.stdoutBytes,r.reason,t=>t,r.stdoutDecodeInvalid).text,null);
});
test("timeout terminates resistant owned group without retry",{skip:process.platform==="win32"},async()=>{
 const r=await child("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",.15);assert.equal(r.reason,"timeout");assert.equal(r.signal,"SIGKILL");assert(r.durationSeconds<2);
});
test("first decoding failure cannot become timeout",async()=>{
 const r=await child("process.on('SIGTERM',()=>{});process.stdout.write(Buffer.from([255]));setInterval(()=>{},1000)",.15);assert.equal(r.reason,"invalid-utf8");assert.equal(r.stdoutDecodeInvalid,true);
});
test("missing executable returns closed launch failure",async()=>{
 const r=await runProcess(["/nonexistent-fixture-executable"],process.cwd(),{},"",1);assert.equal(r.reason,"launch-failed");assert.equal(r.code,null);assert.deepEqual(r.diagnostic,{category:"launch",code:"launch-failed",source:"process"});
});
test("projection redacts before cap and never splits UTF8",()=>{
 const r=project("fixture-private-value\n"+"é\n".repeat(30000));assert.equal(r.redacted,true);assert.equal(r.truncated,true);assert(r.retained_bytes<=65536);assert(!r.text?.includes("fixture-private-value"));assert(!r.text?.includes("�"));assert.equal(r.path,null);
});
test("partial and invalid channels withheld without redactor invocation",()=>{
 for(const reason of ["timeout","output-limit","invalid-utf8"]){const r=projectDiagnosticChannel("partial",7,reason,()=>{throw Error("must not project");},reason==="invalid-utf8");assert.equal(r.text,null);assert.equal(r.withheld,true);assert.equal(r.observed_bytes,7);assert.equal(r.retained_bytes,0);}
 assert.equal(project("ordinary","completed",true).text,null);
});
test("structured payload retains only closed event counts",()=>{
 const r=project('{"type":"message","reasoning":"private"}\n');assert.equal(r.text,null);assert.deepEqual(r.events,{message:1});assert.equal(r.withheld_reason,"provider-event-stream");assert.equal(project('event: {"type":"message"}').withheld_reason,"unsupported-structured-payload");assert.equal(project("secret=unknown-value").text,null);
});
test("diagnostics preserve native shape and prioritize observed failure",()=>{
 const native="\n  error: No provider configured. Run 'goose configure' first.\n\n";
 assert.deepEqual(classifyDiagnostic(native,"","host-exit"),{category:"configuration",code:"provider-not-configured",source:"stdout"});assert.equal(classifyDiagnostic(native,"","timeout")?.code,"timeout");assert.equal(classifyDiagnostic("","","completed"),null);
 assert.equal(classifyDiagnostic("","429 too many requests","host-exit","discovery")?.code,"unknown-host-failure");assert.deepEqual(classifyDiagnostic("","429 too many requests","host-exit","task"),{category:"network",code:"rate-limited",source:"stderr",evidence_kind:"text-hint"});
 assert.equal(classifyDiagnostic("","ECONNRESET","host-exit","task")?.evidence_kind,"text-hint");
});
test("recovery is fixed advisory only, never automatic retry",()=>{
 const cases={"authentication-failed":"user-prerequisite","missing-configuration":"user-prerequisite","rate-limited":"review-bounded-retry-policy","transient-network-failure":"review-bounded-retry-policy","timeout":"inspect-indeterminate-completion","invocation-result-capture-failed":"repair-capture-without-relaunch","sensitive-input-target":"repair-capture-without-relaunch","unknown":"inspect-failure"};
 for(const [code,action] of Object.entries(cases))assert.deepEqual(recoveryForFailure(code),{retryable:false,action});
});

test("numeric-only HTTP 429 is a task-stage advisory hint",()=>{
 assert.equal(classifyDiagnostic("HTTP 429", "", "host-exit", "task")?.code,"rate-limited");
 assert.equal(classifyDiagnostic("HTTP 429", "", "host-exit", "discovery")?.code,"unknown-host-failure");
});
