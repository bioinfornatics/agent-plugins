import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {spawn} from 'node:child_process';
import { nativeFixture } from './fixtures/isolated-evaluation.ts';

// Transport/process scheduling only: the private script forwarded by the native
// fixture is intentionally opaque. Interpreted-loader privacy/replay tests remain separate.
async function run(n: number | undefined) {
  const f = nativeFixture(), root = f.root;
  try {
    const home = join(root, 'home'), out = join(root, 'out'), log = join(root, 'events');
    const host = f.host, cases = join(root, 'cases.json'), barrier = join(root, 'barrier');
    const expected = n ?? 3;
    mkdirSync(home); mkdirSync(join(home, '.agents/skills/one'), { recursive: true });
    writeFileSync(join(home, '.agents/skills/one/SKILL.md'), '---\nname: one\ndescription: Test.\n---\nTest');
    writeFileSync(cases, JSON.stringify({ evals: [0, 1, 2, 3].map(id => ({ id, prompt: 'case ' + id, expectations: ['answer'] })) }));
    writeFileSync(host, `
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const a=process.argv.slice(2),home=process.env.HOME,log=${JSON.stringify(log)},barrier=${JSON.stringify(barrier)};
const put=v=>fs.appendFileSync(log,JSON.stringify({...v,pid:process.pid,home})+'\\n');
if(a[0]==='skills') {
 console.log('Name | Description | Location');
 console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');
 if(fs.existsSync(home+'/.agents/skills/one'))console.log('one | Test | '+home+'/.agents/skills/one');
} else if(a[0]==='session') {
 console.log(JSON.stringify({name:a[a.indexOf('--name')+1],conversation:[]}));
} else {
 let p='';for await(const c of process.stdin)p+=c;
 put({event:'start'});
 // No candidate may finish until N real processes have started. Once opened,
 // the barrier stays open for later sequential arms and remaining cases.
 const starts=fs.readFileSync(log,'utf8').trim().split('\\n').map(l=>JSON.parse(l)).filter(e=>e.event==='start');
 if(starts.length>=${expected})fs.writeFileSync(barrier,'open');
 while(!fs.existsSync(barrier))await delay(10);
 put({event:'end'});
 console.log(JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'answer'}]}}));
 console.log(JSON.stringify({type:'complete'}));
}
`);
    const args = [join(import.meta.dirname, '../dist/scripts/cli.js'), 'run-evaluation', '--with-skills', 'one',
      '--source-home', home, '--eval-set', cases, '--output', out, '--goose-command', f.options.command, '--format', 'json'];
    if (n !== undefined) args.push('--parallelism', String(n));
    // Preflight resolves the environment default, not --goose-command.
    const child = spawn(process.execPath, args, { env: { PATH: process.env.PATH, SKILL_CREATOR_GOOSE_COMMAND: f.options.command, HOME: home,
      XDG_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config') } });
    let text = '', errors = '';
    child.stdout.on('data', c => text += c); child.stderr.on('data', c => errors += c);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, text + errors);
    const report = JSON.parse(text).output;
    const events = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(events.findIndex(e => e.event === 'end'), expected, 'N processes start before any completes');
    assert.equal(new Set(events.slice(0, expected).map(e => e.pid)).size, expected);
    let active = 0, max = 0;
    for (const e of events) { active += e.event === 'start' ? 1 : -1; max = Math.max(max, active); }
    assert.equal(active, 0); assert.equal(max, expected);
    assert.equal(report.runs.length, 8);
    assert.deepEqual(report.runs.map((r: any) => r.case_id), [0, 0, 1, 1, 2, 2, 3, 3]);
    assert.equal(report.history.status, 'indexed'); assert.equal(report.parallelism, expected);
  } finally { f.cleanup(); }
}
test('default three workers overlap; configurable one and four bound active candidates',async()=>{await run(undefined);await run(1);await run(4);});

// These gates observe the real scheduler/host boundary, not elapsed-time overlap.
// Case 0 finishes; case 1 throws in scheduler publication (or is cancelled);
// case 2 is still owned, and cases 3/4 must never be dequeued after stop.
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out: ' + label);
    await delay(10);
  }
}

async function stoppedCampaign(kind: 'throw' | 'signal') {
  const f = nativeFixture(), root = f.root;
  const home = join(root, 'home'), out = join(root, 'out');
  const log = join(root, 'events'), release = join(root, 'release');
  const host = f.host, cases = join(root, 'cases.json');
  const events = (): any[] => existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const seen = (event: string, id?: number) => events().some(e => e.event === event && (id === undefined || e.id === id));
  mkdirSync(join(home, '.agents/skills/one'), { recursive: true });
  writeFileSync(join(home, '.agents/skills/one/SKILL.md'), '---\nname: one\ndescription: Test.\n---\nTest');
  writeFileSync(cases, JSON.stringify({ evals: [0, 1, 2, 3, 4].map(id => ({ id, prompt: 'case ' + id, expectations: ['answer'] })) }));
  writeFileSync(host, `
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const args=process.argv.slice(2), name=args[args.indexOf('--name')+1]??'';
const id=Number(name.match(/case-(\\d+)/)?.[1]), arm=name.includes('-with_targets-')?'with_targets':'baseline';
const log=${JSON.stringify(log)}, release=${JSON.stringify(release)}, out=${JSON.stringify(out)}, kind=${JSON.stringify(kind)};
const put=event=>fs.appendFileSync(log,JSON.stringify({event,id,arm,pid:process.pid})+'\\n');
const seen=(event,id)=>fs.existsSync(log)&&fs.readFileSync(log,'utf8').trim().split('\\n').some(l=>{const e=JSON.parse(l);return e.event===event&&e.id===id;});
const wait=async predicate=>{while(!predicate())await delay(10);};
if(args[0]==='skills') {
 console.log('Name | Description | Location');
 console.log('goose-doc-guide | builtin | builtin://skills/goose-doc-guide');
 if(fs.existsSync(process.env.HOME+'/.agents/skills/one'))console.log('one | Test | '+process.env.HOME+'/.agents/skills/one');
} else if(args[0]==='session') {
 if(kind==='throw'&&id===1&&arm==='with_targets') {
  // The engine has finished successfully. Make protocol result publication throw,
  // rather than merely returning a nonzero host/campaign exit code.
  fs.mkdirSync(out+'/case-1/baseline/run-1/outputs/result.txt');
  put('throw-ready');
 }
 if(id===2 || (kind==='signal'&&id===1)) {
  put('drain-start'); await wait(()=>fs.existsSync(release)); put('drain-end');
 }
 console.log(JSON.stringify({name,conversation:[]}));
} else {
 let prompt=''; for await(const c of process.stdin)prompt+=c;
 put('start');
 if(id===2 || (kind==='signal'&&id===1)) {
  // A descendant must also be owned/reaped when the task is aborted.
  const descendant=spawn(process.execPath,['-e',
   "process.on('SIGTERM',()=>process.exit(0)); console.log('ready'); setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});
  descendant.stdout.once('data',()=>fs.appendFileSync(log,JSON.stringify({event:'descendant',id,pid:descendant.pid})+'\\n'));
  descendant.on('exit',()=>put('descendant-exit'));
  process.on('SIGTERM',()=>put('cancelled'));
  await new Promise(()=>{});
 } else {
  if(id===1&&arm==='with_targets')await wait(()=>seen('descendant',2));
  put('end');
  console.log(JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'answer'}]}}));
  console.log(JSON.stringify({type:'complete'}));
 }
}
`);
  // Whitelist environment: no ambient provider credentials, HOME, config or state.
  // Preflight and execution both resolve the same private native transport host.
  const env = { PATH: process.env.PATH, SKILL_CREATOR_GOOSE_COMMAND: f.options.command, HOME: home, XDG_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config') };
  const cli = join(import.meta.dirname, '../dist/scripts/cli.js');
  const child = spawn(process.execPath, [cli, 'run-evaluation', '--with-skills', 'one', '--source-home', home,
    '--eval-set', cases, '--output', out, '--goose-command', f.options.command,
    '--parallelism', '2', '--timeout', '20', '--format', 'json'], { env });
  let text = '', errors = '', closed = false;
  child.stdout.on('data', c => text += c); child.stderr.on('data', c => errors += c);
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject); child.once('close', code => { closed = true; resolve(code); });
  });
  const guard = setTimeout(() => child.kill('SIGKILL'), 30_000);
  try {
    await until(() => seen('descendant', 2), 'third case running while first has completed');
    if (kind === 'signal') {
      await until(() => seen('descendant', 1), 'both cancellable tasks ready');
      assert.equal(child.kill('SIGTERM'), true);
    }
    await until(() => seen('drain-start', 2), 'aborted worker enters gated evidence drain');
    assert.equal(closed, false, 'scheduler must await the remaining worker');
    assert.ok(seen('cancelled', 2), 'worker exception/signal aborts an already-running host');
    if (kind === 'throw') assert.ok(seen('throw-ready', 1));
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')).state.scheduled.map((x: any) => x.case_id), [0, 1, 2]);
    // Exercise the actual lock public seam with no wait: another writer cannot enter.
    const { acquireDirectoryLockSync } = await import(join(import.meta.dirname, '../dist/scripts/durable_file.js'));
    assert.throws(() => acquireDirectoryLockSync(join(out, '.lock'), { timeoutMs: 0 }), /coordination lock/);
    assert.equal(JSON.parse(readFileSync(join(out, '.lock/owner.json'), 'utf8')).pid, child.pid);
    writeFileSync(release, 'drain now');
    assert.equal(await completion, 1, text + errors);
    const report = JSON.parse(text).output;
    assert.equal(report.status, 'failure');
    if (kind === 'throw') {
      assert.equal(report.campaigns.find((c: any) => c.case_id === 1).status, 'succeeded', 'throw occurs after successful engine execution, not a returned campaign failure');
      assert.deepEqual(report.missing_runs.filter((r: any) => r.case_id === 1), [
        { case_id: 1, arm: 'baseline', repeat: 1 }, { case_id: 1, arm: 'with_targets', repeat: 1 },
      ]);
    }
    assert.equal(existsSync(join(out, '.lock')), false, 'lock released only after draining');
    assert.deepEqual(report.scheduled.map((x: any) => x.case_id), [0, 1, 2]);
    assert.deepEqual(report.missing_runs.filter((x: any) => x.case_id >= 3), [
      { case_id: 3, arm: 'baseline', repeat: 1 }, { case_id: 3, arm: 'with_targets', repeat: 1 },
      { case_id: 4, arm: 'baseline', repeat: 1 }, { case_id: 4, arm: 'with_targets', repeat: 1 },
    ]);
    const completed = report.runs.filter((r: any) => r.case_id === 0);
    assert.deepEqual(completed.map((r: any) => [r.arm, r.status]), [['baseline', 'succeeded'], ['with_targets', 'succeeded']]);
    const retained = completed.map((r: any) => readFileSync(join(out, r.directory, 'outputs/result.txt'), 'utf8'));
    assert.ok(retained.every((s: string) => s.includes('answer')));
    assert.ok(seen('drain-end', 2));
    if (kind === 'signal') assert.ok(seen('drain-end', 1), 'both cancelled workers drained');
    assert.ok(seen('descendant-exit', 2), 'host reaped its descendant before forced termination');
    for (const e of events().filter(e => e.event === 'start' || e.event === 'descendant')) {
      await until(() => { try { process.kill(e.pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; } }, 'owned process reaped: ' + e.pid);
    }
    const beforeResume = readFileSync(log, 'utf8');
    const resumed = spawn(process.execPath, [cli, 'run-evaluation', '--resume', '--output', out, '--format', 'json'], { env });
    let resumedText = ''; resumed.stdout.on('data', c => resumedText += c);
    let resumedErrors = ''; resumed.stderr.on('data', c => resumedErrors += c);
    const resumeCode = await new Promise(resolve => resumed.once('close', resolve));
    assert.equal(resumeCode, 1, resumedText + resumedErrors);
    const projection = JSON.parse(resumedText).output;
    assert.deepEqual(projection.missing_runs, report.missing_runs);
    assert.deepEqual(projection.runs, report.runs);
    assert.equal(readFileSync(log, 'utf8'), beforeResume, 'report-only resume launches no host or missing candidate');
    assert.deepEqual(completed.map((r: any) => readFileSync(join(out, r.directory, 'outputs/result.txt'), 'utf8')), retained);
  } finally {
    clearTimeout(guard);
    writeFileSync(release, 'cleanup');
    if (!closed) { child.kill('SIGKILL'); await completion; }
    // Only processes recorded by this private fake host may be cleaned up.
    for (const e of events()) if (e.event === 'start' || e.event === 'descendant') {
      try { process.kill(e.pid, 'SIGKILL'); } catch { /* already reaped */ }
    }
    f.cleanup();
  }
}

test('thrown worker stops dequeue, keeps lock through drain and retains completed evidence', { timeout: 45_000 }, async () => {
  await stoppedCampaign('throw');
});
test('SIGTERM drains owned hosts/descendants, exposes missing slots and resume stays report-only', { timeout: 45_000 }, async () => {
  await stoppedCampaign('signal');
});
