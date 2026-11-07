import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');
// Source snapshots are format evidence only: retired validators must not be replaced
// by successful mocks, and no test here claims installed native hook activation.
test('recorded Goose sources distinguish revision-specific observation events',()=>{
 const source=read('skills/hook-creator/references/goose-target-compatibility.md');
 assert.match(source,/v1\.47\.0[^\n]+f9c7aaccde4834810dfd13d5efa8f0d39ba28a20[^\n]+Absent/);
 assert.match(source,/main-2b17adc[^\n]+2b17adc33a7176e701c2fef9578a5fc5834ea89a[^\n]+observation only/);
 assert.match(source,/Only PreToolUse and Stop are blocking events/);
});
test('source layout contract preserves native hooks and fails closed on ambiguous migration',()=>{
 const source=read('skills/hook-creator/references/goose-target-compatibility.md');
 assert.match(source,/<plugin>\/hooks\/hooks\.json/);
 assert.match(source,/not native activation paths/);
 assert.match(source,/Multiple layouts are rejected/);
 assert.match(source,/preserves native hooks and blocks adapter-only migration/);
 assert.match(source,/preserve manifest bytes/);
});
test('active hook instructions require manual component review, not retired validator success',()=>{
 const instructions=read('skills/hook-creator/SKILL.md');
 // Reject loss of manual review or revival of retired component validators, not wording changes.
 assert.match(instructions,/Manually review/);assert.match(instructions,/There is no current hook component\s+validator/);
 assert.match(instructions,/supported events, compiling matchers, nonempty\s+commands, valid timeouts/);
 assert.match(instructions,/Direct handler success is not\s+lifecycle activation/);assert.match(instructions,/configuration review is not blocking-safety proof/);
 assert.match(instructions,/explicit local execution authority/);
 const mapping=JSON.parse(read('config/skill-runtimes/skill-runtime-map.json'));
 assert.ok(!mapping.skills.some((entry:any)=>entry.logicalName==='hook-creator'||entry.logicalName==='plugin-creator'));
});
