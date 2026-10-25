import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const CLI = new URL('../dist/scripts/cli.js', import.meta.url).pathname;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() { const root = mkdtempSync(join(tmpdir(), 'doctor-')); mkdirSync(join(root, 'skills/demo/runtime/dist'), { recursive: true }); mkdirSync(join(root, 'skills/demo/scripts')); writeFileSync(join(root, 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0', extensions: { 'io.github.bioinfornatics.agent-plugins.runtime': { mode: 'node-bundled', node: '>=22.0.0', commands: ['demo'] } } })); writeFileSync(join(root, 'skills/demo/scripts/demo.mjs'), '// launcher'); writeFileSync(join(root, 'skills/demo/runtime/dist/cli.js'), 'safe'); writeFileSync(join(root, 'skills/demo/runtime/runtime-manifest.json'), JSON.stringify({ schemaVersion: 1, runtimeMode: 'node-bundled', logicalName: 'demo', runtimeEntry: 'dist/cli.js', node: '>=22.0.0', files: [{ path: 'dist/cli.js', size: 4, sha256: sha('safe') }] })); return root; }
function run(root: string) { const r = spawnSync(process.execPath, [CLI, 'doctor', root, '--format', 'json'], { encoding: 'utf8' }); assert.ok(r.stdout.trim(), r.stderr); return { exit: r.status, report: JSON.parse(r.stdout) }; }
test('doctor diagnoses a complete runtime without changing files', () => { const root = fixture(); try {
    const before = readFileSync(join(root, 'plugin.json'), 'utf8');
    const r = run(root);
    assert.equal(r.exit, 0);
    assert.equal(r.report.status, 'ok');
    assert.equal(r.report.trust, 'local-integrity-only');
    assert.equal(readFileSync(join(root, 'plugin.json'), 'utf8'), before);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('doctor reports modified bytes, missing launcher and mixed layouts', () => { const root = fixture(); try {
    writeFileSync(join(root, 'skills/demo/runtime/dist/cli.js'), 'evil');
    let r = run(root);
    assert.equal(r.exit, 1);
    assert.ok(r.report.findings.some((f: any) => f.code === 'integrity.mismatch'));
    rmSync(join(root, 'skills/demo/scripts/demo.mjs'));
    r = run(root);
    assert.equal(r.exit, 1);
    assert.ok(r.report.findings.some((f: any) => f.code === 'file.missing'));
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('doctor refuses symlinks and hardlinked files without leaking content', () => { for (const kind of ['symlink', 'hardlink']) {
    const root = fixture(), outside = mkdtempSync(join(tmpdir(), 'doctor-outside-'));
    try {
        const target = join(outside, 'private');
        writeFileSync(target, 'PRIVATE_SECRET');
        const p = join(root, 'skills/demo/runtime/dist/cli.js');
        rmSync(p);
        kind === 'symlink' ? symlinkSync(target, p) : linkSync(target, p);
        const r = run(root);
        assert.equal(r.exit, 1);
        assert.ok(r.report.findings.some((f: any) => f.code === 'path.unsafe'));
        assert.ok(!JSON.stringify(r.report).includes('PRIVATE_SECRET'));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
    }
} });
test('doctor distinguishes unsupported installations and invalid usage', () => { const root = mkdtempSync(join(tmpdir(), 'doctor-')); try {
    writeFileSync(join(root, 'plugin.json'), JSON.stringify({ name: 'generic' }));
    const r = run(root);
    assert.equal(r.exit, 3);
    assert.equal(r.report.status, 'incomplete');
    assert.equal(spawnSync(process.execPath, [CLI, 'doctor']).status, 2);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
import { diagnoseInstallation } from '../dist/scripts/installation_doctor.js';
import { readdirSync, lstatSync, truncateSync, chmodSync } from 'node:fs';
function snapshot(root: string): unknown { return readdirSync(root).sort().map(n => { const p = join(root, n), s = lstatSync(p); return [n, s.mode, s.size, s.mtimeMs, s.isDirectory() ? snapshot(p) : sha(readFileSync(p).toString('base64'))]; }); }
function mutateManifest(root: string, fn: (m: any) => void) { const p = join(root, 'skills/demo/runtime/runtime-manifest.json'), m = JSON.parse(readFileSync(p, 'utf8')); fn(m); writeFileSync(p, JSON.stringify(m)); }
test('D2 all installation bytes, modes and timestamps remain unchanged', () => { const root = fixture(); try {
    const before = snapshot(root);
    run(root);
    assert.deepEqual(snapshot(root), before);
    writeFileSync(join(root, 'skills/demo/runtime/dist/cli.js'), 'bad');
    const bad = snapshot(root);
    run(root);
    assert.deepEqual(snapshot(root), bad);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('D4 mixed layouts and incompatible Node versions are errors', () => { const root = fixture(); try {
    assert.ok(diagnoseInstallation(root, '21.9.0').findings.some(f => f.code === 'runtime.incompatible'));
    writeFileSync(join(root, 'skills/demo/scripts/demo.exe'), 'not executed');
    const r = run(root);
    assert.equal(r.exit, 1);
    assert.ok(r.report.findings.some((f: any) => f.code === 'runtime.mixed'));
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('D3 invalid inventories fail before reading manifest-directed files', () => { for (const path of ['../private', '/private', 'a/./b', 'a//b']) {
    const root = fixture();
    try {
        mutateManifest(root, m => m.files.push({ path, size: 0, sha256: sha('') }));
        const r = run(root);
        assert.equal(r.exit, 1);
        assert.ok(r.report.findings.some((f: any) => f.code === 'manifest.invalid'));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
} const root = fixture(); try {
    mutateManifest(root, m => m.files.push(m.files[0]));
    assert.equal(run(root).exit, 1);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('D2 absent and malformed manifests and unexpected runtime files fail', () => { for (const kind of ['missing', 'malformed', 'extra']) {
    const root = fixture();
    try {
        const p = join(root, 'skills/demo/runtime/runtime-manifest.json');
        if (kind === 'missing')
            rmSync(p);
        else if (kind === 'malformed')
            writeFileSync(p, 'PRIVATE_SECRET_INVALID');
        else
            writeFileSync(join(root, 'skills/demo/runtime/unexpected'), 'extra');
        const r = run(root);
        assert.equal(r.exit, 1);
        assert.ok(!JSON.stringify(r.report).includes('PRIVATE_SECRET_INVALID'));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
} });
test('D5 native runtime is incomplete and is never executed', () => { const root = fixture(); try {
    const p = join(root, 'plugin.json'), m = JSON.parse(readFileSync(p, 'utf8'));
    m.extensions['io.github.bioinfornatics.agent-plugins.runtime'].mode = 'native-bun';
    writeFileSync(p, JSON.stringify(m));
    rmSync(join(root, 'skills/demo/runtime'), { recursive: true });
    writeFileSync(join(root, 'skills/demo/scripts/demo'), 'throw new Error("must not execute")');
    assert.equal(run(root).exit, 3);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('D6 stable reports, text, quiet and invalid format have explicit exits', () => { const root = fixture(); try {
    assert.deepEqual(run(root), run(root));
    const text = spawnSync(process.execPath, [CLI, 'doctor', root], { encoding: 'utf8' });
    assert.equal(text.status, 0);
    assert.match(text.stdout, /publisher authenticity is not verified/);
    const quiet = spawnSync(process.execPath, [CLI, 'doctor', root, '--quiet'], { encoding: 'utf8' });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout, '');
    assert.equal(spawnSync(process.execPath, [CLI, 'doctor', root, '--format', 'ci']).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, 'doctor', root, 'extra']).status, 2);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('D3 root aliases and special files are rejected without blocking', () => { const root = fixture(), outside = mkdtempSync(join(tmpdir(), 'doctor-alias-')); try {
    symlinkSync(root, join(outside, 'alias'));
    assert.equal(run(join(outside, 'alias')).exit, 1);
    if (process.platform !== 'win32') {
        assert.equal(spawnSync('mkfifo', [join(root, 'skills/demo/runtime/fifo')]).status, 0);
        assert.equal(run(root).exit, 1);
    }
}
finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
} });
test('D5 JSON and hashing limit exceedance is incomplete, not a valid install', () => { for (const kind of ['json', 'hash']) {
    const root = fixture();
    try {
        truncateSync(join(root, kind === 'json' ? 'plugin.json' : 'skills/demo/runtime/dist/cli.js'), kind === 'json' ? 4 * 1024 * 1024 + 1 : 512 * 1024 * 1024 + 1);
        const r = run(root);
        assert.equal(r.exit, 3);
        assert.equal(r.report.status, 'incomplete');
        assert.ok(r.report.findings.some((f: any) => f.code === 'diagnostic.limit'));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
} });
function distribution(root: string) { const files: any[] = []; function walk(dir: string, base = '') { for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n), s = lstatSync(p), rel = base + n;
    if (s.isDirectory())
        walk(p, rel + '/');
    else
        files.push({ path: rel, mode: (s.mode & 0o111) ? 755 : 644, size: s.size, sha256: createHash('sha256').update(readFileSync(p)).digest('hex') });
} } walk(root); writeFileSync(join(root, 'distribution-manifest.json'), JSON.stringify({ schemaVersion: 1, runtimeMode: 'node-bundled', sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), inventorySha256: sha(JSON.stringify(files)), files })); }
test('D1 distribution inventory reports unauthenticated provenance and checks whole tree', () => { const root = fixture(); try {
    distribution(root);
    let r = run(root);
    assert.equal(r.exit, 0);
    assert.equal(r.report.provenance.sourceCommit, 'a'.repeat(40));
    assert.equal(r.report.provenance.authenticated, false);
    writeFileSync(join(root, 'extra'), 'extra');
    r = run(root);
    assert.equal(r.exit, 1);
    assert.ok(r.report.findings.some((f: any) => f.path === 'extra'));
}
finally {
    rmSync(root, { recursive: true, force: true });
} });
test('D2 distribution mode changes are integrity failures', () => { const root = fixture(); try {
    distribution(root);
    chmodSync(join(root, 'skills/demo/scripts/demo.mjs'), 0o755);
    assert.equal(run(root).exit, 1);
}
finally {
    rmSync(root, { recursive: true, force: true });
} });

test('D5 cumulative entry and recursion limits cannot yield ok', () => {
    for (const kind of ['entries', 'depth']) {
        const root = fixture();
        try {
            const base = join(root, 'skills/demo/runtime');
            if (kind === 'entries') {
                for (let i = 0; i < 10001; i++) writeFileSync(join(base, 'entry-' + i), '');
            } else {
                let p = base;
                for (let i = 0; i < 130; i++) { p = join(p, 'd'); mkdirSync(p); }
            }
            const r = run(root);
            assert.equal(r.exit, 3);
            assert.ok(r.report.findings.some((f:any) => f.code === 'diagnostic.limit'));
        } finally { rmSync(root, {recursive:true, force:true}); }
    }
});
