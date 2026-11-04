/** Current Node/distribution guarantees; retired campaigns are not passing gates. */
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {remainingRootTests,retiredGuarantees,loadTestPlan} from './ci-test-plan.mjs';
const profile=process.argv[2]??'--profile=full';
const ciShards=process.argv[3]==='--ci-skill-shards';
if(process.argv.length>4||process.argv[3]&&!ciShards||ciShards&&profile!=='--profile=production'||!['--profile=full','--profile=production'].includes(profile))throw Error('usage: test.mjs [--profile=full|--profile=production] [--ci-skill-shards]');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const status=()=>execFileSync('git',['status','--porcelain=v1'],{cwd:root,encoding:'utf8'}).split('\n').filter(line=>line&&!line.slice(3).startsWith('.beads/')).sort().join('\n');
const initial=status();
process.on('exit',()=>{if(status()!==initial){console.error('test runner changed working-tree status outside Beads');process.exitCode=1;}});
function gate(label,args,cwd=root){
 console.log('\n> '+label);const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit'});
 if(result.error)throw result.error;if(result.status!==0||result.signal)process.exit(result.status||1);
}
// Validate even in remainder mode: omission is authorized only by the closed
// four-shard partition and canonical seven-job proof, never by optional tests.
const plan=loadTestPlan(root);
// CI host proof cannot turn green through node:test's optional local skip.
// Keep the explicitly supplied binary authoritative; never fall back on PATH.
if(process.env.CI_REQUIRE_GOOSE_HOST==='1'||process.env.CI){
 const goose=process.env.GOOSE_TEST_BINARY||process.env.GOOSE_EXECUTABLE;
 if(!goose)throw Error('required CI Goose missing: set GOOSE_TEST_BINARY or GOOSE_EXECUTABLE');
 const version=spawnSync(goose,['--version'],{encoding:'utf8'});
 if(version.error||version.status!==0||!/\b1\.47\.0\b/.test((version.stdout??'')+(version.stderr??'')))throw Error('required CI Goose 1.47.0 unavailable: '+goose);
}

gate('Verifying repository vendored dependency integrity',['scripts/verify-repository-integrity.mjs']);
if(!ciShards)gate('Testing every current agent-plugin test',['--test','--test-concurrency=2',...plan.shards.flatMap(s=>s.files).map(f=>'tests/'+f)],path.join(root,'apps/agent-plugin'));
gate('Checking committed runtime drift',['scripts/check-skill-runtime-dist-drift.mjs']);
// These files retain current production, cleanup, host install and CI trust
// guarantees. An obsolete assertion is a failure for migration, not an exclusion.
for(const file of remainingRootTests)gate('Testing '+file,['--test','tests/'+file]);
console.log(JSON.stringify({status:'passed',profile:profile.slice(10),portableGates:ciShards?'remaining-passed-skill-shards-required':'passed',requiredExternalGates:ciShards?['skill-1','skill-2','skill-3','skill-4']:[],retiredGuarantees,nativeCompatibility:'unverified'}));
