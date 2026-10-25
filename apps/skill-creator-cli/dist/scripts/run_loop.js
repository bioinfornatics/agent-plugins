#!/usr/bin/env node
// Run the eval + improve loop until all pass or max iterations reached.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";
import { generateHtml } from "./generate_report.js";
import { improveDescription } from "./improve_description.js";
import { runEval } from "./run_eval.js";
import { parseSkillMd } from "./utils.js";
function mulberry32(seed) {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffle(arr, rng) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
export function splitEvalSet(evalSet, holdout, seed = 42) {
    const rng = mulberry32(seed);
    const trigger = evalSet.filter((e) => e.should_trigger);
    const noTrigger = evalSet.filter((e) => !e.should_trigger);
    const shuffledTrigger = shuffle(trigger, rng);
    const shuffledNoTrigger = shuffle(noTrigger, rng);
    const nTriggerTest = Math.max(1, Math.floor(shuffledTrigger.length * holdout));
    const nNoTriggerTest = Math.max(1, Math.floor(shuffledNoTrigger.length * holdout));
    const testSet = [...shuffledTrigger.slice(0, nTriggerTest), ...shuffledNoTrigger.slice(0, nNoTriggerTest)];
    const trainSet = [...shuffledTrigger.slice(nTriggerTest), ...shuffledNoTrigger.slice(nNoTriggerTest)];
    return [trainSet, testSet];
}
export async function runLoop(evalSet, skillPath, descriptionOverride, numWorkers, timeoutMs, maxIterations, runsPerQuery, triggerThreshold, holdout, model, verbose, options = {}) {
    const { liveReportPath, logDir, runner } = options;
    const { name, description: originalDescription, content } = parseSkillMd(skillPath);
    let currentDescription = descriptionOverride || originalDescription;
    let trainSet;
    let testSet;
    if (holdout > 0) {
        [trainSet, testSet] = splitEvalSet(evalSet, holdout);
        if (verbose) {
            console.error(`Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})`);
        }
    }
    else {
        trainSet = evalSet;
        testSet = [];
    }
    const history = [];
    let exitReason = "unknown";
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        if (verbose) {
            console.error(`\n${"=".repeat(60)}`);
            console.error(`Iteration ${iteration}/${maxIterations}`);
            console.error(`Description: ${currentDescription}`);
            console.error("=".repeat(60));
        }
        const allQueries = [...trainSet, ...testSet];
        const t0 = performance.now();
        const allResults = await runEval(allQueries, skillPath, numWorkers, timeoutMs, {
            description: currentDescription,
            runsPerQuery,
            triggerThreshold,
            model,
            runner,
        });
        const evalElapsed = (performance.now() - t0) / 1000;
        const trainQueriesSet = new Set(trainSet.map((q) => q.query));
        const trainResultList = allResults.results.filter((r) => trainQueriesSet.has(r.query));
        const testResultList = allResults.results.filter((r) => !trainQueriesSet.has(r.query));
        const trainPassed = trainResultList.filter((r) => r.pass).length;
        const trainTotal = trainResultList.length;
        const trainSummary = { passed: trainPassed, failed: trainTotal - trainPassed, total: trainTotal };
        let testSummary = null;
        if (testSet.length) {
            const testPassed = testResultList.filter((r) => r.pass).length;
            const testTotal = testResultList.length;
            testSummary = { passed: testPassed, failed: testTotal - testPassed, total: testTotal };
        }
        history.push({
            iteration,
            description: currentDescription,
            train_passed: trainSummary.passed,
            train_failed: trainSummary.failed,
            train_total: trainSummary.total,
            train_results: trainResultList,
            test_passed: testSummary ? testSummary.passed : null,
            test_failed: testSummary ? testSummary.failed : null,
            test_total: testSummary ? testSummary.total : null,
            test_results: testSummary ? testResultList : null,
            passed: trainSummary.passed,
            failed: trainSummary.failed,
            total: trainSummary.total,
            results: trainResultList,
        });
        if (liveReportPath) {
            const partialOutput = {
                original_description: originalDescription,
                best_description: currentDescription,
                best_score: "in progress",
                iterations_run: history.length,
                holdout,
                train_size: trainSet.length,
                test_size: testSet.length,
                history,
            };
            writeFileSync(liveReportPath, generateHtml(partialOutput, true, name));
        }
        if (verbose) {
            const printEvalStats = (label, results, elapsed) => {
                const pos = results.filter((r) => r.should_trigger);
                const neg = results.filter((r) => !r.should_trigger);
                const tp = pos.reduce((a, r) => a + r.triggers, 0);
                const posRuns = pos.reduce((a, r) => a + r.runs, 0);
                const fn = posRuns - tp;
                const fp = neg.reduce((a, r) => a + r.triggers, 0);
                const negRuns = neg.reduce((a, r) => a + r.runs, 0);
                const tn = negRuns - fp;
                const total = tp + tn + fp + fn;
                const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
                const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
                const accuracy = total > 0 ? (tp + tn) / total : 0.0;
                console.error(`${label}: ${tp + tn}/${total} correct, precision=${(precision * 100).toFixed(0)}% recall=${(recall * 100).toFixed(0)}% accuracy=${(accuracy * 100).toFixed(0)}% (${elapsed.toFixed(1)}s)`);
                for (const r of results) {
                    const status = r.pass ? "PASS" : "FAIL";
                    const rateStr = `${r.triggers}/${r.runs}`;
                    console.error(`  [${status}] rate=${rateStr} expected=${r.should_trigger}: ${r.query.slice(0, 60)}`);
                }
            };
            printEvalStats("Train", trainResultList, evalElapsed);
            if (testSummary)
                printEvalStats("Test ", testResultList, 0);
        }
        if (trainSummary.failed === 0) {
            exitReason = `all_passed (iteration ${iteration})`;
            if (verbose)
                console.error(`\nAll train queries passed on iteration ${iteration}!`);
            break;
        }
        if (iteration === maxIterations) {
            exitReason = `max_iterations (${maxIterations})`;
            if (verbose)
                console.error(`\nMax iterations reached (${maxIterations}).`);
            break;
        }
        if (verbose)
            console.error("\nImproving description...");
        const t1 = performance.now();
        const blindedHistory = history.map((h) => {
            const copy = {};
            for (const [k, v] of Object.entries(h)) {
                if (!k.startsWith("test_"))
                    copy[k] = v;
            }
            return copy;
        });
        const newDescription = await improveDescription(name, content, currentDescription, { description: currentDescription, summary: trainSummary, results: trainResultList }, blindedHistory, model, { logDir, iteration, runner });
        const improveElapsed = (performance.now() - t1) / 1000;
        if (verbose)
            console.error(`Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}`);
        currentDescription = newDescription;
    }
    let best;
    let bestScore;
    if (testSet.length) {
        best = history.reduce((a, b) => ((b.test_passed ?? 0) > (a.test_passed ?? 0) ? b : a), history[0]);
        bestScore = `${best.test_passed}/${best.test_total}`;
    }
    else {
        best = history.reduce((a, b) => (b.train_passed > a.train_passed ? b : a), history[0]);
        bestScore = `${best.train_passed}/${best.train_total}`;
    }
    if (verbose) {
        console.error(`\nExit reason: ${exitReason}`);
        console.error(`Best score: ${bestScore} (iteration ${best.iteration})`);
    }
    return {
        exit_reason: exitReason,
        original_description: originalDescription,
        best_description: best.description,
        best_score: bestScore,
        best_train_score: `${best.train_passed}/${best.train_total}`,
        best_test_score: testSet.length ? `${best.test_passed}/${best.test_total}` : null,
        final_description: currentDescription,
        iterations_run: history.length,
        holdout,
        train_size: trainSet.length,
        test_size: testSet.length,
        history,
    };
}
async function main() {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            "eval-set": { type: "string" },
            "skill-path": { type: "string" },
            description: { type: "string" },
            "num-workers": { type: "string", default: "10" },
            timeout: { type: "string", default: "30" },
            "max-iterations": { type: "string", default: "5" },
            "runs-per-query": { type: "string", default: "3" },
            "trigger-threshold": { type: "string", default: "0.5" },
            holdout: { type: "string", default: "0.4" },
            model: { type: "string" },
            runner: { type: "string" },
            verbose: { type: "boolean", default: false },
            report: { type: "string", default: "auto" },
            "results-dir": { type: "string" },
        },
    });
    if (!values["eval-set"] || !values["skill-path"] || !values.model) {
        console.error("usage: run_loop.js --eval-set <file> --skill-path <dir> --model <name> [options]");
        process.exit(2);
    }
    const evalSet = JSON.parse(readFileSync(resolve(values["eval-set"]), "utf-8"));
    const skillPath = resolve(values["skill-path"]);
    if (!existsSync(join(skillPath, "SKILL.md"))) {
        console.error(`Error: No SKILL.md found at ${skillPath}`);
        process.exit(1);
    }
    const { name } = parseSkillMd(skillPath);
    let liveReportPath = null;
    if (values.report !== "none") {
        if (values.report === "auto") {
            const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").split(".")[0];
            liveReportPath = join(tmpdir(), `skill_description_report_${basename(skillPath)}_${timestamp}.html`);
        }
        else {
            liveReportPath = resolve(values.report);
        }
        writeFileSync(liveReportPath, "<html><body><h1>Starting optimization loop...</h1><meta http-equiv='refresh' content='5'></body></html>");
        try {
            const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
            execFile(opener, [liveReportPath]);
        }
        catch {
            // best-effort
        }
    }
    let resultsDir = null;
    if (values["results-dir"]) {
        const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").split(".")[0];
        resultsDir = join(resolve(values["results-dir"]), timestamp);
        mkdirSync(resultsDir, { recursive: true });
    }
    const logDir = resultsDir ? join(resultsDir, "logs") : undefined;
    const output = await runLoop(evalSet, skillPath, values.description, Number(values["num-workers"]), Number(values.timeout) * 1000, Number(values["max-iterations"]), Number(values["runs-per-query"]), Number(values["trigger-threshold"]), Number(values.holdout), values.model, values.verbose, { liveReportPath: liveReportPath ?? undefined, logDir, runner: values.runner });
    const jsonOutput = JSON.stringify(output, null, 2);
    console.log(jsonOutput);
    if (resultsDir) {
        writeFileSync(join(resultsDir, "results.json"), jsonOutput);
    }
    if (liveReportPath) {
        writeFileSync(liveReportPath, generateHtml(output, false, name));
        console.error(`\nReport: ${liveReportPath}`);
    }
    if (resultsDir && liveReportPath) {
        writeFileSync(join(resultsDir, "report.html"), generateHtml(output, false, name));
    }
    if (resultsDir) {
        console.error(`Results saved to: ${resultsDir}`);
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error?.message ?? error);
        process.exit(1);
    });
}
