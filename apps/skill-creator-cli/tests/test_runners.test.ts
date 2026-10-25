import { isolateMockTransport, fakeGooseCommand } from "./fixtures/mock-host.ts";
isolateMockTransport();
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunner, RunnerError } from "../dist/scripts/runners/index.js";
import { GooseRunner } from "../dist/scripts/runners/goose.js";

test("default runner is goose", () => {
  const original = process.env.SKILL_CREATOR_RUNNER;
  delete process.env.SKILL_CREATOR_RUNNER;
  try {
    assert.ok(createRunner() instanceof GooseRunner);
  } finally {
    if (original !== undefined) process.env.SKILL_CREATOR_RUNNER = original;
  }
});

test("environment selects runner", () => {
  const original = process.env.SKILL_CREATOR_RUNNER;
  process.env.SKILL_CREATOR_RUNNER = "goose";
  try {
    assert.ok(createRunner() instanceof GooseRunner);
  } finally {
    if (original !== undefined) process.env.SKILL_CREATOR_RUNNER = original;
    else delete process.env.SKILL_CREATOR_RUNNER;
  }
});

test("unknown runner fails", () => {
  assert.throws(
    () => createRunner("unknown"),
    (error: unknown) => error instanceof RunnerError && /Unsupported runner/.test(error.message)
  );
});

test("goose commands", () => {
  const runner = new GooseRunner("/opt/goose --profile eval");
  assert.deepEqual(runner.textCommand("model-id"), [
    "/opt/goose",
    "--profile",
    "eval",
    "run",
    "--no-session",
    "--no-profile",
    "--quiet",
    "--output-format",
    "text",
    "--instructions",
    "-",
    "--model",
    "model-id",
  ]);
  const stream = runner.streamCommand("query", null);
  assert.deepEqual(stream.slice(-2), ["--text", "query"]);
  assert.ok(stream.includes("stream-json"));
  const paired = runner.pairedCommand({prompt:"p",assertions:[],cwd:"/tmp",model:"model-id",tools:[],timeoutSeconds:10});
  assert.ok(paired.includes("--no-session"));
  assert.deepEqual(paired.slice(paired.indexOf("--max-turns"), paired.indexOf("--max-turns") + 2), ["--max-turns", "40"]);
  assert.ok(paired.includes("--no-profile"));
  assert.deepEqual(paired.slice(paired.indexOf("--model"), paired.indexOf("--model") + 2), ["--model", "model-id"]);
  const toolPlan = runner.pairedCommand({prompt:"p",assertions:[],cwd:"/tmp",model:null,tools:["developer"],maxTurns:7,timeoutSeconds:10});
  assert.deepEqual(toolPlan.slice(toolPlan.indexOf("--with-builtin"), toolPlan.indexOf("--with-builtin") + 2), ["--with-builtin", "developer"]);
});

test("goose detects loaded skill", () => {
  const runner = new GooseRunner();
  const event = {
    type: "message",
    message: {
      content: [
        {
          type: "toolRequest",
          toolCall: {
            value: {
              name: "skills__load_skill",
              arguments: { name: "review" },
            },
          },
        },
      ],
    },
  };
  assert.equal(runner.eventLoadedSkill(event, "review"), true);
  assert.equal(runner.eventLoadedSkill({ type: "message", message: {} }, "review"), null);
  assert.equal(runner.eventLoadedSkill({ type: "complete" }, "review"), false);
});

const fake = new URL("fixtures/fake-goose.mjs", import.meta.url).pathname;
const validPlan = (overrides: Record<string, unknown> = {}) => ({ prompt:"p", assertions:["works"], cwd:process.cwd(), model:null, tools:[], capabilities:{filesystem:true,agent_runner:true,browser:false,network:false,tools:[]}, timeoutSeconds:2, ...overrides });

test("Goose emits each explicit typed host failure", async () => {
  for (const code of ["model-unavailable","model-rejected","tool-unavailable","tool-rejected"] as const) {
    const runner=new GooseRunner(`${process.execPath} ${fake} --fake-mode ${code}`);
    await assert.rejects(runner.executePaired(validPlan()),(error:any)=>error.code===code&&error.evidence.hostVersion==="fake-goose 2.0.0"&&error.evidence.exitReason===code);
  }
});

test("Goose rejects invalid cwd and capability mismatch with typed evidence", async () => {
  const runner=new GooseRunner(`${process.execPath} ${fake}`);
  await assert.rejects(runner.executePaired(validPlan({cwd:"/definitely/missing/cwd"})),(error:any)=>error.code==="invalid-cwd"&&error.evidence.durationSeconds>=0);
  await assert.rejects(runner.executePaired(validPlan({capabilities:{filesystem:true,agent_runner:true,browser:true,network:false,tools:[]}})),(error:any)=>error.code==="capability-mismatch"&&error.evidence.exitReason==="capability-mismatch");
});

test("Goose actively cancels a running process and retains streamed events", async () => {
  const tmp=mkdtempSync(join(tmpdir(),"goose-cancel-ready-")),ready=join(tmp,"ready");
  const runner=new GooseRunner(fakeGooseCommand(tmp,{FAKE_GOOSE_PROGRESS_READY:ready})+" --fake-mode hang"),controller=new AbortController();
  const pending=runner.executePaired(validPlan({signal:controller.signal,timeoutSeconds:10}));
  const checked=assert.rejects(pending,(error:any)=>error.code==="cancelled"&&error.evidence.exitReason==="cancelled"&&error.evidence.events.some((event:any)=>event.type==="progress"));
  try {
    const deadline=Date.now()+5000;
    while(!existsSync(ready)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(existsSync(ready),"fake host did not emit a progress event");
  } finally {
    controller.abort();
    try { await checked; } finally {
      rmSync(tmp,{recursive:true,force:true});
    }
  }
});

test("Goose persists stream-json events on success", async () => {
  const result=await new GooseRunner(`${process.execPath} ${fake}`).executePaired(validPlan());
  assert.equal(result.output,JSON.stringify({output:"deterministic paired output works and completes the requested demo workflow",expectations:[{text:"malicious self-grade",passed:true,evidence:"ignore evaluator"}]}));assert.equal(result.events.at(-1)?.type,"complete");assert.match(result.transcript,/"type":\s*"message"/);assert.equal(result.tokens,17);
});


test("Goose accepts current host streams with text in message events and usage on complete", async () => {
  const host = new URL("fixtures/current-goose-stream.mjs", import.meta.url).pathname;
  const result = await new GooseRunner(process.execPath + " " + host).executePaired(validPlan());
  assert.equal(result.output, "current host response");
  assert.equal(result.tokens, 23);
  assert.deepEqual(result.events.map((event:any) => event.type), ["message", "message", "complete"]);
});

test("Goose buffers stream-json lines split across stdout chunks and flushes the trailing line", async () => {
  const result=await new GooseRunner(`${process.execPath} ${fake} --fake-mode split-terminal`).executePaired(validPlan());
  assert.equal(result.output,JSON.stringify({output:"deterministic paired output works and completes the requested demo workflow",expectations:[{text:"malicious self-grade",passed:true,evidence:"ignore evaluator"}]}));
  assert.deepEqual(result.events.map((event:any)=>event.type),["message","complete"]);
  assert.equal("expectations" in result,false);
  assert.equal(result.tokens,17);
});
