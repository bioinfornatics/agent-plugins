#!/usr/bin/env node
/** Validate source closure independently of branch history and staging state. */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'config/reproducibility/source-manifest.json'), 'utf8'));
const fail = message => { throw new Error('source inventory: ' + message); };
const canonical = value => typeof value === 'string' && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');
const expression = pattern => new RegExp('^' + pattern.split('*').map(part => part.replace(/[^a-zA-Z0-9/_-]/g, '\\$&')).join('[^/]*').replaceAll('[^/]*[^/]*', '.*') + '$');
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.requiredFiles)) fail('invalid source manifest');
const required = new Set(manifest.requiredFiles);
if (required.size !== manifest.requiredFiles.length) fail('duplicate source input');
const declarations = [...manifest.generatedClassifications, ...manifest.transientGeneratedOutputs];
for (const item of declarations) if (!canonical(item.path) || !item.regenerator) fail('invalid generated declaration');
const generated = declarations.map(item => expression(item.path));
const isGenerated = file => generated.some(match => match.test(file));
const overlap = manifest.requiredFiles.filter(isGenerated);
if (overlap.length) fail('source/generated overlap: ' + overlap.join(', '));
for (const file of required) {
  if (!canonical(file) || file.startsWith('.beads/')) fail('unsafe source input: ' + file);
  const stat = lstatSync(path.join(root, file), { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) fail('source input is absent or not a regular file: ' + file);
}
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
const unknown = [...new Set(files)].filter(file => !file.startsWith('.beads/') && lstatSync(path.join(root, file), { throwIfNoEntry: false }) && !required.has(file) && !isGenerated(file));
if (unknown.length) fail('undeclared source files: ' + unknown.join(', '));
console.log(JSON.stringify({ status: 'passed', sourceFiles: required.size, unknownPaths: 0, sourceGeneratedOverlap: 0 }));
