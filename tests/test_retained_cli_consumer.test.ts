import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareEvaluation } from '../apps/agent-plugin/src/application/use-cases/prepare-evaluation.ts';
import { FilesystemEvaluationSource } from '../apps/agent-plugin/src/adapters/outbound/filesystem/filesystem-evaluation-source.ts';
import { SqliteEvaluationStore } from '../apps/agent-plugin/src/adapters/outbound/storage/sqlite-evaluation-store.ts';
import { SqliteVerifiedAttemptReader } from '../apps/agent-plugin/src/adapters/outbound/storage/sqlite-verified-attempt.ts';
import type { EvaluationPlan } from '../apps/agent-plugin/src/application/ports/evaluation-store.ts';
import type { TrialRequest } from '../apps/agent-plugin/src/domain/execution.ts';

const repo = fileURLToPath(new URL('../', import.meta.url));

async function hashes(root: string): Promise<[string, string][]> {
  const files: [string, string][] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await hashes(path));
    else {
      assert.ok(entry.isFile(), `Unexpected non-file: ${path}`);
      files.push([path, createHash('sha256').update(await readFile(path)).digest('hex')]);
    }
  }
  return files;
}

// Producer uses public source APIs; consumers run only the copied, authenticated
// installation. No provider runs occur: receipts are explicit storage fixtures,
// not evidence of native Goose compatibility or evaluation effectiveness.
// Build at the final private location: archive checkpoints retain absolute paths.
test('contained history/inspect preserve real completed and interrupted campaigns and frozen inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retained-cli-consumer-'));
  try {
    const source = join(root, 'neutral-source');
    await mkdir(join(source, 'evals'), { recursive: true, mode: 0o700 });
    await writeFile(join(source, 'SKILL.md'), '---\nname: neutral-proof\ndescription: Provides a neutral storage fixture.\n---\nReturn fixture proof.\n');
    await writeFile(join(source, 'evals/evals.json'), JSON.stringify({ evals: [{
      id: 1, prompt: 'Return fixture proof.', expectations: ['Answer contains fixture proof.'],
    }] }));
    const input = { skills: [source], plugins: [], agents: ['goose'], repetitions: 1, maxTurns: 5, timeout: 0, parallelism: 1 };
    const inputBefore = JSON.stringify(input);
    const plan = await prepareEvaluation(input, new FilesystemEvaluationSource());
    const planBefore = JSON.stringify(plan);
    const registry = join(root, 'registry/evaluations.sqlite');
    const output = join(root, 'campaigns');
    const answer = Buffer.from('fixture proof\n');

    async function retain(completed: boolean) {
      const store = new SqliteEvaluationStore(output, registry);
      const campaign = await store.begin(plan);
      const attempts: TrialRequest[] = [];
      try {
        const trials: EvaluationPlan['trials'] = completed ? plan.trials : plan.trials.slice(0, 1);
        for (const trial of trials) {
          const scenario = plan.profile.scenarios.find(item => item.id === trial.scenario);
          assert.ok(scenario);
          const request: TrialRequest = { id: randomUUID(), trialId: trial.id, pairId: trial.pairId,
            agent: trial.agent, condition: trial.condition, profile: plan.profile, scenario, options: plan.options };
          await store.start(request);
          await store.finish(request, { status: 'completed', collection: 'complete', exitCode: 0,
            sessionName: request.id, host: { id: 'goose', version: 'storage-fixture-not-native' },
            startedAt: '2026-11-06T00:00:00.000Z', finishedAt: '2026-11-06T00:00:01.000Z',
            limitations: ['Synthetic storage fixture; no provider execution.'],
            artifacts: [{ path: 'answer.txt', content: answer }] });
          attempts.push(request);
        }
        if (completed) await store.complete();
      } finally { await store.close(); }
      return { ...campaign, attempts };
    }

    const completed = await retain(true);
    const interrupted = await retain(false);
    assert.equal(completed.attempts.length, 2);
    assert.equal(interrupted.attempts.length, 1);
    assert.deepEqual(new Set(completed.attempts.map(item => item.condition)), new Set(['with', 'without']));
    const reader = new SqliteVerifiedAttemptReader(registry);
    for (const campaign of [completed, interrupted]) {
      for (const attempt of campaign.attempts) {
        const verified = await reader.readAttempt({ campaignId: campaign.id, attemptId: attempt.id });
        assert.equal(verified.artifacts.length, 1);
        assert.equal(Buffer.from(verified.artifacts[0]!.content).toString(), 'fixture proof\n');
      }
    }

    const installed = join(root, 'standalone');
    await mkdir(join(installed, 'scripts'), { recursive: true });
    await cp(join(repo, 'skills/skill-creator/scripts/skill-creator.mjs'), join(installed, 'scripts/skill-creator.mjs'));
    await cp(join(repo, 'skills/skill-creator/runtime'), join(installed, 'runtime'), { recursive: true });
    // An isolated cwd and allowlisted environment prevent operator HOME, loaders,
    // NODE_PATH or source checkout fallbacks from participating in consumption.
    const home = join(root, 'private-home');
    await mkdir(home, { mode: 0o700 });
    const before = await hashes(root);
    const run = (args: string[]) => {
      const result = spawnSync(process.execPath, [join(installed, 'scripts/skill-creator.mjs'), ...args], {
        cwd: root, encoding: 'utf8', timeout: 20000,
        env: { PATH: process.env.PATH, HOME: home, XDG_DATA_HOME: join(home, 'data'),
          XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state') },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const rows = JSON.parse(run(['history', '--registry', registry, '--json']));
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row: { id: string }) => row.id)), new Set([completed.id, interrupted.id]));
    for (const [campaign, status, finalized] of [[completed, 'completed', 2], [interrupted, 'interrupted', 1]] as const) {
      const row = rows.find((item: { id: string }) => item.id === campaign.id);
      assert.ok(row);
      assert.equal(row.status, status);
      assert.equal(row.total, 2);
      assert.equal(row.finalized, finalized);
      assert.equal(row.uncertain, 0);
      assert.equal(row.output, campaign.output);
      assert.equal(row.profileId, plan.profile.id);
      assert.equal(row.revision, plan.profile.revision);
      const detail = run(['inspect', campaign.id, '--registry', registry]);
      assert.ok(detail.includes(campaign.id));
      assert.ok(!detail.includes('MISSING:'));
      for (const attempt of campaign.attempts) {
        assert.ok(detail.includes(attempt.id));
        assert.ok(detail.includes(`available: ${join(campaign.output, 'artifacts', attempt.id, 'answer.txt')}`));
      }
      if (status === 'interrupted') assert.ok(detail.includes('pending; latest attempt none'));
    }
    // Includes all source inputs, SQLite bytes, archives, installed runtime and
    // private HOME; detects both changed bytes and newly created/deleted files.
    assert.deepEqual(await hashes(root), before);
    assert.equal(JSON.stringify(input), inputBefore);
    assert.equal(JSON.stringify(plan), planBefore);
    assert.equal((await readdir(output)).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
