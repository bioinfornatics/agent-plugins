import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateReviewAnalysis } from '../dist/scripts/session_review_analysis.js';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const report={rows:['without_skill','with_skill'].map(configuration=>({eval_id:17,run_number:1,configuration,expectations:[{text:'Keep evidence',passed:false}]}))};
const item=()=>({eval_id:17,run_number:1,criterion:'Keep evidence',category:'evidence_gap',explanation:'Evidence unavailable',next_action:'Inspect evidence',confidence:'low'});
const input=(items:any[]= [item()])=>({schema_version:'evaluation-review-analysis-v1',report_sha256:sha('report bytes'),items});
const validate=(v:any,r:any=report)=>validateReviewAnalysis(v,r,sha('report bytes'));
test('exact byte binding, whitelist and unconfirmed state',()=>{const v=validate(input([{...item(),secret:'PRIVATE',confirmation_state:'confirmed'}]));assert.equal(v[0].confirmation_state,'unconfirmed');assert.equal(v[0].secret,undefined);assert.throws(()=>validate({...input(),report_sha256:sha('changed')}));assert.deepEqual(report.rows[0].expectations[0].passed,false);});
test('unknown, ambiguous, duplicate and overlapping identities fail',()=>{assert.throws(()=>validate(input([{...item(),eval_id:'17'}])));assert.throws(()=>validate(input([{...item(),criterion:'other'}])));assert.throws(()=>validate(input([item(),item()])));assert.throws(()=>validate(input([item(),{...item(),configuration:'with_skill'}])));assert.throws(()=>validate(input(),{rows:[...report.rows,report.rows[0]]}));assert.throws(()=>validate(input(),{rows:[{...report.rows[0],expectations:[{text:'Keep evidence'},{text:'Keep evidence'}]}]}));assert.equal(validate(input([{...item(),configuration:'with_skill'}])).length,1);});
const instruction=(source_content=`# Evidence
Keep an exact quote.

# Other
Other excerpt.
`)=>({locator:'skills/example/SKILL.md#evidence',source_sha256:sha(source_content),source_content,excerpt:'Keep an exact quote.'});
test('verified snapshot drops full content and cannot establish causality',()=>{const v=validate(input([{...item(),category:'instruction_hypothesis',instruction:instruction(),hypothesis:'A possible instruction gap'}]))[0];assert.equal(v.instruction.source_content,undefined);assert.equal(v.instruction.excerpt,'Keep an exact quote.');assert.equal(v.confirmation_state,'unconfirmed');assert.throws(()=>validate(input([{...item(),category:'instruction_hypothesis'}])));});
test('snapshot hash, fields, path, anchor and section containment fail closed',()=>{for(const patch of [{source_sha256:sha('wrong')},{source_content:undefined},{excerpt:'Other excerpt.'},{locator:'https://evil/SKILL.md#evidence'},{locator:'skills/example/../SKILL.md#evidence'},{locator:'skills/example/SKILL.md#absent'},{locator:'skills/example/SKILL.md#evidence%20'}])assert.throws(()=>validate(input([{...item(),instruction:{...instruction(),...patch}}])));});
test('references and Markdown headings, including fences, duplicate anchors and setext',()=>{const source=`Evidence
========
Quote one.

~~~md
# Fake
~~~

## Nested
Nested quote.

# Evidence
Quote two.
`;const snapshot={locator:'skills/example/references/details.md#evidence-1',source_sha256:sha(source),source_content:source,excerpt:'Quote two.'};assert.equal(validate(input([{...item(),instruction:snapshot}])).length,1);assert.throws(()=>validate(input([{...item(),instruction:{...snapshot,locator:'skills/example/references/details.md#fake'}}])));assert.throws(()=>validate(input([{...item(),instruction:{...snapshot,excerpt:'Quote one.'}}])));});
test('schema, enums and resource bounds reject',()=>{for(const patch of [{category:'root_cause'},{confidence:'certain'},{next_action:''},{missing_evidence:[3]},{explanation:'x'.repeat(65537)}])assert.throws(()=>validate(input([{...item(),...patch}])));assert.throws(()=>validate({...input(),schema_version:'wrong'}));});
