import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const criterion = 'The output selects small-task mode with numeric score not applicable.';
const quote = 'Review mode: independent, read-only, qualitative review. No numeric score is requested or planned.';
for (const runtime of ['skills/skill-creator/runtime', 'skills/plugin-creator/runtime/related/skill-creator']) {
  test(runtime + ': domain evidence and self-grading rejection', async () => {
    const api = await import(pathToFileURL(path.join(root, runtime, 'dist/scripts/evaluator_grading.js')));
    assert.equal(typeof api.isMetaGradingClaim, 'function');
    assert.equal(api.isMetaGradingClaim(criterion, quote), false);
    for (const invalid of ['I pass this criterion', 'score: 100', 'the grade is pass', 'numeric score: 100', 'I give myself a score of 100', 'My self-awarded score is 100'])
      assert.equal(api.isMetaGradingClaim(criterion, invalid), true, invalid);
    for (const domain of ['score', 'The external assessor reported score: 87 for the vendor.', 'I assign ownership to the product lead.'])
      assert.equal(api.isMetaGradingClaim(criterion, domain), false, domain);
    for (const [output, evidence, second, expected] of [[quote, quote, 'pass', 'pass'], ['Other output', quote, 'pass', 'inconclusive'], [quote, quote, 'fail', 'inconclusive']]) {
      let calls = 0;
      const result = await api.gradeOutput({prompt:'Synthetic projection regression',output,assertions:[criterion],variantSha256:'a'.repeat(64),graders:[{id:'a',model:'fixture'},{id:'b',model:'fixture'}],adapter:{async grade(){return {raw:JSON.stringify({verdict:calls++ ? second : 'pass',evidence_quote:evidence,rationale:'fixture'}),usage:null};}},budget:{used:0,limit:2}});
      assert.equal(result.grading.expectations[0].verdict, expected);
    }
  });
  test(runtime + ': delegated import closure resolves without repository fallback', async () => {
    const api = await import(pathToFileURL(path.join(root, runtime, 'dist/scripts/import_grading.js')));
    assert.equal(typeof api.importGrading, 'function');
    assert.equal(await api.main([]), 2);
  });
}
