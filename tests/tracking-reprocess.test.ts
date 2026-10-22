import {it,expect} from 'vitest';
import {previewTrackingReprocess,applyTrackingReprocess} from '../supabase/functions/_shared/tracking/reprocess';
function fixture(){
 const candidates=[['sendcloud','exception'],['sendcloud','out_for_delivery'],['envia','in_transit'],['mrw',null]].map(([provider,normalized_state],i)=>({order_id:'order-'+i,owner_id:'owner',account_id:provider,provider,normalized_state,identity_key:'identity',tracking_number:'PRIVATE-TRACK-'+i,version:'v'+i,observed_at:'2026-10-20T00:00:00Z',event_at:null,raw_code:provider==='envia'?'2':'old',raw_message:provider==='envia'?'2':'PRIVATE MESSAGE',movement_at:'2026-10-20T00:00:00Z',paused_until:null}));
 const calls:any[]=[];
 const admin={rpc:async(name:string,args?:any)=>{calls.push([name,args]);if(name==='tracking_reprocess_preview_candidates')return {data:{rows:candidates.slice(0,1000),truncated:candidates.length>1000},error:null};if(name==='integration_read_secret')return {data:JSON.stringify({publicKey:'SECRET',secretKey:'SECRET',token:'SECRET'}),error:null};return {data:1,error:null}},from:()=>{const q:any={select:()=>q,eq:()=>q,neq:()=>q,single:async()=>({data:{id:'account',provider:'',enabled:true,status:'active',credential_source:'environment',config:{environment:'production'}},error:null})};return q}};
 const request:typeof fetch=async(url,options)=>{calls.push(['HTTP',String(url)]);if(String(url).includes('sendcloud'))return new Response(JSON.stringify({events:[{event_type:'carrier',phase:'delivered',event_at:'2026-10-22T09:00:00Z',description:'PRIVATE RECIPIENT'}]}));return new Response(JSON.stringify({data:[{trackingNumber:JSON.parse(String(options?.body)).trackingNumbers[0],status:'2'}]}))};
 return {admin,request,calls,candidates};
}
it('previews read-only provider state counts, skips unconfigured MRW without HTTP and redacts output',async()=>{
 const f=fixture();const result=await previewTrackingReprocess(f.admin,f.request,{sendcloud:{publicKey:'SECRET',secretKey:'SECRET'},envia:{token:'SECRET'}});
 expect(result.counts).toEqual({candidates:4,changes:2,nochange:1,errors:0,unavailable:1});
 expect(result.groups).toContainEqual({provider:'sendcloud',previous:'exception',next:'delivered',outcome:'changes',count:1});
 expect(result.approvedCandidates).toEqual([{orderId:'order-0',version:'v0'},{orderId:'order-1',version:'v1'}]);
 expect(f.calls.filter(x=>x[0]==='HTTP')).toHaveLength(3);
 expect(f.calls.filter(x=>x[0]!=='HTTP').map(x=>x[0])).toEqual(['tracking_reprocess_preview_candidates']);
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|tracking_number|owner_id|identity_key/);
});
it('preserves reduction order and contains provider failures without leaking messages',async()=>{
 const f=fixture();f.candidates.splice(1);f.candidates[0].event_at='2026-10-23T00:00:00Z';
 const result=await previewTrackingReprocess(f.admin,f.request,{sendcloud:{publicKey:'s',secretKey:'s'}});expect(result.counts.nochange).toBe(1);
 const failed=await previewTrackingReprocess(f.admin,async()=>{throw Error('PRIVATE SECRET')},{sendcloud:{publicKey:'s',secretKey:'s'}});expect(failed.counts.errors).toBe(1);expect(JSON.stringify(failed)).not.toContain('PRIVATE');
});
it('respects account pauses and performs no provider HTTP for paused rows or terminal defense',async()=>{
 const f=fixture();f.candidates[0].paused_until='2999-01-01T00:00:00Z';f.candidates[1].normalized_state='delivered';
 const result=await previewTrackingReprocess(f.admin,f.request,{envia:{token:'s'}});expect(result.counts.candidates).toBe(3);expect(result.counts.unavailable).toBe(2);expect(f.calls.filter(x=>x[0]==='HTTP')).toHaveLength(1);
});
it('apply submits only unique approved versions, bounded to 25 and rejects invalid approval',async()=>{
 const f=fixture();const approved=Array.from({length:30},(_,i)=>({orderId:'id'+i,version:'v'+i}));
 expect(await applyTrackingReprocess(f.admin,approved,99)).toEqual({requested:25,enqueued:1});
 expect(f.calls).toEqual([['tracking_reprocess_enqueue',{p_candidates:approved.slice(0,25).map(x=>({order_id:x.orderId,version:x.version})),p_limit:25}]]);
 await expect(applyTrackingReprocess(f.admin,[{orderId:'',version:'v'}])).rejects.toThrow('TRACKING_REPROCESS_INVALID_APPROVAL');
});
it('approves significant movement metadata changes within the same normalized state',async()=>{
 const f=fixture();f.candidates.splice(1);f.candidates[0].normalized_state='delivered';
 // Use an active state: a new exception message/code/time must be refreshed too.
 f.candidates[0].normalized_state='exception';
 const response:typeof fetch=async()=>new Response(JSON.stringify({events:[{event_type:'carrier',phase:'in_delivery',exception:'delayed',event_at:'2026-10-22T09:00:00Z',description:'New movement'}]}));
 const result=await previewTrackingReprocess(f.admin,response,{sendcloud:{publicKey:'s',secretKey:'s'}});
 expect(result.counts.changes).toBe(1);expect(result.groups).toContainEqual({provider:'sendcloud',previous:'exception',next:'exception',outcome:'changes',count:1});expect(result.approvedCandidates).toEqual([{orderId:'order-0',version:'v0'}]);
});
it('ignores observation-only changes when reliable movement metadata is unchanged',async()=>{
 const f=fixture();f.candidates.splice(1);Object.assign(f.candidates[0],{raw_code:'in_delivery:delayed',raw_message:'Same',event_at:'2026-10-22T09:00:00Z',movement_at:'2026-10-22T09:00:00Z'});
 const response:typeof fetch=async()=>new Response(JSON.stringify({events:[{event_type:'carrier',phase:'in_delivery',exception:'delayed',event_at:'2026-10-22T09:00:00Z',description:'Same'}]}));
 const result=await previewTrackingReprocess(f.admin,response,{sendcloud:{publicKey:'s',secretKey:'s'}});expect(result.counts.nochange).toBe(1);expect(result.approvedCandidates).toEqual([]);
});

it('caps provider preview at 1000 candidates and reports truncation',async()=>{
 const f=fixture();f.candidates.splice(0,4,...Array.from({length:1001},(_,i)=>({order_id:'id'+i,owner_id:'owner',account_id:'mrw',provider:'mrw',normalized_state:null,version:'v'+i,tracking_number:'T'+i})));
 const result=await previewTrackingReprocess(f.admin,f.request,{});expect(result.counts.candidates).toBe(1000);expect(result.truncated).toBe(true);expect(f.calls.filter(c=>c[0]==='HTTP')).toHaveLength(0);
});
it.each([
 ['raw_code','different'],['raw_message','different'],['event_at','2026-10-21T09:00:00Z'],['raw_event_time','2026-10-21 09:00:00'],['movement_at','2026-10-21T09:00:00Z'],
])('detects same-state %s updates after policy reduction',async(field,value)=>{
 const f=fixture();f.candidates.splice(1);Object.assign(f.candidates[0],{raw_code:'in_delivery:delayed',raw_message:'Same',event_at:'2026-10-22T09:00:00Z',movement_at:'2026-10-22T09:00:00Z',[field]:value});
 const response:typeof fetch=async()=>new Response(JSON.stringify({events:[{event_type:'carrier',phase:'in_delivery',exception:'delayed',event_at:'2026-10-22T09:00:00Z',description:'Same'}]}));
 const result=await previewTrackingReprocess(f.admin,response,{sendcloud:{publicKey:'s',secretKey:'s'}});expect(result.counts.changes).toBe(1);expect(result.approvedCandidates).toHaveLength(1);
});
