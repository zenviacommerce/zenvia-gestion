import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../shared/imports/observer.ts').catch(()=>({}));
test('ignores an old tenant response after a new identity is selected',()=>{
 assert.equal(typeof api.ImportRequestGuard,'function');const guard=new api.ImportRequestGuard('one');const ticket=guard.ticket();guard.change('two');assert.equal(guard.accepts(ticket),false);assert.equal(guard.accepts(guard.ticket()),true);
});
test('uploads cannot advertise background processing before server acknowledges task',()=>{
 assert.equal(typeof api.importSubmissionLabel,'function');assert.equal(api.importSubmissionLabel('uploading'),'Subiendo archivos');assert.equal(api.importSubmissionLabel('enqueuing'),'Registrando importación');assert.equal(api.importSubmissionLabel('accepted'),'En segundo plano');
});
test('reopening a review uses saved candidate and refuses stale versions',()=>{
 assert.equal(typeof api.reviewPayload,'function');const item={id:'item',job_id:'job',version:4,status:'waiting_review',result:{candidate:{total:121}}};
 assert.deepEqual(api.reviewPayload(item,{total:123}),{action:'review',jobId:'job',itemId:'item',version:4,candidate:{total:123}});
 assert.throws(()=>api.reviewPayload({...item,status:'imported'},{}));
});
test('a slower request from the same tenant cannot downgrade fresh progress',()=>{const guard=new api.ImportRequestGuard('one');const first=guard.ticket(),second=guard.ticket();assert.equal(guard.accepts(first),false);assert.equal(guard.accepts(second),true)});
