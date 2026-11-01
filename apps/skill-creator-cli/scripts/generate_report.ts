#!/usr/bin/env node
// Generate an HTML report from run_loop.js output.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface QueryResult {
  query: string;
  should_trigger?: boolean;
  pass?: boolean | null;
  triggers?: number;
  runs?: number;
  classification_runs?: number;
}

interface HistoryEntry {
  iteration?: number | string;
  train_passed?: number;
  train_total?: number;
  passed?: number;
  total?: number;
  train_unavailable?: number;
  unavailable?: number;
  test_unavailable?: number | null;
  test_passed?: number | null;
  test_total?: number | null;
  description?: string;
  train_results?: QueryResult[];
  results?: QueryResult[];
  test_results?: QueryResult[] | null;
}

export function generateHtml(data: any, autoRefresh = false, skillName = ""): string {
  const history: HistoryEntry[] = data.history ?? [];
  const titlePrefix = skillName ? escapeHtml(`${skillName} — `) : "";
  const refreshTag = autoRefresh ? '    <meta http-equiv="refresh" content="5">\n' : "";

  // Prefer the persisted scheduled partition so missing first-iteration results
  // do not erase query columns. Older reports fall back to observed results.
  const trainQueries: Array<{ query: string; should_trigger: boolean }> =
    data.split_provenance?.train_set ?? (history[0]?.train_results ?? history[0]?.results ?? [])
      .map(r => ({ query: r.query, should_trigger: r.should_trigger ?? true }));
  const testQueries: Array<{ query: string; should_trigger: boolean }> =
    data.split_provenance?.test_set ?? (history[0]?.test_results ?? [])
      .map(r => ({ query: r.query, should_trigger: r.should_trigger ?? true }));
  const hasTest = (data.test_size ?? testQueries.length) > 0;

  const htmlParts: string[] = [
    `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
${refreshTag}    <title>${titlePrefix}Skill Description Optimization</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Lora:wght@400;500&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Lora', Georgia, serif;
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: #faf9f5;
            color: #141413;
        }
        h1 { font-family: 'Poppins', sans-serif; color: #141413; }
        .explainer {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
            color: #b0aea5;
            font-size: 0.875rem;
            line-height: 1.6;
        }
        .summary {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
        }
        .summary p { margin: 5px 0; }
        .best { color: #788c5d; font-weight: bold; }
        .table-container {
            overflow-x: auto;
            width: 100%;
        }
        table {
            border-collapse: collapse;
            background: white;
            border: 1px solid #e8e6dc;
            border-radius: 6px;
            font-size: 12px;
            min-width: 100%;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid #e8e6dc;
            white-space: normal;
            word-wrap: break-word;
        }
        th {
            font-family: 'Poppins', sans-serif;
            background: #141413;
            color: #faf9f5;
            font-weight: 500;
        }
        th.test-col {
            background: #6a9bcc;
        }
        th.query-col { min-width: 200px; }
        td.description {
            font-family: monospace;
            font-size: 11px;
            word-wrap: break-word;
            max-width: 400px;
        }
        td.result {
            text-align: center;
            font-size: 16px;
            min-width: 40px;
        }
        td.test-result {
            background: #f0f6fc;
        }
        .pass { color: #788c5d; }
        .fail { color: #c44; }
        .unavailable { color: #76746c; }
        .rate {
            font-size: 9px;
            color: #b0aea5;
            display: block;
        }
        tr:hover { background: #faf9f5; }
        .score {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
        }
        .score-good { background: #eef2e8; color: #788c5d; }
        .score-ok { background: #fef3c7; color: #d97706; }
        .score-bad { background: #fceaea; color: #c44; }
        .train-label { color: #b0aea5; font-size: 10px; }
        .test-label { color: #6a9bcc; font-size: 10px; font-weight: bold; }
        .best-row { background: #f5f8f2; }
        th.positive-col { border-bottom: 3px solid #788c5d; }
        th.negative-col { border-bottom: 3px solid #c44; }
        th.test-col.positive-col { border-bottom: 3px solid #788c5d; }
        th.test-col.negative-col { border-bottom: 3px solid #c44; }
        .legend { font-family: 'Poppins', sans-serif; display: flex; gap: 20px; margin-bottom: 10px; font-size: 13px; align-items: center; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: #141413; border-bottom: 3px solid #788c5d; }
        .swatch-negative { background: #141413; border-bottom: 3px solid #c44; }
        .swatch-test { background: #6a9bcc; }
        .swatch-train { background: #141413; }
    </style>
</head>
<body>
    <h1>${titlePrefix}Skill Description Optimization</h1>
    <div class="explainer">
        <strong>Optimizing your skill's description.</strong> This page updates automatically as the configured agent tests different versions of your skill's description. Each row is an iteration — a new description attempt. The columns show test queries: green checkmarks mean the skill triggered correctly (or correctly didn't trigger), red crosses mean it got it wrong. The "Train" score shows performance on queries used to improve the description; the "Test" score shows performance on held-out queries the optimizer hasn't seen. Unavailable or missing observations are not failures and cannot establish a best candidate. The selected description is a recommendation for review; this loop does not modify your skill.
    </div>
`,
  ];

  htmlParts.push(`
    <div class="summary">
        <p><strong>Original:</strong> ${escapeHtml(data.original_description ?? "N/A")}</p>
        <p class="best"><strong>Best:</strong> ${escapeHtml(data.best_description ?? "N/A")}</p>
        <p><strong>Best Score:</strong> ${escapeHtml(String(data.best_score ?? "unavailable"))} ${hasTest ? "(test)" : "(train)"}</p>
        <p><strong>Iterations:</strong> ${data.iterations_run ?? 0} | <strong>Train:</strong> ${data.train_size ?? "?"} | <strong>Test:</strong> ${data.test_size ?? "?"}</p>
    </div>
`);

  htmlParts.push(`
    <div class="legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="legend-item"><span class="legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-train"></span> Train</span>
        <span class="legend-item"><span class="legend-swatch swatch-test"></span> Test</span>
    </div>
`);

  htmlParts.push(`
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
`);

  for (const qinfo of trainQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    htmlParts.push(`                <th class="${polarity}">${escapeHtml(qinfo.query)}</th>\n`);
  }
  for (const qinfo of testQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    htmlParts.push(`                <th class="test-col ${polarity}">${escapeHtml(qinfo.query)}</th>\n`);
  }

  htmlParts.push(`            </tr>
        </thead>
        <tbody>
`);

  function complete(results: QueryResult[], total: number | null | undefined, unavailable: number | null | undefined): boolean {
    return typeof total === "number" && total > 0 && results.length === total &&
      (unavailable === undefined || unavailable === 0) && results.every(r => typeof r.pass === "boolean");
  }
  const eligible = history.filter(h =>
    (data.train_size === undefined || (h.train_total ?? h.total) === data.train_size) &&
    complete(h.train_results ?? h.results ?? [], h.train_total ?? h.total, h.train_unavailable ?? h.unavailable) &&
    (!hasTest || ((data.test_size === undefined || h.test_total === data.test_size) &&
      complete(h.test_results ?? [], h.test_total, h.test_unavailable))));
  // New loop outputs name the selected iteration. Old outputs use the same
  // complete-evidence eligibility, query-pass ranking and first-tie policy.
  const selected = Object.hasOwn(data, "best_iteration")
    ? eligible.find(h => h.iteration === data.best_iteration)
    : eligible.reduce<HistoryEntry | undefined>((best, h) =>
      !best || (hasTest ? (h.test_passed ?? 0) > (best.test_passed ?? 0)
        : (h.train_passed ?? h.passed ?? 0) > (best.train_passed ?? best.passed ?? 0)) ? h : best, undefined);
  const bestIter = selected?.iteration;

  function score(results: QueryResult[], passed: number | null | undefined, total: number | null | undefined, unavailable: number | null | undefined): [number, number] | null {
    if (!complete(results, total, unavailable)) return null;
    return [passed ?? results.filter(r => r.pass === true).length, total!];
  }

  function scoreClass(correct: number, total: number): string {
    if (total > 0) {
      const ratio = correct / total;
      if (ratio >= 0.8) return "score-good";
      if (ratio >= 0.5) return "score-ok";
    }
    return "score-bad";
  }

  for (const h of history) {
    const iteration = h.iteration ?? "?";
    const trainResults = h.train_results ?? h.results ?? [];
    const testResults = h.test_results ?? [];

    const trainScore = score(trainResults, h.train_passed ?? h.passed, h.train_total ?? h.total, h.train_unavailable ?? h.unavailable);
    const testScore = score(testResults, h.test_passed, h.test_total, h.test_unavailable);
    const scoreCell = (value: [number, number] | null) => value
      ? `<span class="score ${scoreClass(...value)}">${value[0]}/${value[1]}</span>`
      : '<span class="score unavailable">unavailable</span>';
    const rowClass = bestIter !== undefined && iteration === bestIter ? "best-row" : "";

    htmlParts.push(`            <tr class="${rowClass}">
                <td>${iteration}</td>
                <td>${scoreCell(trainScore)}</td>
                <td>${hasTest ? scoreCell(testScore) : "not evaluated"}</td>
                <td class="description">${escapeHtml(h.description ?? "")}</td>
`);

    function queryCell(r: QueryResult | undefined, isTest: boolean): string {
      const available = typeof r?.pass === "boolean";
      const cssClass = available ? (r?.pass ? "pass" : "fail") : "unavailable";
      const icon = available ? (r?.pass ? "✓" : "✗") : "—";
      const runs = r?.classification_runs ?? r?.runs;
      const rate = available && typeof runs === "number" && runs > 0 && typeof r?.triggers === "number"
        ? `${r.triggers}/${runs}` : "unavailable";
      return `                <td class="result ${isTest ? "test-result " : ""}${cssClass}">${icon}<span class="rate">${rate}</span></td>\n`;
    }
    // The result arrays preserve ordered occurrences, including duplicate text
    // and opposite labels. Never key result cells by query text alone.
    trainQueries.forEach((q, index) => {
      const r = trainResults[index];
      htmlParts.push(queryCell(r?.query === q.query && (r.should_trigger ?? true) === q.should_trigger ? r : undefined, false));
    });
    testQueries.forEach((q, index) => {
      const r = testResults[index];
      htmlParts.push(queryCell(r?.query === q.query && (r.should_trigger ?? true) === q.should_trigger ? r : undefined, true));
    });

    htmlParts.push("            </tr>\n");
  }

  htmlParts.push(`        </tbody>
    </table>
    </div>
`);
  htmlParts.push(`
</body>
</html>
`);

  return htmlParts.join("");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      "skill-name": { type: "string", default: "" },
    },
  });

  const [input] = positionals;
  if (!input) {
    console.error("usage: generate_report.js <input.json|-> [-o <output.html>] [--skill-name <name>]");
    process.exit(2);
  }

  const raw = input === "-" ? await readStdin() : readFileSync(resolve(input), "utf-8");
  const data = JSON.parse(raw);

  const htmlOutput = generateHtml(data, false, values["skill-name"] as string);

  if (values.output) {
    writeFileSync(resolve(values.output as string), htmlOutput);
    console.error(`Report written to ${values.output}`);
  } else {
    console.log(htmlOutput);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
