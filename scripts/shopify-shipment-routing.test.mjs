import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
async function service(channel='shopify',fail=false){
 const source=await readFile('src/services/orders.ts','utf8');const calls=[];
 const statusExports={};vm.runInNewContext(ts.transpileModule(await readFile('src/services/orderStatus.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:statusExports});
 const supabase={from(){return {select(){return this},eq(){return this},async single(){return {data:{source_channel:channel},error:null}}}},functions:{async invoke(name,{body}){calls.push({name,body});if(name==='mrw-shipping')return {data:{trackingNumber:'MRW1',base64:'',mimeType:'application/pdf'},error:null};if(fail)return {data:{error:'Shopify rechazó el envío'},error:null};return {data:{ok:true},error:null}}}};
 const cacheExports={},snapshotExports={};
 vm.runInNewContext(ts.transpileModule(await readFile('src/services/viewCache.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:cacheExports});
 vm.runInNewContext(ts.transpileModule(await readFile('src/services/ordersSnapshot.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:snapshotExports,require:()=>cacheExports});
 const providerExports={};vm.runInNewContext(ts.transpileModule(await readFile('src/services/providerQuotes.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:providerExports,AbortController,setTimeout,clearTimeout});
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require(path){if(path==='./providerQuotes')return providerExports;if(path==='./ordersSnapshot')return snapshotExports;if(path==='./orderStatus')return statusExports;if(path==='./supabase')return {supabase};if(path==='./automationRules')return {loadAutomationRule:async()=>({enabled:true,config:{saveTracking:true,pushToMarketplace:true,markSent:true,downloadPdf:true,retryConfirmation:true}})};throw Error(path)},Response,console});return {api:exports,calls};
}
test('Shopify label confirmation uses Shopify endpoint and the existing tracking',async()=>{const {api,calls}=await service();await api.createOrderLabel('order1',{provider:'mrw',code:'test'});assert.equal(calls[1].name,'shopify-confirm-shipment');assert.equal(calls[1].body.orderId,'order1');assert.equal(calls[1].body.trackingOverride.trackingNumber,'MRW1');});
test('Amazon labels still confirm through Amazon endpoint',async()=>{const {api,calls}=await service('amazon');await api.createOrderLabel('order1',{provider:'mrw',code:'test'});assert.equal(calls[1].name,'amazon-confirm-shipment');});
test('failed confirmation keeps the generated label and returns a visible error',async()=>{const {api}=await service('shopify',true);const result=await api.createOrderLabel('order1',{provider:'mrw',code:'test'});assert.equal(result.trackingNumber,'MRW1');assert.match(result.confirmationError,/Shopify rechazó/);});
