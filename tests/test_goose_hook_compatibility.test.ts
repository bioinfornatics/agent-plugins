import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');
// Source snapshots are format evidence only: retired validators must not be replaced
// by successful mocks, and no test here claims installed native hook activation.
test('versioned evidence is separate from current host instructions',()=>{
 const source=read('skills/hook-creator/references/compatibility-matrix.md');
 assert.match(source,/v1\.47\.0[^\n]+f9c7aaccde4834810dfd13d5efa8f0d39ba28a20[^\n]+Absent/);
 assert.match(source,/main-2b17adc[^\n]+2b17adc33a7176e701c2fef9578a5fc5834ea89a[^\n]+observation only/);
 const active=read('skills/hook-creator/references/goose-target-compatibility.md');
 assert.match(active,/Only PreToolUse and Stop are blocking events/);
 assert.doesNotMatch(active,/v1\.47\.0|main-2b17adc/);
 assert.match(active,/`on_failure`/);assert.match(active,/Stop failures remain fail-open/);
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
 const goose=read('skills/hook-creator/references/goose-workflow.md');
 assert.match(goose,/supported events, compiling matchers, nonempty\s+commands, valid timeouts/);
 assert.match(instructions,/Direct handler success is not\s+lifecycle activation/);assert.match(instructions,/configuration review is not blocking-safety proof/);
 assert.match(instructions,/explicit local execution authority/);
 const mapping=JSON.parse(read('config/skill-runtimes/skill-runtime-map.json'));
 assert.ok(!mapping.skills.some((entry:any)=>entry.logicalName==='hook-creator'||entry.logicalName==='plugin-creator'));
});
// Detect eager Goose procedures or a broken route for an author targeting another host.
// These assertions cover source disclosure, not actual harness loading or activation.
test('hook entrypoint routes by target host and discloses the Goose procedure only at its branch',()=>{
 const instructions=read('skills/hook-creator/SKILL.md');
 assert.match(instructions,/target is where the hook will run, not necessarily the harness/);
 assert.match(instructions,/If the host is not identified, ask/);
 for(const host of ['goose','claude-code','codex','opencode']){
  assert.ok(instructions.includes(`references/${host}-hooks.md`));
  assert.ok(read(`skills/hook-creator/references/${host}-hooks.md`).length>0);
 }
 assert.match(instructions,/For Goose creation, modification or audit,\s+follow the \[Goose component workflow\]\(references\/goose-workflow\.md\)/);
 assert.match(instructions,/never load the Goose procedure as a fallback/);
 assert.doesNotMatch(instructions,/## Author or review a Goose component|## Verify Goose handlers|GOOSE_STOP_HOOK_BLOCK_CAP|\$\{PLUGIN_ROOT\}|on_failure: block/);
 const goose=read('skills/hook-creator/references/goose-workflow.md');
 assert.match(goose,/## Author or review a Goose component/);
 assert.match(goose,/\$\{PLUGIN_ROOT\}/);assert.match(goose,/GOOSE_STOP_HOOK_BLOCK_CAP/);
 assert.match(goose,/\[SKILL\.md\]\(\.\.\/SKILL\.md#verify-the-selected-component-and-hand-off\)/);
});
