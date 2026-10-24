#!/usr/bin/env node
/** Restore declared development modules offline; never run lifecycle installers. */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const verified=spawnSync(process.execPath,[path.join(root,'scripts/verify-repository-integrity.mjs')],{stdio:'inherit'});
if(verified.status!==0)process.exit(verified.status??1);
for(const directory of ['apps/agent-creator-cli','apps/hook-creator-cli','apps/plugin-creator-cli','apps/skill-creator-cli','contracts/capability-contract']){
 const target=path.join(root,directory,'node_modules');
 if(existsSync(target))throw new Error('refusing to overwrite development modules: '+target);
 mkdirSync(target,{recursive:true});cpSync(path.join(root,'vendor/build-node_modules/node_modules'),target,{recursive:true});
}
