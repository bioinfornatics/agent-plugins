import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoop } from "../dist/scripts/run_loop.js";
import { generateHtml } from "../dist/scripts/generate_report.js";

// Private transport fixture: activation identity comes from the staged Skill,
// not the original name or a shared fixture. No provider is invoked.
async function withHost(fn: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "description-loop-"));
  const skill = join(root, "skill");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "---\nname: private-loop-skill\ndescription: Handles loop requests. Use when loop help is requested.\n---\n# Loop\n");
  const host = join(root, "host.mjs");
  writeFileSync(host, `import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2);
if(args.includes('--text')) {
 const directory=join(process.cwd(),'.agents','skills');
 const folder=readdirSync(directory)[0];
 const md=readFileSync(join(directory,folder,'SKILL.md'),'utf8');
 const name=/^name: (.+)$/m.exec(md)[1];
 const query=args[args.indexOf('--text')+1];
 if(query==='unavailable')process.exit(9);
 if(query==='duplicate'||query==='positive')console.log(JSON.stringify({type:'message',message:{content:[{type:'toolRequest',toolCall:{value:{name:'load_skill',arguments:{name}}}}]}}));
 console.log(JSON.stringify({type:'complete'}));
} else {
 let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
 console.log('<new_description>Handles revised loop requests. Use when revised loop help is requested.</new_description>');
}`);
  const keys = ["SKILL_CREATOR_GOOSE_COMMAND", "GOOSE_PROVIDER", "GOOSE_MODEL", "SKILL_CREATOR_RUNNER"];
  const previous = keys.map(key => process.env[key]);
  process.env.SKILL_CREATOR_GOOSE_COMMAND = JSON.stringify(process.execPath) + " " + JSON.stringify(host);
  process.env.GOOSE_PROVIDER = "ollama";
  process.env.GOOSE_MODEL = "private-mock-model";
  process.env.SKILL_CREATOR_RUNNER = "goose";
  try { await fn(root); } finally {
    keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
    rmSync(root, { recursive: true, force: true });
  }
}

// Independent expected counts: two copies of each label, one held out per label.
// Text membership would incorrectly put all four results in training.
test("duplicate queries stay in their ordered train/test partition with explicit provenance", async () => {
  await withHost(async root => {
    const input = [true, true, false, false].map(should_trigger => ({ query: "duplicate", should_trigger }));
    const logs = join(root, "logs");
    const output: any = await runLoop(input, join(root, "skill"), undefined, 2, 2000, 1, 1, .5, .5, "private-mock-model", false, { logDir: logs });
    const h = output.history[0];
    assert.deepEqual([h.train_total, h.test_total, h.train_passed, h.test_passed], [2, 2, 1, 1]);
    assert.deepEqual(h.train_results.map((r: any) => r.should_trigger), [true, false]);
    assert.deepEqual(h.test_results.map((r: any) => r.should_trigger), [true, false]);
    assert.equal(output.best_iteration, 1);
    assert.equal(output.best_score, "1/2");
    const split = output.split_provenance;
    assert.equal(split.algorithm, "stratified-mulberry32-fisher-yates-v1");
    assert.equal(split.seed, 42);
    assert.deepEqual(split.train_set, h.train_results.map(({query, should_trigger}: any) => ({query, should_trigger})));
    assert.deepEqual(split.test_set, h.test_results.map(({query, should_trigger}: any) => ({query, should_trigger})));
    assert.deepEqual([...split.train_indices, ...split.test_indices].sort(), [0, 1, 2, 3]);
    assert.deepEqual(JSON.parse(readFileSync(join(logs, "split.json"), "utf8")), split);
    assert.equal(readFileSync(join(root, "skill", "SKILL.md"), "utf8").includes("revised"), false);
  });
});

test("optimizer history and failure feedback are blinded to held-out queries", async () => {
  await withHost(async root => {
    const input = [0,1,2,3].map(i => ({query: `unique-heldout-marker-${i}`, should_trigger: true}));
    const logs = join(root, "logs");
    const output = await runLoop(input, join(root, "skill"), undefined, 1, 2000, 2, 1, .5, .5, "private-mock-model", false, {logDir: logs});
    assert.equal(output.iterations_run, 2);
    const prompt = JSON.parse(readFileSync(join(logs, "improve_iter_1.json"), "utf8")).prompt;
    for (const r of output.history[0].test_results!) assert.ok(!prompt.includes(r.query), `held-out query leaked: ${r.query}`);
    for (const r of output.history[0].train_results) assert.ok(prompt.includes(r.query));
    assert.doesNotMatch(prompt, /test=|Test:|test_passed|test_results/);
    assert.match(prompt, /PREVIOUS ATTEMPTS/);
  });
});

function result(query: string, pass: boolean | null, should_trigger = true) {
  return {query, pass, should_trigger, triggers: pass === null ? 0 : 1, runs: 2, classification_runs: pass === null ? 0 : 2};
}
function reportRow(html: string, iteration: number) {
  const rows = [...html.matchAll(/<tr class="([^"]*)">\s*<td>(\d+)<\/td>([\s\S]*?)<\/tr>/g)];
  const row = rows.find(row => Number(row[2]) === iteration);
  assert.ok(row, `missing row ${iteration}`);
  return {css: row[1], body: row[3]};
}

test("report marks null and missing observations unavailable and excludes incomplete best candidates", () => {
  const history = [
    {iteration: 1, description: "eligible", train_passed: 1, train_total: 2, train_unavailable: 0, test_passed: 1, test_total: 2, test_unavailable: 0, train_results: [result("duplicate", true), result("duplicate", false, false)], test_results: [result("heldout", true), result("other", false)]},
    {iteration: 2, description: "excluded", train_passed: 2, train_total: 2, train_unavailable: 0, test_passed: 2, test_total: 3, test_unavailable: 1, train_results: [result("duplicate", true), result("duplicate", true, false)], test_results: [result("heldout", null)]},
  ];
  const html = generateHtml({history, best_iteration: 1, best_score: "1/2", best_test_score: "1/2", best_description: "eligible", test_size: 2});
  assert.equal(reportRow(html, 1).css, "best-row");
  assert.equal(reportRow(html, 2).css, "");
  assert.match(reportRow(html, 2).body, /unavailable/i);
  assert.doesNotMatch(reportRow(html, 2).body, /0\/0|result test-result fail/);
  assert.match(reportRow(html, 1).body, /result pass/);
  assert.match(reportRow(html, 1).body, /result fail/); // same text, opposite label: no Map overwrite
  assert.doesNotMatch(html, /will apply the best-performing/);
  const incomplete = generateHtml({history: [history[1]], best_iteration: null, best_score: null, test_size: 2});
  assert.equal(reportRow(incomplete, 2).css, "");
  assert.match(incomplete, /Best Score:<\/strong> unavailable/i);
  // Legacy output without a selected iteration still excludes incomplete rows.
  assert.equal(reportRow(generateHtml({history, test_size: 2}), 2).css, "");
});

test("ordinary complete evidence remains selected and renders success/failure without unavailable scores", async () => {
  await withHost(async root => {
    const output: any = await runLoop([{query: "positive", should_trigger: true}, {query: "negative", should_trigger: false}], join(root, "skill"), undefined, 1, 2000, 2, 1, .5, 0, "private-mock-model", false);
    assert.equal(output.exit_reason, "all_passed (iteration 1)");
    assert.equal(output.best_score, "2/2");
    assert.equal(output.best_iteration, 1);
    const row = reportRow(generateHtml(output), 1);
    assert.equal(row.css, "best-row");
    assert.match(row.body, /2\/2/);
    assert.equal((row.body.match(/result pass/g) ?? []).length, 2);
    assert.doesNotMatch(row.body, /result fail/);
  });
});

// Missingness is an independent observable, not just a side effect of best ranking.
test("report preserves scheduled columns for null and entirely missing observations", () => {
  const h = {iteration: 1, train_passed: 0, train_total: 2, train_unavailable: 2,
    train_results: [result("null-query", null)], test_total: null, test_results: null};
  const html = generateHtml({history: [h], best_iteration: null, best_score: null,
    train_size: 2, test_size: 0, split_provenance: {train_set: [
      {query: "null-query", should_trigger: true}, {query: "missing-query", should_trigger: false}
    ], test_set: []}});
  const row = reportRow(html, 1);
  assert.equal((row.body.match(/class="result unavailable"/g) ?? []).length, 2);
  assert.equal(row.css, "");
  assert.match(html, /missing-query/);
  assert.doesNotMatch(row.body, /result fail|0\/0|0\/2/);
  assert.match(row.body, /score unavailable/);
});
