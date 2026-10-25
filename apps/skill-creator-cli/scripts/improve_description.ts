#!/usr/bin/env node
// Improve a skill description with a configurable agent CLI.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createRunner } from "./runners/index.js";
import { parseSkillMd } from "./utils.js";

interface EvalResult {
  should_trigger: boolean;
  pass: boolean;
  query: string;
  triggers: number;
  runs: number;
}

interface EvalResults {
  description: string;
  summary: { passed: number; failed: number; total: number };
  results: EvalResult[];
}

interface HistoryEntry {
  description: string;
  train_passed?: number;
  train_total?: number;
  test_passed?: number;
  test_total?: number;
  passed?: number;
  total?: number;
  results?: EvalResult[];
  note?: string;
}

export async function improveDescription(
  skillName: string,
  skillContent: string,
  currentDescription: string,
  evalResults: EvalResults,
  history: HistoryEntry[],
  model: string,
  options: {
    testResults?: { summary: { passed: number; total: number } };
    logDir?: string;
    iteration?: number;
    runner?: string;
  } = {}
): Promise<string> {
  const { testResults, logDir, iteration, runner } = options;
  const failedTriggers = evalResults.results.filter((r) => r.should_trigger && !r.pass);
  const falseTriggers = evalResults.results.filter((r) => !r.should_trigger && !r.pass);

  const trainScore = `${evalResults.summary.passed}/${evalResults.summary.total}`;
  const scoresSummary = testResults
    ? `Train: ${trainScore}, Test: ${testResults.summary.passed}/${testResults.summary.total}`
    : `Train: ${trainScore}`;

  let prompt = `You are optimizing a portable Agent Skill description for a skill called "${skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there is a title and description that the agent sees when deciding whether to use the skill, and then if the agent uses the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in the compatible agent's available-skills metadata. When a user sends a query, the agent decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${currentDescription}"
</current_description>

Current scores (${scoresSummary}):
<scores_summary>
`;

  if (failedTriggers.length) {
    prompt += "FAILED TO TRIGGER (should have triggered but didn't):\n";
    for (const r of failedTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)\n`;
    }
    prompt += "\n";
  }

  if (falseTriggers.length) {
    prompt += "FALSE TRIGGERS (triggered but shouldn't have):\n";
    for (const r of falseTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)\n`;
    }
    prompt += "\n";
  }

  if (history.length) {
    prompt += "PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):\n\n";
    for (const h of history) {
      const trainS = `${h.train_passed ?? h.passed ?? 0}/${h.train_total ?? h.total ?? 0}`;
      const testS = h.test_passed !== undefined ? `${h.test_passed}/${h.test_total ?? "?"}` : null;
      const scoreStr = `train=${trainS}` + (testS ? `, test=${testS}` : "");
      prompt += `<attempt ${scoreStr}>\n`;
      prompt += `Description: "${h.description}"\n`;
      if (h.results) {
        prompt += "Train results:\n";
        for (const r of h.results) {
          const status = r.pass ? "PASS" : "FAIL";
          prompt += `  [${status}] "${r.query.slice(0, 80)}" (triggered ${r.triggers}/${r.runs})\n`;
        }
      }
      if (h.note) prompt += `Note: ${h.note}\n`;
      prompt += "</attempt>\n\n";
    }
  }

  prompt += `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:

1. Avoid overfitting
2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

Write the description in English and in third person. Answer only two questions: what does the Skill do, and when should the agent activate it? Prefer one or two sentences and roughly 15-40 words when that preserves reliable discovery. The hard limit is 1024 characters, not a target.

Use these rules:
- State the distinctive user intent and concrete domain terms, not implementation steps.
- A second sentence may begin with "Use when" to name activation contexts.
- Do not include translated prompt examples or multilingual keyword lists; test multilingual queries against the English description instead.
- Do not enumerate every neighboring Skill. Mention one only when it resolves a realistic routing ambiguity.
- The description competes with other Skills for attention, so keep it immediately recognizable.
- If repeated attempts fail, change the structure without expanding into a query list.

I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 

Please respond with only the new description text in <new_description> tags, nothing else.`;

  const text = await createRunner(runner).runText(prompt, model);

  let match = /<new_description>([\s\S]*?)<\/new_description>/.exec(text);
  let description = match ? match[1].trim().replace(/^"|"$/g, "") : text.trim().replace(/^"|"$/g, "");

  const transcript: Record<string, unknown> = {
    iteration: iteration ?? null,
    prompt,
    response: text,
    parsed_description: description,
    char_count: description.length,
    over_limit: description.length > 1024,
  };

  if (description.length > 1024) {
    const shortenPrompt =
      `${prompt}\n\n` +
      "---\n\n" +
      "A previous attempt produced this description, which at " +
      `${description.length} characters is over the 1024-character hard limit:\n\n` +
      `"${description}"\n\n` +
      "Rewrite it to be under 1024 characters while keeping the most " +
      "important trigger words and intent coverage. Respond with only " +
      "the new description in <new_description> tags.";
    const shortenText = await createRunner(runner).runText(shortenPrompt, model);
    match = /<new_description>([\s\S]*?)<\/new_description>/.exec(shortenText);
    const shortened = match ? match[1].trim().replace(/^"|"$/g, "") : shortenText.trim().replace(/^"|"$/g, "");

    transcript.rewrite_prompt = shortenPrompt;
    transcript.rewrite_response = shortenText;
    transcript.rewrite_description = shortened;
    transcript.rewrite_char_count = shortened.length;
    description = shortened;
  }

  transcript.final_description = description;

  if (logDir) {
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, `improve_iter_${iteration ?? "unknown"}.json`);
    writeFileSync(logFile, JSON.stringify(transcript, null, 2));
  }

  return description;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "eval-results": { type: "string" },
      "skill-path": { type: "string" },
      history: { type: "string" },
      model: { type: "string" },
      runner: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
  });

  if (!values["eval-results"] || !values["skill-path"] || !values.model) {
    console.error(
      "usage: improve_description.js --eval-results <file> --skill-path <dir> --model <name> [--history <file>] [--runner goose] [--verbose]"
    );
    process.exit(2);
  }

  const skillPath = resolve(values["skill-path"] as string);
  if (!existsSync(join(skillPath, "SKILL.md"))) {
    console.error(`Error: No SKILL.md found at ${skillPath}`);
    process.exit(1);
  }

  const evalResults: EvalResults = JSON.parse(readFileSync(resolve(values["eval-results"] as string), "utf-8"));
  let history: HistoryEntry[] = [];
  if (values.history) {
    history = JSON.parse(readFileSync(resolve(values.history as string), "utf-8"));
  }

  const { name, content } = parseSkillMd(skillPath);
  const currentDescription = evalResults.description;

  if (values.verbose) {
    console.error(`Current: ${currentDescription}`);
    console.error(`Score: ${evalResults.summary.passed}/${evalResults.summary.total}`);
  }

  const newDescription = await improveDescription(
    name,
    content,
    currentDescription,
    evalResults,
    history,
    values.model as string,
    { runner: values.runner as string | undefined }
  );

  if (values.verbose) {
    console.error(`Improved: ${newDescription}`);
  }

  const output = {
    description: newDescription,
    history: [
      ...history,
      {
        description: currentDescription,
        passed: evalResults.summary.passed,
        failed: evalResults.summary.failed,
        total: evalResults.summary.total,
        results: evalResults.results,
      },
    ],
  };
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
