#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { createRunner, RunnerError } from "./runners/index.js";
import { parseSkillMd } from "./utils.js";
import { aggregateTriggerOutcomes, initialTelemetry, makeTriggerOutcome, observeTriggerTelemetry } from "./trigger_evaluation.js";
const MAX_STREAM_BYTES = 1024 * 1024, MAX_LINE_BYTES = 256 * 1024, MAX_EVENTS = 10000;
function copySkill(skillPath, root) { const { name } = parseSkillMd(skillPath), target = join(root, ".agents", "skills", name); mkdirSync(join(root, ".agents", "skills"), { recursive: true }); cpSync(skillPath, target, { recursive: true, filter: s => !s.includes("__pycache__") && !s.endsWith(".pyc") }); return { name }; }
export async function runSingleQuery(query, skillPath, timeoutMs, model, runner) { const tmp = mkdtempSync(join(tmpdir(), "skill-trigger-eval-")), started = performance.now(), telemetry = initialTelemetry(); try {
    const { name } = copySkill(resolve(skillPath), tmp), adapter = createRunner(runner), child = adapter.startStream(query, model ?? null, tmp);
    return await new Promise(done => { let buffer = "", settled = false, bytes = 0, events = 0; const finish = (kind, triggerMs) => { if (settled)
        return; settled = true; clearTimeout(timer); child.kill(); done(makeTriggerOutcome(kind, started, telemetry, triggerMs)); }, timer = setTimeout(() => finish("timeout"), timeoutMs), line = (raw) => { if (settled || !raw.trim())
        return; if (Buffer.byteLength(raw) > MAX_LINE_BYTES)
        return finish("malformed-stream"); let parsed; try {
        parsed = JSON.parse(raw);
    }
    catch {
        return finish("malformed-stream");
    } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || ++events > MAX_EVENTS)
        return finish("malformed-stream"); const event = parsed; observeTriggerTelemetry(event, telemetry); if (event.type === "error")
        return finish("host-failure"); let decision; try {
        decision = adapter.eventLoadedSkill(event, name);
    }
    catch {
        return finish("malformed-stream");
    } if (decision !== null)
        finish(decision ? "triggered" : "not-triggered", decision ? performance.now() : undefined); }; child.stdout.on("data", (chunk) => { if (settled)
        return; bytes += chunk.byteLength; if (bytes > MAX_STREAM_BYTES)
        return finish("malformed-stream"); buffer += chunk.toString("utf8"); let i = -1; while (!settled && (i = buffer.indexOf("\n")) !== -1) {
        const value = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        line(value);
    } }); child.on("error", () => finish("host-failure")); child.on("close", code => { if (settled)
        return; if (buffer.trim())
        line(buffer); if (!settled)
        finish(code === 0 ? "unsupported-telemetry" : "host-failure"); }); });
}
finally {
    rmSync(tmp, { recursive: true, force: true });
} }
async function mapLimit(items, limit, fn) { const results = new Array(items.length); let index = 0; async function worker() { while (index < items.length) {
    const current = index++;
    results[current] = await fn(items[current]);
} } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)); return results; }
function stageDescription(skillPath, description, original, tmp) { const staged = join(tmp, basename(skillPath)); cpSync(skillPath, staged, { recursive: true, filter: s => !s.includes("__pycache__") && !s.endsWith(".pyc") }); if (description === original)
    return staged; const md = join(staged, "SKILL.md"), lines = readFileSync(md, "utf8").split("\n"); let end = -1; for (let i = 1; i < lines.length; i++)
    if (lines[i].trim() === "---") {
        end = i;
        break;
    } if (end < 0)
    throw new Error("Could not locate the SKILL.md frontmatter"); let index = -1; for (let i = 1; i < end; i++)
    if (lines[i].startsWith("description:")) {
        index = i;
        break;
    } if (index < 0)
    throw new Error("Could not locate the SKILL.md description for evaluation"); let descriptionEnd = index + 1, value = lines[index].split(":").slice(1).join(":").trim(); if ([">", "|", ">-", "|-"].includes(value))
    while (descriptionEnd < end && (lines[descriptionEnd].startsWith("  ") || lines[descriptionEnd].startsWith("\t")))
        descriptionEnd++; lines.splice(index, descriptionEnd - index, "description: '" + description.replace(/'/g, "''") + "'"); writeFileSync(md, lines.join("\n")); return staged; }
export async function runEval(evalSet, skillPath, numWorkers, timeoutMs, options = {}) { const { runsPerQuery = 1, triggerThreshold = .5, model, runner, description: override } = options, { name, description: original } = parseSkillMd(skillPath), description = override || original, tmp = mkdtempSync(join(tmpdir(), "skill-description-")); try {
    const staged = stageDescription(skillPath, description, original, tmp), jobs = evalSet.flatMap((item, itemIndex) => Array.from({ length: runsPerQuery }, () => ({ item, itemIndex }))), runs = await mapLimit(jobs, numWorkers, async (job) => ({ ...job, run: await runSingleQuery(job.item.query, staged, timeoutMs, model, runner) }));
    const results = evalSet.map((item, itemIndex) => { const outcomes = runs.filter(x => x.itemIndex === itemIndex).map(x => x.run), classified = outcomes.filter(x => x.classification !== null), triggers = classified.filter(x => x.classification === true).length, rate = classified.length ? triggers / classified.length : 0, pass = classified.length > 0 && (item.should_trigger ? rate >= triggerThreshold : rate < triggerThreshold); return { query: item.query, should_trigger: item.should_trigger, trigger_rate: rate, triggers, runs: outcomes.length, pass, classification_runs: classified.length, infrastructure_failures: outcomes.length - classified.length, outcomes }; }), passed = results.filter(x => x.pass).length, records = results.flatMap(r => r.outcomes.map(run => ({ should_trigger: r.should_trigger, run })));
    return { schema_version: "2.0", skill_name: name, description, results, summary: { total: results.length, passed, failed: results.length - passed }, metrics: aggregateTriggerOutcomes(records) };
}
finally {
    rmSync(tmp, { recursive: true, force: true });
} }
export async function main() { const { values } = parseArgs({ args: process.argv.slice(2), options: { "eval-set": { type: "string" }, "skill-path": { type: "string" }, description: { type: "string" }, "num-workers": { type: "string", default: "4" }, timeout: { type: "string", default: "60" }, "runs-per-query": { type: "string", default: "3" }, "trigger-threshold": { type: "string", default: "0.5" }, model: { type: "string" }, runner: { type: "string" }, verbose: { type: "boolean", default: false } } }); if (!values["eval-set"] || !values["skill-path"]) {
    console.error("usage: run_eval.js --eval-set <file> --skill-path <dir> [options]");
    process.exit(2);
} const evalSet = JSON.parse(readFileSync(resolve(values["eval-set"]), "utf8")), skillPath = resolve(values["skill-path"]); if (!existsSync(join(skillPath, "SKILL.md"))) {
    console.error("error: No SKILL.md found at " + skillPath);
    process.exit(2);
} try {
    const output = await runEval(evalSet, skillPath, Number(values["num-workers"]), Number(values.timeout) * 1000, { description: values.description, runsPerQuery: Number(values["runs-per-query"]), triggerThreshold: Number(values["trigger-threshold"]), model: values.model, runner: values.runner });
    if (values.verbose) {
        console.error("Results: " + output.summary.passed + "/" + output.summary.total + " passed");
        for (const result of output.results)
            console.error("  [" + (result.pass ? "PASS" : "FAIL") + "] rate=" + result.triggers + "/" + result.classification_runs + " expected=" + result.should_trigger + ": " + result.query.slice(0, 70));
    }
    console.log(JSON.stringify(output, null, 2));
}
catch (error) {
    console.error("error: " + error.message);
    process.exit(error instanceof RunnerError ? 2 : 1);
} }
if (!import.meta.url.includes("/$bunfs/") && import.meta.url === "file://" + process.argv[1])
    main().catch(error => { console.error(error?.message ?? error); process.exit(1); });
