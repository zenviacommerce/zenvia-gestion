import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transform} from 'esbuild';
const source=await readFile(new URL('../supabase/functions/envia-shipping/index.ts',import.meta.url),'utf8');const part=source.slice(source.indexOf('async function quoteAccount('),source.indexOf('function trackingOf('));const code=(await transform(part,{loader:'ts'})).code;
test('each Envia rate request supplies the required carrier',async()=>{
 const calls=[];const quote=new Function('credentials','sender','destination','packageFor','validatePayload','geocodeAddress','clean','withTimeout','enviaJson','asRows','normalizeRate','listCarriers',code+';return quoteAccount;')(
 async()=>({shipBase:'https://example.test',token:'test'}),()=>({country:'ES',state:'CA'}),()=>({country:'PT',state:'PT'}),()=>({weight:2}),()=>{},async a=>a,v=>String(v??''),p=>p,async(u,t,init)=>{const req=JSON.parse(init.body);calls.push(req);if(!req.shipment.carrier)throw Error('Required property missing: carrier');return [{carrierCode:req.shipment.carrier,code:'service',price:4}]},v=>v,v=>v,async()=>['mrw','correosexpress']);
 const result=await quote({}, {}, {}, {shipping:{}});
 assert.equal(result.options.length,2);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.shipment.carrier));
});
