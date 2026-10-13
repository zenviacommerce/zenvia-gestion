import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const source=fs.readFileSync(new URL('../supabase/functions/_shared/recipientFallback.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const m=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('Sendcloud and Envia normalize ecommerce recipients with exact Amazon references',()=>{
 assert.equal(m.recipientCandidate('sendcloud',{id:1,order_id:'123-1234567-1234567',shipping_address:{name:'Ana',address_line_1:'Calle 1',city:'Cadiz',postal_code:'11001',country_code:'ES'}}).address.name,'Ana');
 const e=m.recipientCandidate('envia',{id:2,order:{identifier:'123-1234567-1234567'},customer:{name:'Ana',email:'ana@example.com'},shipment_data:{destination:{street:'Calle',number:'1',city:'Cadiz',postalCode:'11001',country:'ES'}}});assert.equal(e.reference,'123-1234567-1234567');assert.equal(e.address.address_line_1,'Calle');
 assert.equal(m.recipientCandidate('sendcloud',{order_number:'1018',shipping_address:{name:'Ana'}}),null);
});
test('source accounts are active, supported and scoped to the same tenant',()=>{
 const amazon={owner_id:'a',config:{recipientSourceAccountId:'transport'}};
 const source={id:'transport',owner_id:'a',provider:'envia',enabled:true,status:'connected'};
 assert.equal(m.recipientSource(amazon,[source]).id,'transport');assert.equal(m.recipientSource(amazon,[{...source,owner_id:'b'}]),null);assert.equal(m.recipientSource(amazon,[{...source,enabled:false}]),null);assert.equal(m.recipientSource({...amazon,config:{}},[source]),null);
});
test('fallback only fills missing fields and respects local edits',()=>{
 const current={shipping_address:{name:'Amazon name',postal_code:'11001'},customer_name:'Amazon name',raw_payload:{}};
 const patch=m.recipientPatch(current,{name:'External name',postal_code:'11001',address_line_1:'Calle 1',city:'Cadiz',country_code:'ES'},'transport','sendcloud');
 assert.equal(patch.shipping_address.name,'Amazon name');assert.equal(patch.shipping_address.postal_code,'11001');assert.equal(patch.shipping_address.address_line_1,'Calle 1');
 assert.equal(m.recipientPatch({...current,raw_payload:{_zenvia_local_shipping_updated_at:'now'}},{name:'Ana'},'transport','sendcloud'),null);
});
test('no-op enrichment does not update an already complete recipient',()=>{
 assert.equal(m.recipientPatch({shipping_address:{name:'Ana'},customer_name:'Ana',raw_payload:{}},{name:'Ana'},'t','sendcloud'),null);
});
