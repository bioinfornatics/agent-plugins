#!/usr/bin/env node
/** Restore current app from lock-authenticated tarballs offline; never run npm lifecycle scripts. */
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,mkdtempSync,rmSync,cpSync,readdirSync,lstatSync,renameSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'apps/agent-plugin'),vendor=path.join(root,'vendor/agent-plugin-tarballs');
const lockBytes=readFileSync(path.join(app,'package-lock.json')),lock=JSON.parse(lockBytes);
const manifest=JSON.parse(readFileSync(path.join(vendor,'manifest.json')));
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
if(manifest.schemaVersion!==1||manifest.lockSha256!==hash(lockBytes)||!Array.isArray(manifest.packages))throw Error('offline lock/manifest mismatch');
const selected=Object.entries(lock.packages).filter(([key,record])=>key&&(!record.optional||key.startsWith('node_modules/@biomejs/cli-linux-x64')));
if(process.platform!=='linux'||process.arch!=='x64')throw Error('offline build closure currently qualified for Linux x64 only');
if(manifest.packages.length!==selected.length)throw Error('offline package closure mismatch');
const target=path.join(app,'node_modules');
if(existsSync(target))throw Error('refusing to overwrite development modules: '+target);
const work=mkdtempSync(path.join(app,'.prepare-'));
try{
 const modules=path.join(work,'node_modules');mkdirSync(modules);
 for(const [key,record] of selected){
  const name=key.slice('node_modules/'.length),rows=manifest.packages.filter(p=>p.name===name);
  if(rows.length!==1)throw Error('offline package missing/duplicate: '+name);
  const item=rows[0];if(item.version!==record.version||item.integrity!==record.integrity||!/^[-a-zA-Z0-9.]+\.tgz$/.test(item.file))throw Error('offline package metadata mismatch: '+name);
  const archive=path.join(vendor,item.file),bytes=readFileSync(archive);
  if('sha512-'+hash(bytes,'sha512')!==record.integrity)throw Error('offline tarball integrity mismatch: '+name);
  const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8'});if(listing.status!==0)throw Error('unable to list offline tarball');
  const members=listing.stdout.split('\n').filter(Boolean),tops=new Set(members.map(p=>p.split('/')[0]));
  if(tops.size!==1||members.some(p=>p.startsWith('/')||p.split('/').includes('..')))throw Error('unsafe tarball path');
  const stage=path.join(work,'package-'+manifest.packages.indexOf(item));mkdirSync(stage);
  const extraction=spawnSync('tar',['-xzf',archive,'-C',stage],{stdio:'inherit'});if(extraction.status!==0)throw Error('tarball extraction failed');
  const source=path.join(stage,[...tops][0]);
  function noLinks(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name),stat=lstatSync(file);if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw Error('unsafe tarball entry');if(stat.isDirectory())noLinks(file);}}noLinks(source);
  const pkg=JSON.parse(readFileSync(path.join(source,'package.json')));if(pkg.name!==name||pkg.version!==record.version||pkg.license!==record.license)throw Error('tarball package identity mismatch');
  const destination=path.join(modules,...name.split('/'));mkdirSync(path.dirname(destination),{recursive:true});cpSync(source,destination,{recursive:true});
 }
 mkdirSync(path.join(modules,'.bin'));
 symlinkSync('../typescript/bin/tsc',path.join(modules,'.bin','tsc'));
 symlinkSync('../@biomejs/biome/bin/biome',path.join(modules,'.bin','biome'));
 renameSync(modules,target);
 console.log(JSON.stringify({status:'passed',offline:true,authenticatedPackages:selected.length,lifecycleScripts:false,platform:'linux-x64'}));
}finally{rmSync(work,{recursive:true,force:true});}
