import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../shared/imports/state.ts').catch(()=>({}));
test('review is not counted as imported and partial errors remain visible',()=>{
  assert.equal(typeof api.summarizeItems,'function');
  const result=api.summarizeItems([{status:'imported'},{status:'waiting_review'},{status:'error'}]);
  assert.deepEqual(result,{status:'waiting_review',total:3,processed:3,imported:1,review:1,failed:1,skipped:0});
});
test('cancel preserves committed results in summary',()=>{
  assert.equal(typeof api.summarizeItems,'function');
  assert.equal(api.summarizeItems([{status:'imported'},{status:'cancelled'}],true).imported,1);
  assert.equal(api.summarizeItems([{status:'imported'},{status:'cancelled'}],true).status,'cancelled');
});
test('pending work has priority over waiting review',()=>{
  assert.equal(typeof api.summarizeItems,'function');
  assert.equal(api.summarizeItems([{status:'queued'},{status:'waiting_review'}]).status,'queued');
});
test('errors are classified and secrets redacted',()=>{
  assert.equal(typeof api.importError,'function');
  assert.equal(api.importError(new Error('HTTP 429')).retryable,true);
  assert.equal(api.importError(new Error('invalid_grant')).retryable,false);
  assert.doesNotMatch(api.importError(new Error('access_token=SECRET')).message,/SECRET/);
});
