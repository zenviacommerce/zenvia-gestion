import {pollShipment,TrackingError} from './adapters.ts';
import {isTerminal,reduceMovement,type Movement,type TrackingState} from './policy.ts';

export type TrackingReprocessApproval={orderId:string;version:string};
type Outcome='changes'|'nochange'|'errors'|'unavailable';
export type TrackingReprocessPreview={
 counts:{candidates:number;changes:number;nochange:number;errors:number;unavailable:number};
 truncated:boolean;
 groups:Array<{provider:string;previous:TrackingState|null;next:TrackingState|null;outcome:Outcome;count:number}>;
 approvedCandidates:TrackingReprocessApproval[];
};
// Read-only: neither seeding nor claiming is allowed during a preview. The RPC
// verifies the current order/account/workspace identity without exposing it here.
export async function previewTrackingReprocess(admin:any,request:typeof fetch=fetch,environmentCredentials:Record<string,any>={}):Promise<TrackingReprocessPreview>{
 const selected=await admin.rpc('tracking_reprocess_preview_candidates');
 if(selected.error||!Array.isArray(selected.data?.rows)||typeof selected.data?.truncated!=='boolean')throw Error('TRACKING_REPROCESS_PREVIEW_FAILED');
 const selectedRows=selected.data.rows;
 const rows=selectedRows.slice(0,1000).filter((row:any)=>!isTerminal(row.normalized_state));
 const result:TrackingReprocessPreview={counts:{candidates:rows.length,changes:0,nochange:0,errors:0,unavailable:0},truncated:selected.data.truncated,groups:[],approvedCandidates:[]};
 const accounts=new Map<string,{account:any;credentials:any}>(),paused=new Set<string>();
 const started=Date.now();
 for(const row of rows){
  let outcome:Outcome='unavailable',next:TrackingState|null=row.normalized_state;
  try{
   if(Date.now()-started>100000||paused.has(row.account_id)||(row.paused_until&&Date.parse(row.paused_until)>Date.now())||(row.failures>0&&row.next_poll_at&&Date.parse(row.next_poll_at)>Date.now()))throw new TrackingError('ACCOUNT_PAUSED');
   if(!accounts.has(row.account_id)){
    const account=await admin.from('integration_accounts').select('id,owner_id,provider,enabled,status,secret_id,credential_source,config').eq('id',row.account_id).eq('owner_id',row.owner_id).eq('provider',row.provider).eq('enabled',true).neq('status','disabled').single();
    if(account.error||!account.data)throw new TrackingError('ACCOUNT_UNAVAILABLE');
    const a=account.data;let credentials:any={...(a.credential_source==='environment'?environmentCredentials[row.provider]||{}:{})};
    if(a.secret_id){
     const stored=await admin.rpc('integration_read_secret',{p_secret_id:a.secret_id});
     if(stored.error)throw new TrackingError('ACCOUNT_CREDENTIALS_REQUIRED');
     try{credentials={...credentials,...JSON.parse(String(stored.data||'{}'))}}catch{throw new TrackingError('ACCOUNT_CREDENTIALS_INVALID')}
    }
    accounts.set(row.account_id,{account:{...a,provider:row.provider},credentials});
   }
   const {account,credentials}=accounts.get(row.account_id)!;
   const incoming=await pollShipment(account,credentials,row.tracking_number,request);
   const previous:Movement|null=row.observed_at?{state:row.normalized_state,code:row.raw_code||'',message:row.raw_message||'',eventAt:row.event_at,eventTimeRaw:row.raw_event_time,observedAt:row.observed_at,movementAt:row.movement_at}:null;
   const reduced=reduceMovement(previous,incoming,new Date().toISOString());
   next=reduced.state;
   // Observation/check timestamps are bookkeeping. Only provider movement
   // information determines whether an approved refresh would change tracking.
   const instant=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():value||null;
   const values=(movement:Movement)=>[movement.state,movement.code||'',movement.message||'',instant(movement.eventAt),movement.eventTimeRaw||null,instant(movement.movementAt)];
   const stored:Movement={state:row.normalized_state,code:row.raw_code||'',message:row.raw_message||'',eventAt:row.event_at,eventTimeRaw:row.raw_event_time,movementAt:row.movement_at};
   outcome=JSON.stringify(values(reduced))===JSON.stringify(values(stored))?'nochange':'changes';
   if(outcome==='changes')result.approvedCandidates.push({orderId:row.order_id,version:row.version});
  }catch(error){
   const unavailable=error instanceof TrackingError&&(/CREDENTIALS|PASSWORD_REQUIRED|ACCOUNT_|UNSUPPORTED/.test(error.code)||[401,403,429].includes(error.status));
   outcome=unavailable?'unavailable':'errors';
   // Stop this account immediately on authentication/rate-limit/configuration
   // failure, without writing its health or disclosing provider response text.
   if(unavailable||error instanceof Error&&/^MRW_TRACKING_(ACCESS_DENIED|REJECTED)$/.test(error.message))paused.add(row.account_id);
  }
  result.counts[outcome]++;
  const group=result.groups.find(g=>g.provider===row.provider&&g.previous===row.normalized_state&&g.next===next&&g.outcome===outcome);
  if(group)group.count++;else result.groups.push({provider:row.provider,previous:row.normalized_state,next,outcome,count:1});
 }
 return result;
}
// The caller keeps the preview approvals for the review step. This function
// never selects replacement IDs if concurrent changes invalidate an approval.
export async function applyTrackingReprocess(admin:any,approvedCandidates:TrackingReprocessApproval[],limit=25):Promise<{requested:number;enqueued:number}>{
 if(!Array.isArray(approvedCandidates)||!Number.isFinite(limit)||approvedCandidates.some(c=>!c||typeof c.orderId!=='string'||!c.orderId||typeof c.version!=='string'||!c.version))throw Error('TRACKING_REPROCESS_INVALID_APPROVAL');
 const bounded=Math.max(0,Math.min(25,Math.floor(limit)));
 const seen=new Set<string>();const selected=approvedCandidates.filter(c=>{if(seen.has(c.orderId))return false;seen.add(c.orderId);return true}).slice(0,bounded);
 if(!selected.length)return {requested:0,enqueued:0};
 const applied=await admin.rpc('tracking_reprocess_enqueue',{p_candidates:selected.map(c=>({order_id:c.orderId,version:c.version})),p_limit:bounded});
 if(applied.error)throw Error('TRACKING_REPROCESS_APPLY_FAILED');
 return {requested:selected.length,enqueued:Number(applied.data)||0};
}
