import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {captureEvaluationConfig,stageEvaluationConfig} from '../dist/scripts/evaluation_config.js';
function fixture(run:(home:string,root:string)=>void){const root=mkdtempSync(join(tmpdir(),'privacy-unit-')),home=join(root,'source');mkdirSync(join(home,'.config/goose/custom_providers'),{recursive:true});try{run(home,root);}finally{rmSync(root,{recursive:true,force:true});}}
test('unknown scalars and auth argv do not erase public numbers or paths',()=>fixture((home)=>{
 writeFileSync(join(home,'.config/goose/custom_providers/p.json'),JSON.stringify({unknown:1,boolean:true,auth:{command:'public-command',args:['--scope','xx']}}));
 writeFileSync(join(home,'.config/goose/config.yaml'),yaml.dump({GOOSE_TEMPERATURE:0.1,PUBLIC_PATH:'/tmp/xx/public'}));
 const c=captureEvaluationConfig(home);const v:any=yaml.load(c.publicConfig);assert.equal(v.GOOSE_TEMPERATURE,0.1);assert.equal(v.PUBLIC_PATH,'/tmp/xx/public');assert(!c.secrets.includes('1'));assert(!c.secrets.includes('true'));assert(!c.secrets.includes('--scope'));assert(!c.secrets.includes('public-command'));
}));
test('external home references remain private host dependencies',()=>fixture((home)=>{
 writeFileSync(join(home,'.config/goose/config.yaml'),yaml.dump({extensions:{path:join(home,'.azure/cache')},TLS_FILE:join(home,'.azure/cert')}));
 const c=captureEvaluationConfig(home);assert.equal((yaml.load(c.privateConfig) as any).TLS_FILE,join(home,".azure/cert"));
}));
import {containsSensitiveValue} from '../dist/scripts/evaluation_privacy.js';
test('same typed policy protects short definite credentials and token-only opaque args',()=>fixture((home)=>{
 writeFileSync(join(home,'.config/goose/custom_providers/p.json'),JSON.stringify({unknown:{number:1,bool:true},auth:{command:'helper',args:['--scope','xx','--token','ab','--password=cd']}}));
 const c=captureEvaluationConfig(home);assert(!containsSensitiveValue('/tmp/xx/public 0.1 true --scope helper',c.sensitiveValues));assert(containsSensitiveValue('say xx now',c.sensitiveValues));assert(containsSensitiveValue('/tmp/ab/file',c.sensitiveValues));assert(containsSensitiveValue('abcd',c.sensitiveValues));
}));
test('PEM bodies, explicit secret scalars and long opaque keys remain private',()=>fixture((home)=>{
 const body='BODY';const opaque='opaque-canary-123456789';
 writeFileSync(join(home,'.config/goose/custom_providers/p.json'),JSON.stringify({name:['-----BEGIN PRIVATE KEY-----','BODY','-----END PRIVATE KEY-----'].join('\n'),opaque}));
 writeFileSync(join(home,'.config/goose/config.yaml'),yaml.dump({API_KEY:7,PUBLIC_NUMBER:17,providers:{custom:{options:{[opaque]:'public'}}}}));
 const c=captureEvaluationConfig(home);assert(c.secrets.includes(body));assert(containsSensitiveValue('/tmp/BODY/file',c.sensitiveValues));assert(!c.publicConfig.includes(opaque));assert(!c.publicConfig.includes('17'));assert(c.privateConfig.includes(opaque));
}));
test('main and structured provider references relocate independently without rewriting opaque auth',()=>fixture((home,root)=>{
 const source=join(home,'.config/goose'),opaque='token:'+join(source,'do-not-rewrite');
 writeFileSync(join(source,'custom_providers/p.json'),JSON.stringify({base_path:join(source,'cert.pem'),options:{certificate_file:join(source,'cert.pem')},auth:{token:opaque},extensions:{file:join(home,'.azure/cache')}}));
 writeFileSync(join(source,'config.yaml'),yaml.dump({TLS_FILE:join(source,'cert.pem'),extensions:{file:join(home,'.azure/cache')}}));writeFileSync(join(source,'cert.pem'),'canary');
 const c=captureEvaluationConfig(home),runHome=join(root,'stage');stageEvaluationConfig(c,runHome,[]);
 for(const dir of [join(runHome,'config'),join(runHome,'.config/goose')]){const main:any=yaml.load(readFileSync(join(dir,'config.yaml'),'utf8'));const provider=JSON.parse(readFileSync(join(dir,'custom_providers/p.json'),'utf8'));assert.equal(main.TLS_FILE,join(dir,'cert.pem'));assert.equal(provider.base_path,join(dir,'cert.pem'));assert.equal(provider.options.certificate_file,join(dir,'cert.pem'));assert.equal(provider.auth.token,opaque);assert.equal(provider.extensions,undefined);}
}));
test('external structured provider path is preserved as private host dependency',()=>fixture((home)=>{
 writeFileSync(join(home,'.config/goose/custom_providers/p.json'),JSON.stringify({options:{certificate_file:join(home,'.azure/cert')}}));const c=captureEvaluationConfig(home);assert(c.files.some(f=>f.path==="custom_providers/p.json"));
}));

test('opaque marker secrets survive staging; provider tuning and auth references remain supported',()=>fixture((home,root)=>{
 const source=join(home,'.config/goose'),marker='prefix__EVALUATION_GOOSE_CONFIG_ROOT__suffix';
 writeFileSync(join(source,'config.yaml'),yaml.dump({API_KEY:marker}));
 writeFileSync(join(source,'cert.pem'),'certificate-canary');
 writeFileSync(join(source,'custom_providers/p.json'),JSON.stringify({options:{context:32768,memory:true},auth:{args:['--cert',join(source,'cert.pem')]}}));
 const c=captureEvaluationConfig(home),stage=join(root,'stage');stageEvaluationConfig(c,stage,[]);
 for(const dir of [join(stage,'config'),join(stage,'.config/goose')]){assert.equal((yaml.load(readFileSync(join(dir,'config.yaml'),'utf8')) as any).API_KEY,marker);const p=JSON.parse(readFileSync(join(dir,'custom_providers/p.json'),'utf8'));assert.deepEqual(p.options,{context:32768,memory:true});assert.equal(p.auth.args[1],join(source,'cert.pem'));}
}));
test('bare bearer credential body is protected under public metadata',()=>fixture((home)=>{
 const body='definite-credential-canary-123456';writeFileSync(join(home,'.config/goose/custom_providers/p.json'),JSON.stringify({name:'Bearer '+body}));const c=captureEvaluationConfig(home);assert(containsSensitiveValue(body,c.sensitiveValues));
}));

test('opaque auth helpers and external HOME references remain unchanged privately',()=>fixture((home,root)=>{
 const script='helper --cache '+join(home,'.azure/cache')+' --home "$HOME"';
 writeFileSync(join(home,'.config/goose/config.yaml'),yaml.dump({TLS_FILE:join(home,'.azure/cert'),providers:{custom:{context:42,auth:{command:'sh',args:['-c',script]}}}}));
 writeFileSync(join(home,'.config/goose/custom_providers/p.json'),JSON.stringify({auth:{command:'sh',args:['-c',script]},options:{context:42}}));
 const c=captureEvaluationConfig(home),stage=join(root,'stage');stageEvaluationConfig(c,stage,[]);
 for(const dir of [join(stage,'config'),join(stage,'.config/goose')]){const v:any=yaml.load(readFileSync(join(dir,'config.yaml'),'utf8'));assert.equal(v.TLS_FILE,join(home,'.azure/cert'));assert.equal(v.providers.custom.auth.args[1],script);assert.deepEqual(JSON.parse(readFileSync(join(dir,'custom_providers/p.json'),'utf8')).auth,{command:'sh',args:['-c',script]});}
}));
test('extension transport permits only common builtin/platform identities',()=>fixture((home,root)=>{
 writeFileSync(join(home,'.config/goose/config.yaml'),yaml.dump({extensions:{developer:{name:'developer',type:'builtin',enabled:true},skills:{name:'skills',type:'platform',enabled:true},other:{name:'memory',type:'builtin',enabled:true},spoof:{name:'developer',type:'stdio',cmd:'untrusted'},summon:{name:'summon',type:'platform',enabled:false}}}));
 const c=captureEvaluationConfig(home),stage=join(root,'stage');stageEvaluationConfig(c,stage,[]);const v:any=yaml.load(readFileSync(join(stage,'config/config.yaml'),'utf8'));assert.deepEqual(Object.keys(v.extensions).sort(),['developer','skills','summon']);assert.equal(v.extensions.summon.enabled,false);
}));
