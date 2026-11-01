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
import { aggregateTriggerOutcomes } from "./trigger_evaluation.js";
import { parseSkillMd } from "./utils.js";

interface EvalItem {
  query: string;
  should_trigger: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function splitEvalSet(
  evalSet: EvalItem[],
  holdout: number,
  seed = 42
): [EvalItem[], EvalItem[]] {
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

interface LoopHistoryEntry {
  iteration: number;
  description: string;
  train_passed: number;
  train_failed: number;
  train_unavailable: number;
  train_total: number;
  train_results: any[];
  test_passed: number | null;
  test_failed: number | null;
  test_unavailable: number | null;
  test_total: number | null;
  test_results: any[] | null;
  passed: number;
  failed: number;
  unavailable: number;
  total: number;
  results: any[];
}

function selectBest(history: LoopHistoryEntry[], trainSize: number, testSize: number): LoopHistoryEntry | undefined {
  // A candidate needs all scheduled observations, not merely a nonzero score.
  const eligible = history.filter(h => trainSize > 0 && h.train_total === trainSize && h.train_unavailable === 0 &&
    (!testSize || (h.test_total === testSize && h.test_unavailable === 0)));
  return eligible.reduce<LoopHistoryEntry | undefined>((best, h) =>
    !best || (testSize ? (h.test_passed ?? 0) > (best.test_passed ?? 0) : h.train_passed > best.train_passed) ? h : best,
    undefined);
}

export async function runLoop(
  evalSet: EvalItem[],
  skillPath: string,
  descriptionOverride: string | undefined,
  numWorkers: number,
  timeoutMs: number,
  maxIterations: number,
  runsPerQuery: number,
  triggerThreshold: number,
  holdout: number,
  model: string,
  verbose: boolean,
  options: {
    liveReportPath?: string;
    logDir?: string;
    runner?: string;
  } = {}
) {
  const { liveReportPath, logDir, runner } = options;
  const { name, description: originalDescription, content } = parseSkillMd(skillPath);
  let currentDescription = descriptionOverride || originalDescription;

  // Keep occurrence identity: equal query text (even with equal labels) is not identity.
  const indexedSet = evalSet.map((item, index) => ({ ...item, index }));
  let trainSet: EvalItem[];
  let testSet: EvalItem[];
  if (holdout > 0) {
    [trainSet, testSet] = splitEvalSet(indexedSet, holdout);
    if (verbose) {
      console.error(`Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})`);
    }
  } else {
    trainSet = indexedSet;
    testSet = [];
  }

  const splitProvenance = {
    algorithm: holdout > 0 ? "stratified-mulberry32-fisher-yates-v1" : "input-order-no-holdout-v1",
    seed: holdout > 0 ? 42 : null,
    holdout,
    // This JS algorithm is not a claim of Python random.seed partition parity.
    train_indices: trainSet.map(item => (item as EvalItem & { index: number }).index),
    test_indices: testSet.map(item => (item as EvalItem & { index: number }).index),
    train_set: trainSet.map(({ query, should_trigger }) => ({ query, should_trigger })),
    test_set: testSet.map(({ query, should_trigger }) => ({ query, should_trigger })),
  };
  if (logDir) {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "split.json"), JSON.stringify(splitProvenance, null, 2));
  }
  const history: LoopHistoryEntry[] = [];
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

    // runEval returns one result per input occurrence, in input order.
    const trainResultList = allResults.results.slice(0, trainSet.length);
    const testResultList = allResults.results.slice(trainSet.length);

    const trainPassed = trainResultList.filter((r) => r.pass).length;
    const trainTotal = trainResultList.length;
    const trainSummary = { passed: trainPassed, failed: trainResultList.filter(r => r.pass === false).length, unavailable: trainResultList.filter(r => r.pass === null).length, total: trainTotal };

    let testSummary: { passed: number; failed: number; unavailable: number; total: number } | null = null;
    if (testSet.length) {
      const testPassed = testResultList.filter((r) => r.pass).length;
      const testTotal = testResultList.length;
      testSummary = { passed: testPassed, failed: testResultList.filter(r => r.pass === false).length, unavailable: testResultList.filter(r => r.pass === null).length, total: testTotal };
    }

    history.push({
      iteration,
      description: currentDescription,
      train_passed: trainSummary.passed,
      train_failed: trainSummary.failed,
      train_unavailable: trainSummary.unavailable,
      train_total: trainSummary.total,
      train_results: trainResultList,
      test_passed: testSummary ? testSummary.passed : null,
      test_failed: testSummary ? testSummary.failed : null,
      test_unavailable: testSummary ? testSummary.unavailable : null,
      test_total: testSummary ? testSummary.total : null,
      test_results: testSummary ? testResultList : null,
      passed: trainSummary.passed,
      failed: trainSummary.failed,
      unavailable: trainSummary.unavailable,
      total: trainSummary.total,
      results: trainResultList,
    });

    if (liveReportPath) {
      const bestSoFar = selectBest(history, trainSet.length, testSet.length);
      const partialOutput = {
        original_description: originalDescription,
        best_description: bestSoFar?.description ?? originalDescription,
        best_iteration: bestSoFar?.iteration ?? null,
        best_score: "in progress",
        split_provenance: splitProvenance,
        iterations_run: history.length,
        holdout,
        train_size: trainSet.length,
        test_size: testSet.length,
        history,
      };
      writeFileSync(liveReportPath, generateHtml(partialOutput, true, name));
    }

    if (verbose) {
      const printEvalStats = (label: string, results: any[], elapsed: number) => {
        const metrics = aggregateTriggerOutcomes(results.flatMap(r => r.outcomes.map((run: any) => ({should_trigger: r.should_trigger, run}))));
        const {true_positive: tp, true_negative: tn, false_positive: fp, false_negative: fn} = metrics.classification.confusion_matrix;
        const total = metrics.classification.eligible_runs;
        const precision = tp + fp > 0 ? tp / (tp + fp) : null;
        const recall = tp + fn > 0 ? tp / (tp + fn) : null;
        const accuracy = metrics.classification.accuracy;
        const percentage = (value: number | null) => value === null ? "unavailable" : `${(value * 100).toFixed(0)}%`;
        console.error(
          `${label}: ${tp + tn}/${total} correct, precision=${percentage(precision)} recall=${percentage(recall)} accuracy=${percentage(accuracy)} (${elapsed.toFixed(1)}s)`
        );
        for (const r of results) {
          const status = r.pass === null ? "UNAVAILABLE" : r.pass ? "PASS" : "FAIL";
          const rateStr = `${r.triggers}/${r.classification_runs}`;
          console.error(`  [${status}] rate=${rateStr} expected=${r.should_trigger}: ${r.query.slice(0, 60)}`);
        }
      };
      printEvalStats("Train", trainResultList, evalElapsed);
      if (testSummary) printEvalStats("Test ", testResultList, 0);
    }

    if (!trainSummary.total || trainSummary.unavailable || testSummary?.unavailable) {
      exitReason = `incomplete_evidence (iteration ${iteration})`;
      if (verbose) console.error("\nIncomplete activation evidence; preserve results and recover infrastructure before optimizing.");
      break;
    }

    if (trainSummary.failed === 0) {
      exitReason = `all_passed (iteration ${iteration})`;
      if (verbose) console.error(`\nAll train queries passed on iteration ${iteration}!`);
      break;
    }

    if (iteration === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`;
      if (verbose) console.error(`\nMax iterations reached (${maxIterations}).`);
      break;
    }

    if (verbose) console.error("\nImproving description...");

    const t1 = performance.now();
    // Allowlist the training view rather than relying on test_* name filtering.
    const blindedHistory = history.map(h => ({
      iteration: h.iteration,
      description: h.description,
      train_passed: h.train_passed,
      train_failed: h.train_failed,
      train_unavailable: h.train_unavailable,
      train_total: h.train_total,
      train_results: h.train_results,
      passed: h.train_passed,
      failed: h.train_failed,
      unavailable: h.train_unavailable,
      total: h.train_total,
      results: h.train_results,
    }));
    const newDescription = await improveDescription(
      name,
      content,
      currentDescription,
      { description: currentDescription, summary: trainSummary, results: trainResultList.flatMap(r => r.pass === null ? [] : [{...r, pass: r.pass}]) },
      blindedHistory,
      model,
      { logDir, iteration, runner }
    );
    const improveElapsed = (performance.now() - t1) / 1000;

    if (verbose) console.error(`Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}`);

    currentDescription = newDescription;
  }

  // Incomplete iterations are not candidates for an evidence-backed best score.
  const best = selectBest(history, trainSet.length, testSet.length);
  const bestScore = best ? (testSet.length ? `${best.test_passed}/${best.test_total}` : `${best.train_passed}/${best.train_total}`) : null;

  if (verbose) {
    console.error(`\nExit reason: ${exitReason}`);
    console.error(`Best score: ${bestScore} (iteration ${best?.iteration ?? "unavailable"})`);
  }

  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best?.description ?? originalDescription,
    best_score: bestScore,
    best_iteration: best?.iteration ?? null,
    split_provenance: splitProvenance,
    best_train_score: best ? `${best.train_passed}/${best.train_total}` : null,
    best_test_score: best && testSet.length ? `${best.test_passed}/${best.test_total}` : null,
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

  const evalSet = JSON.parse(readFileSync(resolve(values["eval-set"] as string), "utf-8"));
  const skillPath = resolve(values["skill-path"] as string);

  if (!existsSync(join(skillPath, "SKILL.md"))) {
    console.error(`Error: No SKILL.md found at ${skillPath}`);
    process.exit(1);
  }

  const { name } = parseSkillMd(skillPath);

  let liveReportPath: string | null = null;
  if (values.report !== "none") {
    if (values.report === "auto") {
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").split(".")[0];
      liveReportPath = join(tmpdir(), `skill_description_report_${basename(skillPath)}_${timestamp}.html`);
    } else {
      liveReportPath = resolve(values.report as string);
    }
    writeFileSync(
      liveReportPath,
      "<html><body><h1>Starting optimization loop...</h1><meta http-equiv='refresh' content='5'></body></html>"
    );
    try {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execFile(opener, [liveReportPath]);
    } catch {
      // best-effort
    }
  }

  let resultsDir: string | null = null;
  if (values["results-dir"]) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").split(".")[0];
    resultsDir = join(resolve(values["results-dir"] as string), timestamp);
    mkdirSync(resultsDir, { recursive: true });
  }
  const logDir = resultsDir ? join(resultsDir, "logs") : undefined;

  const output = await runLoop(
    evalSet,
    skillPath,
    values.description as string | undefined,
    Number(values["num-workers"]),
    Number(values.timeout) * 1000,
    Number(values["max-iterations"]),
    Number(values["runs-per-query"]),
    Number(values["trigger-threshold"]),
    Number(values.holdout),
    values.model as string,
    values.verbose as boolean,
    { liveReportPath: liveReportPath ?? undefined, logDir, runner: values.runner as string | undefined }
  );

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
