import assert from "node:assert/strict";
import { test } from "node:test";
import { createCli } from "../../src/adapters/inbound/cli/create-cli.ts";
import { executeWithHeartbeat, HEARTBEAT_INTERVAL_MS } from "../../src/adapters/inbound/cli/command-heartbeat.ts";

// Hold a command open while advancing only timer time. Duration uses a monotonic
// clock; no sleep or paid host is needed to test the observable heartbeat contract.
for (const [args, label] of [
  [["evaluation", "--skills", "private-skill"], "evaluation"],
  [["evaluation", "--resume", "private-campaign"], "resume"],
  [["grading", "private-campaign", "--attempt", "private-attempt", "--json"], "grading"],
  [["regrading", "private-campaign", "--attempt", "private-attempt", "--json"], "regrading"],
] as const) test(`${label} heartbeat is periodic stderr only and quiet aliases preserve JSON`, async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  for (const flags of [[], ["-q"], ["--quiet"]]) {
    let out = "", err = "", calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const output = { writeOut: (s: string) => { out += s; }, writeErr: (s: string) => { err += s; } };
    const handler = async () => { calls++; await gate; output.writeOut('{"completed":1}\n'); };
    const cli = createCli(output, handler, undefined, handler);
    const pending = cli.parseAsync([...args, ...flags], { from: "user" });
    await Promise.resolve();
    assert.equal(calls, 1);
    now += HEARTBEAT_INTERVAL_MS - 1; t.mock.timers.tick(HEARTBEAT_INTERVAL_MS - 1);
    assert.equal(err, ""); assert.equal(out, "");
    now++; t.mock.timers.tick(1);
    assert.equal(err, flags.length ? "" : `[agent-plugin] ${label}: active; elapsed 10s\n`);
    now += HEARTBEAT_INTERVAL_MS; t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
    assert.equal(err, flags.length ? "" : `[agent-plugin] ${label}: active; elapsed 10s\n[agent-plugin] ${label}: active; elapsed 20s\n`);
    assert.equal(calls, 1); // Ticks do not execute or retry commands.
    assert.ok(release); release(); await pending;
    assert.deepEqual(JSON.parse(out), { completed: 1 });
    const before = err; now += HEARTBEAT_INTERVAL_MS; t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
    assert.equal(err, before);
  }
});

test("dry-run and readonly dispatch never allocate heartbeat intervals", async t => {
  const interval = t.mock.method(globalThis, "setInterval", () => { throw Error("Unexpected heartbeat timer"); });
  const output = { writeOut: () => {}, writeErr: () => {} };
  const handler = async () => {};
  for (const args of [["evaluation", "--skills", "skill", "--dry-run"], ["history"], ["inspect", "campaign"], ["judgments", "campaign"], ["validate", "skill"], ["export", "campaign", "--grading", "grade", "--output", "new"]]) {
    await createCli(output, handler, handler, handler, handler, handler, handler).parseAsync(args, { from: "user" });
  }
  await assert.rejects(createCli(output, handler).parseAsync(["evaluation", "--help"], { from: "user" }), { exitCode: 0 });
  await assert.rejects(createCli(output, handler).parseAsync(["evaluation"], { from: "user" }), { exitCode: 1 });
  assert.equal(interval.mock.callCount(), 0);
});

test("heartbeat cleanup preserves original rejection and tolerates diagnostic sink failure", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const sinkFails of [false, true]) {
    let writes = 0;
    let reject: ((error: Error) => void) | undefined;
    const gate = new Promise<void>((_, fail) => { reject = fail; });
    const error = new Error("operation failed");
    const pending = executeWithHeartbeat({ writeOut: () => {}, writeErr: () => { writes++; if (sinkFails) throw Error("private sink failure"); } }, "evaluation", false, async () => await gate);
    const rejected = assert.rejects(pending, received => received === error);
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS); assert.equal(writes, 1);
    assert.ok(reject); reject(error); await rejected;
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS * 2); assert.equal(writes, 1);
  }
  await assert.rejects(executeWithHeartbeat({ writeOut: () => {}, writeErr: () => { throw Error("unexpected write"); } }, "grading", false, () => { throw Error("factory failure"); }), /factory failure/);
  t.mock.timers.tick(HEARTBEAT_INTERVAL_MS * 2);
});

test("real subprocess keeps stdout JSON, emits heartbeat on stderr and exits after completion", async () => {
  const { spawn } = await import("node:child_process");
  const cliUrl = new URL("../../src/adapters/inbound/cli/create-cli.ts", import.meta.url).href;
  const script = `import {createCli} from ${JSON.stringify(cliUrl)};
    const output={writeOut:s=>process.stdout.write(s),writeErr:s=>process.stderr.write(s)};
    await createCli(output,async()=>{await new Promise(r=>setTimeout(r,10100));output.writeOut('{"completed":1}\\n');}).parseAsync(['evaluation','--skills','private-selector'],{from:'user'});`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", b => { out += b; }); child.stderr.on("data", b => { err += b; });
  const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.on("error", reject); child.on("close", (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(result, { code: 0, signal: null });
  assert.deepEqual(JSON.parse(out), { completed: 1 });
  assert.match(err, /^\[agent-plugin\] evaluation: active; elapsed 10s\n$/);
});

test("quiet preserves command failures and interruption retains native signal semantics", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const quiet of ["-q", "--quiet"]) {
    let out = "", err = "";
    const failure = new Error("public operation failure");
    const cli = createCli({ writeOut: s => { out += s; }, writeErr: s => { err += s; } }, async () => { throw failure; });
    await assert.rejects(cli.parseAsync(["evaluation", "--skills", "skill", quiet], { from: "user" }), error => error === failure);
    t.mock.timers.tick(20_000);
    assert.equal(out, ""); assert.equal(err, "");
  }
  const { spawn } = await import("node:child_process");
  const cliUrl = new URL("../../src/adapters/inbound/cli/create-cli.ts", import.meta.url).href;
  const script = `import {createCli} from ${JSON.stringify(cliUrl)};
    await createCli({writeOut:()=>{},writeErr:s=>process.stderr.write(s)},async()=>{process.stdout.write('ready\\n');await new Promise(r=>setTimeout(r,60000));}).parseAsync(['evaluation','--skills','skill'],{from:'user'});`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", b => { err += b; });
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.on("error", reject); child.on("close", (code, signal) => resolve({ code, signal }));
  });
  child.stdout.once("data", () => child.kill("SIGTERM"));
  assert.deepEqual(await closed, { code: null, signal: "SIGTERM" });
  assert.equal(err, "");
});
