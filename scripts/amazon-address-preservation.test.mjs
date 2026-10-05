import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/_shared/amazon/orders.ts','utf8');
test('redacted Amazon recipient preserves existing and original address fields',()=>{
 const match=source.match(/function mergeOperationalAddress[\s\S]*?\n}\n/);assert.ok(match,'missing address merge');
 const merge=vm.runInNewContext(ts.transpile(match[0],{target:ts.ScriptTarget.ES2022})+'\nmergeOperationalAddress',{clean:v=>String(v??'').trim()});
 const current={shipping_address:{name:'Edited',phone_number:'123'},raw_payload:{shipping_address:{name:'Original',address_line_1:'Street',email:'email'}}};
 const result=merge(current,{name:null,phone_number:null,address_line_1:null,city:'City'});
 assert.equal(result.name,'Edited');assert.equal(result.address_line_1,'Street');assert.equal(result.phone_number,'123');assert.equal(result.city,'City');
 const local={...current,raw_payload:{...current.raw_payload,_zenvia_local_shipping_updated_at:'now'}};
 assert.equal(merge(local,{name:'Remote'}).name,'Edited');
});
test('Amazon tracking is shown without a locally generated label',()=>{
 const ui=fs.readFileSync('src/pages/Orders.tsx','utf8');
 const match=ui.match(/function trackingState[\s\S]*?\n}\n/);assert.ok(match);
 const state=vm.runInNewContext(ts.transpile(match[0],{target:ts.ScriptTarget.ES2022})+'\ntrackingState',{hasShippingLabel:()=>false});
 assert.equal(state({trackingNumber:'TRACK',trackingStatusCode:'SHIPPED'}).label,'Enviado');
});
