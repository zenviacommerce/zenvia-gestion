// @vitest-environment node
import {it,expect} from 'vitest';
import {build} from 'esbuild';
import vm from 'node:vm';
it('accepts an external shipment without a fabricated label date in the real Shopify handler',async()=>{
 const calls:string[]=[];let handler:any;
 const row={id:'demo',source_channel:'shopify',external_shipment:{notifySource:true},tracking_number:'SYNTHETIC',shopify_tracking_synced_at:'2026-10-22',shopify_tracking_synced_number:'SYNTHETIC'};
 const q:any={select(){return this},eq(){return this},maybeSingle:async()=>({data:row,error:null})};
 const admin={from:(table:string)=>{calls.push(table);return q}};
 const result=await build({entryPoints:['supabase/functions/shopify-confirm-shipment/index.ts'],bundle:true,write:false,platform:'node',format:'iife',plugins:[{name:'test-auth-boundary',setup(b){b.onResolve({filter:/_shared\//},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.includes('supabase')?`export const createAdminClient=()=>globalThis.admin;export const authenticateUser=async()=>({role:'admin',data_owner_id:'owner'});`:a.path.includes('shopifyAuth')?`export const shopifyError=e=>e.message;export const shopifyAccountCredentials=()=>{throw Error('No remote access')};export const shopifyStoredApplicationCredentials=()=>{};`:`export const confirmShopifyShipment=()=>{throw Error('No remote access')};`,loader:'js'}))}}]});
 vm.runInNewContext(result.outputFiles[0].text,{admin,Response,Request,console,Deno:{serve:(f:any)=>{handler=f}}});
 const response=await handler(new Request('https://fixture.test/',{method:'POST',body:JSON.stringify({action:'confirm_order_tracking',orderId:'demo'})}));
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,status:'already_synced'});expect(calls).toEqual(['fulfillment_orders']);
});
