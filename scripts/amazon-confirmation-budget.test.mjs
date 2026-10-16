import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
test('verification batch stops at elapsed budget instead of consuming every queued order',async()=>{
 let now=1000,executions=0;
 const exports={};
 const order={id:'order',owner_id:'owner',source_channel:'amazon',order_id:'123-1234567-1234567',tracking_number:'tracking',carrier_code:'MRW'};
 const rows={amazon_orders:[{amazon_account_id:'account',marketplace_id:'ES',fulfillment_channel:'MFN'}],amazon_order_items:[{order_item_id:'item',quantity_ordered:1}],amazon_confirmation_operations:null};
 const admin={from(table){const data=rows[table];return {select(){return this},eq(){return this},gt(){return this},limit(){return this},maybeSingle:async()=>({data,error:null}),then(resolve){return Promise.resolve({data,error:null}).then(resolve)}}},rpc:async()=>({data:[order,order],error:null})};
 const deps={loadAmazonSpApiCredentials:async()=>({}),sanitizeAmazonError:String,executeAmazonConfirmation:async()=>{executions++;now+=30_000;return {state:'pending_verification'}}};
 class Clock extends Date{static now(){return now}}
 const source=readFileSync(new URL('../supabase/functions/_shared/amazon/shipment-confirmation.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>deps,Date:Clock,crypto:globalThis.crypto,AbortSignal,Proxy});
 await exports.retryPendingAmazonTracking(admin,'owner',10,false,20_000);
 assert.equal(executions,1);
});
