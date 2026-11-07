import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Fixture-only owner contract, not a portable or current product runtime schema.
try {
  const root = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(root, 'artifact.json');
  if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) throw Error('manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const path = manifest.entry;
  if (manifest.profile !== 'interpreted-js' || typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || path.includes(':') || path.split('/').some(p => !p || p === '..' || p === '.')) throw Error('mapping');
  let entry = root;
  for (const part of path.split('/')) {
    entry = resolve(entry, part);
    if (lstatSync(entry).isSymbolicLink()) throw Error('link');
  }
  if (!lstatSync(entry).isFile() || createHash('sha256').update(readFileSync(entry)).digest('hex') !== manifest.sha256) throw Error('integrity');
  // Do not inherit loader/module injection. PATH is not used to locate the interpreter.
  const env = { ...process.env };
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const child = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit', env });
  if (child.error) throw child.error;
  if (child.signal) process.kill(process.pid, child.signal);
  else process.exitCode = child.status ?? 1;
} catch { console.error('fixture refused'); process.exitCode = 1; }
