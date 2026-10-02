import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../supabase/functions/_shared/shipmentTracking.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {resolveShipmentTrackingLink,trackingCandidates}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
test('a future unknown carrier works from API metadata without a carrier mapping',async()=>{const result=await resolveShipmentTrackingLink({carrier_tracking_url:'https://future-carrier.example/t/opaque'},async()=>{throw Error('should not fetch')});assert.equal(result.url,'https://future-carrier.example/t/opaque')});
test('stored working carrier deep links are preserved',async()=>{const result=await resolveShipmentTrackingLink({tracking_url:'https://carrier.example/result?shipment=00123'},async()=>{throw Error('should not fetch')});assert.equal(result.url,'https://carrier.example/result?shipment=00123')});
test('a provider forwarding link is resolved without fetching or rewriting the carrier destination',async()=>{const calls=[];const result=await resolveShipmentTrackingLink({tracking_url:'https://tracking.sendcloud.sc/forward?code=000123'},async(url)=>{calls.push(url);return new Response(null,{status:302,headers:{location:'https://new-carrier.example/r/000123?signed=opaque'}})});assert.deepEqual(calls,['https://tracking.sendcloud.sc/forward?code=000123']);assert.equal(result.url,'https://new-carrier.example/r/000123?signed=opaque')});
test('provider-branded pages are never presented as carrier tracking',async()=>{const result=await resolveShipmentTrackingLink({trackUrl:'https://tracking.envia.com/000123'},async()=>new Response('<html>branded page</html>'));assert.equal(result.url,null);assert.equal(result.status,'unavailable')});
test('explicit carrier link inside provider metadata takes priority over its branded trackUrl',async()=>{const result=await resolveShipmentTrackingLink({trackUrl:'https://tracking.envia.com/000123',tracking:{carrierTrackingUrl:'https://carrier.example/t/000123'}},async()=>{throw Error('should not fetch')});assert.equal(result.url,'https://carrier.example/t/000123')});
test('missing metadata never synthesizes a URL from a carrier name',async()=>{assert.deepEqual(trackingCandidates({carrier:'anything',trackingNumber:'000123',url:'https://label.example/pdf'}),[]);assert.equal((await resolveShipmentTrackingLink({carrier:'anything',trackingNumber:'000123'})).status,'unavailable')});
test('unsafe redirect targets are rejected',async()=>{for(const url of ['http://127.0.0.1/private','https://169.254.169.254/latest/meta-data','javascript:alert(1)']){assert.equal((await resolveShipmentTrackingLink({tracking_url:'https://tracking.envia.com/000123'},async()=>new Response(null,{status:302,headers:{location:url}}))).url,null)}});
test('redirect loops stop after a bounded number of requests',async()=>{let count=0;const result=await resolveShipmentTrackingLink({tracking_url:'https://tracking.envia.com/000123'},async()=>{count++;return new Response(null,{status:302,headers:{location:'https://tracking.envia.com/000123'}})});assert.equal(result.url,null);assert.ok(count<=5)});
test('generic HTML meta redirects can resolve another carrier',async()=>{const result=await resolveShipmentTrackingLink({trackUrl:'https://tracking.envia.com/000123'},async()=>new Response('<meta http-equiv="refresh" content="0;url=https://carrier-new.example/track/000123">'));assert.equal(result.url,'https://carrier-new.example/track/000123')});

test('multiple parcels never select a link belonging to another tracking number',async()=>{
 const result=await resolveShipmentTrackingLink({data:[{trackingNumber:'other',trackingUrl:'https://carrier.example/other'},{trackingNumber:'000123',trackingUrl:'https://carrier.example/000123'}]},async()=>{throw Error('should not fetch')},'000123');
 assert.equal(result.url,'https://carrier.example/000123');
});
