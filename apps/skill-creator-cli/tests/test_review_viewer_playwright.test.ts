import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReviewIR, generateHtml } from "../dist/eval-viewer/generate_review.js";
import { chromium } from "playwright-core";
import { systemChromiumExecutable } from "./browser-fixture.ts";

function fixture(decision?:"winner"|"regression"|"futility"|"continue"|"inconclusive") {
  const root = mkdtempSync(join(tmpdir(), "review-playwright-"));
  for (let index = 0; index < 30; index++) for (const config of ["with_skill", "old_skill"]) {
    const run = join(root, "eval-" + index, config, "run-1");
    mkdirSync(join(run, "outputs"), { recursive: true });
    writeFileSync(join(root, "eval-" + index, "eval_metadata.json"), JSON.stringify({ eval_id: "case-" + index, prompt: "Prompt " + index }));
    const candidate = config === "with_skill";
    writeFileSync(join(run, "grading.json"), JSON.stringify({ expectations: [{ text: "accessible behavior", passed: candidate, evidence: "evidence" }], summary: { passed: candidate ? 1 : 0, failed: candidate ? 0 : 1, total: 1, pass_rate: candidate ? 1 : 0 } }));
    writeFileSync(join(run, "timing.json"), JSON.stringify({ total_duration_seconds: 1, total_tokens: 10 }));
    writeFileSync(join(run, "outputs", "result.txt"), "output " + index);
  }
  const sequential=decision?{mode:'adaptive',method:'finite-horizon-fixed-weight-hoeffding-cs-v2',method_version:'1.0',policy_hash:'a'.repeat(64),decision,terminal:decision!=='continue',stop_reason:decision==='continue'?null:decision,looks:[{look:1,mean_difference:.2,confidence_sequence:{lower:.1,upper:.3,confidence:.95},decision}],sample_count:1,confidence_sequence:{lower:.1,upper:.3,confidence:.95},practical_superiority_delta:0,regression_tolerance:0,scenario_weights:[{id:'case-0',weight:1}],multiplicity_allocation:{winner_fraction:.5,regression_fraction:.5},counted_membership:[{scenario_id:'case-0',pair_index:1,candidate_run:'eval-0/with_skill/run-1',baseline_run:'eval-0/old_skill/run-1'}],superseded_count:2}:null;
  const benchmark = { ...(sequential?{final_receipt:true,decision_evidence:sequential}:{}),run_summary: { with_skill: { pass_rate: { mean: 1 }, time_seconds: { mean: 1 }, tokens: { mean: 10 } }, old_skill: { pass_rate: { mean: 0 }, time_seconds: { mean: 1 }, tokens: { mean: 10 } }, delta: { pass_rate: "+1.00", paired: { pass_rate: { mean: 1, stddev: 0, confidence_interval_95: { lower: .8, upper: 1 } } } } } };
  if(!decision)writeFileSync(join(root,"progress.json"),JSON.stringify({event:"run-complete",completed:1,total:60,active:2,queued:57,succeeded:1,failed:0,blocked:0,cache:{hits:0,misses:1,invalidated:0},retries:0,elapsed_seconds:1,throughput_per_second:1,duration_seconds:{p50:1,p95:1},eta:{lower_seconds:null,upper_seconds:null,confidence:null,unavailable_reason:"at least two completed run durations are required"}}));
  const path = join(root, "review.html");
  writeFileSync(path, generateHtml(buildReviewIR(root, "playwright review", benchmark)));
  return { root, path };
}

test("Playwright covers every sequential decision state and deep-linked evidence", async () => {const executablePath=systemChromiumExecutable(),browser=await chromium.launch({headless:true,executablePath});try{for(const state of ["winner","regression","futility","continue","inconclusive"] as const){const f=fixture(state);try{const page=await browser.newPage();await page.goto("file://"+f.path+"#sequential-title");await page.getByRole("heading",{name:"Sequential decision evidence"}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement?.id),"sequential-title");assert.match(await page.locator("#sequential-explanation").innerText(),new RegExp(state,"i"));await page.locator("#sequential-evidence details").click();assert.match(await page.locator("#counted-membership").innerText(),/case-0 pair 1/);await page.close();}finally{rmSync(f.root,{recursive:true,force:true});}}}finally{await browser.close();}});

test("Playwright verifies evaluation viewer accessibility and interactions", async () => {
  const executablePath = systemChromiumExecutable();
  const f = fixture();
  const browser = await chromium!.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("file://" + f.path);
    await page.getByRole("heading", { name: "Evaluation decision review" }).waitFor();
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(await page.locator("[role=status]").count() >= 1, true);
    assert.equal(await page.getByRole("progressbar").getAttribute("value"),"1");
    assert.match(await page.locator("#progress-status").innerText(),/1 of 60 complete/);
    assert.match(await page.locator("#verdict").innerText(),/Provisional/i);
    assert.match(await page.locator("#provisional-notice").innerText(),/not a final receipt/);
    assert.match(await page.locator('label[for="search"]').innerText(), /Search prompts/);
    await page.locator("#search").fill("Prompt 29");
    assert.match(await page.locator("#count").innerText(), /^1 of 1 matching/);
    await page.locator("#clear").click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "search");
    await page.locator("#more").click();
    assert.equal(await page.locator("#scenarios article").count() > 25, true);
    const disclosure = page.locator(".run summary").first();
    await disclosure.focus(); await page.keyboard.press("Space");
    assert.equal(await disclosure.evaluate(element => (element.parentElement as HTMLDetailsElement).open), true);
    assert.equal(await page.locator('#feedback, #save, #feedback-title').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); rmSync(f.root, { recursive: true, force: true }); }
});
