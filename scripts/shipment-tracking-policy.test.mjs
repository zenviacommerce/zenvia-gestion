import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:['supabase/functions/_shared/tracking/policy.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {normalizeStatus:status,reduceMovement:reduce,nextPoll}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
test('Envia machine codes distinguish recipient delivery, return to origin and partial delivery',()=>{
 assert.equal(status('envia','3'),'delivered');assert.equal(status('envia','13'),'returned');assert.equal(status('envia','27'),'in_transit');
 assert.equal(status('envia','Delivered at Origin'),'returned');assert.equal(status('envia','5'),null);
});
test('Sendcloud transport statuses ignore claim and forced delivery, and distinguish cancellation requests',()=>{
 assert.equal(status('sendcloud','in_delivery'),'out_for_delivery');assert.equal(status('sendcloud','none','cancelled'),'cancelled');
 assert.equal(status('sendcloud','none','cancelling'),'exception');assert.equal(status('sendcloud','delivery_forced'),null);
 assert.equal(status('sendcloud','pup'),'exception');assert.equal(status('sendcloud','delivered','none','claim'),null);
});
test('legacy exact codes support route and incidents without free-text cancellation guesses',()=>{
 assert.equal(status('legacy','DRIVER_ON_ROUTE'),'out_for_delivery');assert.equal(status('legacy','DELIVERY_FAILED'),'exception');
 assert.equal(status('legacy','Information','cancelled'),null);
});
test('MRW uses exact documented descriptions while retaining unknown numerical codes',()=>{
 assert.equal(status('mrw','123','ENTREGADO'),'delivered');assert.equal(status('mrw','123','EN REPARTO'),'out_for_delivery');
 assert.equal(status('mrw','123','No cancelado'),null);
});
const event={state:'in_transit',code:'2',message:'Shipped',eventAt:'2026-10-20T10:00:00Z'};
test('unchanged observations do not advance the movement date',()=>{
 const first=reduce(null,event,'2026-10-21T10:00:00Z');const second=reduce(first,event,'2026-10-22T10:00:00Z');
 assert.equal(second.movementAt,'2026-10-20T10:00:00.000Z');assert.equal(second.observedAt,first.observedAt);
});
test('out of order events cannot regress the current state',()=>{
 const first=reduce(null,{...event,state:'delivered',eventAt:'2026-10-21T10:00:00Z'},'2026-10-21T11:00:00Z');
 assert.deepEqual(reduce(first,event,'2026-10-22T10:00:00Z'),first);
});
test('unknown information preserves last reliable state and does not fabricate event time',()=>{
 const first=reduce(null,event,'2026-10-21T10:00:00Z');const info=reduce(first,{state:null,code:'5',message:'Information',eventAt:null},'2026-10-22T10:00:00Z');
 assert.equal(info.state,'in_transit');assert.equal(info.eventAt,null);assert.equal(info.movementAt,first.movementAt);
 const detected=reduce(null,{...event,eventAt:null},'2026-10-22T10:00:00Z');assert.equal(detected.eventAt,null);assert.equal(detected.observedAt,'2026-10-22T10:00:00Z');
});
test('sondeo stops at terminals, backs off errors and reduces cadence on old active shipments',()=>{
 const now=Date.parse('2026-10-22T10:00:00Z');
 assert.equal(nextPoll('delivered',0,now,0),null);assert.equal(nextPoll('returned',0,now,0),null);
 assert.equal(nextPoll('out_for_delivery',0,now,0)-now,1800000);
 assert.ok(nextPoll('in_transit',8,now,0,0.5)-now<=21600000);
 assert.equal(nextPoll('in_transit',0,now,46)-now,86400000);
});
test('null and absent civil time are equivalent across successive database round trips',()=>{const first=reduce(null,event,'2026-10-21T10:00:00Z');const stored={...first,eventTimeRaw:null};const again=reduce(stored,event,'2026-10-22T10:00:00Z');assert.equal(again.observedAt,stored.observedAt)});
