import {it,expect} from 'vitest';
import {runProviderDiagnostic} from '../supabase/functions/_shared/tracking/providerDiagnostic';
function fixture(count=2){
 const calls:any[]=[],queries:any[]=[];const account={id:'sc',owner_id:'owner',provider:'sendcloud',enabled:true,status:'active',secret_id:'vault',credential_source:'vault'};
 const rows:any={integration_accounts:[account],fulfillment_orders:Array.from({length:count},(_,i)=>({id:'order'+i,owner_id:'owner',shipping_provider:i?'sendcloud':null,shipping_integration_account_id:i?'envia':'sc',tracking_number:'T'+i,tracking_status_code:null,pii_purged_at:null,label_cancelled_at:null,sendcloud_parcel_id:null})),shipment_tracking_state:[]};
 rows.fulfillment_orders.push({id:'foreign',owner_id:'other',shipping_provider:'sendcloud',shipping_integration_account_id:'sc',tracking_number:'PRIVATE-FOREIGN',pii_purged_at:null,label_cancelled_at:null},{id:'terminal',owner_id:'owner',shipping_provider:'sendcloud',shipping_integration_account_id:'sc',tracking_number:'TERMINAL',tracking_status_code:'DELIVERED',pii_purged_at:null,label_cancelled_at:null});
 const admin={from(table:string){const filters:any[]=[];let cap=Infinity;const q:any={select:()=>q,eq(k:string,v:any){queries.push([table,k,v]);filters.push((r:any)=>r[k]===v);return q},neq(k:string,v:any){filters.push((r:any)=>r[k]!==v);return q},is(k:string,v:any){filters.push((r:any)=>r[k]===v);return q},not:()=>q,or(value:string){queries.push([table,'or',value]);filters.push((r:any)=>r.shipping_provider==='sendcloud'||r.shipping_integration_account_id==='sc');return q},order:()=>q,limit(n:number){cap=n;return q},in(k:string,values:any[]){filters.push((r:any)=>values.includes(r[k]));return q},then(resolve:any){return Promise.resolve({data:rows[table].filter((r:any)=>filters.every(f=>f(r))).slice(0,cap),error:null}).then(resolve)}};return q},rpc:async(name:string)=>{expect(name).toBe('integration_read_secret');return {data:JSON.stringify({publicKey:'PUBLIC-SECRET',secretKey:'SECRET-SENTINEL'}),error:null}}};
 const request:typeof fetch=async(url,options)=>{calls.push({url:String(url),options});return String(url).includes('subscriptions')?Response.json({data:[{id:1,event_type:'parcels.event.created',is_active:true,connection_id:2,auth_config:{token:'SECRET-SENTINEL'},recipient:'PRIVATE'}]}):Response.json({data:{recipient:'PRIVATE',events:[{event_type:'carrier',phase:'in_transit',event_at:'2026-10-20T00:00:00Z',description:'Old'},{event_type:'claim',phase:'claim_opened',event_at:'2026-10-22T00:00:00Z',description:'Latest SECRET-SENTINEL',address:'PRIVATE'}]}})};
 return {admin,request,calls,queries,rows};
}
it('diagnoses same-owner active legacy and explicit-provider mismatches with GET-only whitelisted events',async()=>{
 const f=fixture();const result=await runProviderDiagnostic(f.admin,f.request,{});expect(result.accounts[0].probes).toHaveLength(2);
 expect(result.accounts[0].probes[1]).toMatchObject({orderId:'order0',legacyWithoutParcel:true,missingTrackingState:true});expect(result.accounts[0].probes[0]).toMatchObject({orderId:'order1',accountMismatch:true});
 expect(result.accounts[0].probes[0].events.map((e:any)=>e.type)).toEqual(['claim','carrier']);
 expect(result.accounts[0].subscriptions.items).toEqual([{id:1,event_type:'parcels.event.created',is_active:true,connection_id:2}]);
 expect(JSON.stringify(result)).not.toMatch(/SECRET-SENTINEL|PUBLIC-SECRET|PRIVATE|recipient|auth_config|address/);
 expect(f.calls.every(c=>!c.options.method||c.options.method==='GET')).toBe(true);expect(f.calls.some(c=>c.url.includes('TERMINAL'))).toBe(false);
 expect(f.queries).toContainEqual(['fulfillment_orders','owner_id','owner']);expect(f.queries).toContainEqual(['fulfillment_orders','or','shipping_provider.eq.sendcloud,shipping_integration_account_id.eq.sc']);
});
it('caps all diagnostic HTTP requests at 25 and each event list at eight',async()=>{
 const f=fixture(100);const result=await runProviderDiagnostic(f.admin,f.request,{});expect(f.calls).toHaveLength(25);expect(result.httpRequests).toBe(25);expect(result.truncated).toBe(true);
});
it('stops immediately for account 401/403/429 without exposing response bodies',async()=>{
 for(const status of [401,403,429]){const f=fixture();let count=0;const result=await runProviderDiagnostic(f.admin,async()=>{count++;return new Response('PRIVATE SECRET-SENTINEL',{status})},{});expect(count).toBe(1);expect(result.accounts[0].subscriptions.httpStatus).toBe(status);expect(JSON.stringify(result)).not.toMatch(/SECRET-SENTINEL|PRIVATE/)}
});
it('never uses an ambiguous same-owner account to probe a linked-provider mismatch',async()=>{
 const f=fixture();f.rows.integration_accounts.push({...f.rows.integration_accounts[0],id:'sc2'});const result=await runProviderDiagnostic(f.admin,f.request,{});expect(result.accounts.flatMap((a:any)=>a.probes).some((p:any)=>p.orderId==='order1')).toBe(false);
});

it('excludes normalized terminals even with legacy SHIPPED source and limits safe summaries to eight',async()=>{
 const f=fixture();f.rows.shipment_tracking_state.push({order_id:'order1',owner_id:'owner',normalized_state:'delivered'});
 const result=await runProviderDiagnostic(f.admin,async(url,options)=>String(url).includes('subscriptions')?Response.json({data:[]}):Response.json({events:Array.from({length:10},(_,i)=>({event_type:i%2?'carrier':'claim',event_at:'2026-10-'+String(10+i).padStart(2,'0')+'T00:00:00Z',description:'x'.repeat(300),recipient:'PRIVATE'}))}),{});
 expect(result.accounts[0].probes.map((p:any)=>p.orderId)).toEqual(['order0']);expect(result.accounts[0].probes[0].events).toHaveLength(8);expect(result.accounts[0].probes[0].events[0].event_at).toBe('2026-10-19T00:00:00Z');expect(result.accounts[0].probes[0].events.every((e:any)=>e.description.length===160)).toBe(true);expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
