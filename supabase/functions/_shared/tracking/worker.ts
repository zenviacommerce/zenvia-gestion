import {pollShipment,TrackingError} from './adapters.ts';
import {reduceMovement,nextPoll,type Movement} from './policy.ts';
export async function runTrackingWorker(admin:any,request:typeof fetch=fetch,environmentCredentials:Record<string,any>={}){
 const {data:settings,error:settingsError}=await admin.from('shipment_tracking_settings').select('enabled,mode').eq('singleton',true).single();
 if(settingsError)throw Error('TRACKING_SETTINGS_UNAVAILABLE');
 if(!settings?.enabled)return {skipped:true};
 if(settings.mode!=='shadow'&&settings.mode!=='active')throw Error('TRACKING_MODE_NOT_APPROVED');
 const run=crypto.randomUUID(),start=Date.now();
 const checked=async(result:any)=>{if(result.error)throw Error('TRACKING_PERSIST_FAILED');return result.data};
 await checked(await admin.from('shipment_tracking_runs').insert({id:run}));
 let claimed=0,succeeded=0,failed=0;
 try{
  await checked(await admin.rpc('tracking_seed_shadow'));
  const jobs=await checked(await admin.rpc('tracking_claim',{p_run:run,p_limit:25}));claimed=jobs?.length||0;
  const accounts=new Map<string,any>();const paused=new Set<string>();
  // One queue per account is sequential: 401/403 immediately stops that account.
  for(const job of jobs||[]){if(!accounts.has(job.account_id))accounts.set(job.account_id,{jobs:[],account:null,credentials:null});accounts.get(job.account_id).jobs.push(job)}
  const entries=[...accounts.entries()];let cursor=0;
  async function lane(){while(cursor<entries.length){const [accountId,group]=entries[cursor++];
   for(const job of group.jobs){
    if(Date.now()-start>100000)break;
    let event:Movement|null=null,errorCode:string|null=null,warningCode:string|null=null,providerStatus=0,retryAfter=0;
    try{
     if(paused.has(accountId))throw new TrackingError('ACCOUNT_PAUSED');
     if(!group.account){
      group.account=await checked(await admin.from('integration_accounts').select('id,owner_id,provider,enabled,status,secret_id,credential_source,config').eq('id',accountId).eq('owner_id',job.owner_id).eq('provider',job.provider).eq('enabled',true).neq('status','disabled').single());
      if(!group.account?.secret_id&&group.account.credential_source!=='environment')throw new TrackingError('ACCOUNT_CREDENTIALS_REQUIRED');
      const stored=group.account.secret_id?await checked(await admin.rpc('integration_read_secret',{p_secret_id:group.account.secret_id})):'{}';
      try{group.credentials={...(group.account.credential_source==='environment'?environmentCredentials[job.provider]||{}:{}),...JSON.parse(String(stored||'{}'))}}catch{throw new TrackingError('ACCOUNT_CREDENTIALS_INVALID')}
     }
     const incoming=await pollShipment(group.account,group.credentials,job.tracking_number,request);
     const warnings=[...new Set([incoming.warningCode,...(incoming.history||[]).map(item=>item.warningCode)].filter((code):code is string=>Boolean(code&&/^MRW_UNKNOWN_STATUS_(?:\d{1,4}|UNKNOWN)$/.test(code))))];
     warningCode=warnings[0]||null;
     for(const code of warnings)console.warn('shipment_tracking_warning',{provider:job.provider,code});
     const previous=job.observed_at?{state:job.normalized_state,code:job.raw_code||'',message:job.raw_message||'',eventAt:job.event_at,eventTimeRaw:job.raw_event_time,observedAt:job.observed_at,movementAt:job.movement_at}:null;
     event=reduceMovement(previous,incoming,new Date().toISOString());
     await checked(await admin.from('shipment_tracking_account_health').upsert({account_id:accountId,owner_id:job.owner_id,provider:job.provider,last_success_at:new Date().toISOString(),last_error:warningCode,paused_until:null}));
    }catch(error){
     failed++;errorCode=error instanceof TrackingError?error.code:error instanceof Error&&/^(TRACKING_|MRW_)/.test(error.message)?error.message:'TRACKING_PROVIDER_UNAVAILABLE';
     if(error instanceof TrackingError){providerStatus=error.status;retryAfter=error.retryAfterSeconds;}
     if(providerStatus===401||providerStatus===403||providerStatus===429||/CREDENTIALS|PASSWORD_REQUIRED|REJECTED|ACCESS_DENIED/.test(errorCode)){
      paused.add(accountId);
      await checked(await admin.from('shipment_tracking_account_health').upsert({account_id:accountId,owner_id:job.owner_id,provider:job.provider,last_error:errorCode,paused_until:new Date(Date.now()+(providerStatus===429?Math.max(300000,Math.min(86400000,retryAfter*1000)):6*3600000)).toISOString()}));
     }
    }
    const age=(Date.now()-Date.parse(job.label_created_at||new Date().toISOString()))/86400000;
    let next=nextPoll(event?.state||job.normalized_state,errorCode?job.failures+1:0,Date.now(),age);
    if(next&&retryAfter)next=Math.max(next,Date.now()+Math.min(86400,retryAfter)*1000);
    const applied=await checked(await admin.rpc('tracking_finish',{p_order:job.order_id,p_run:run,p_identity:job.identity_key,p_event:event,p_next:next?new Date(next).toISOString():null,p_error:errorCode||warningCode}));
    if(!errorCode&&applied)succeeded++;
    console.info('shipment_tracking',{run,provider:job.provider,account:accountId,owner:job.owner_id,result:errorCode||'OK',http:providerStatus,applied});
   }
  }}
  await Promise.all(Array.from({length:Math.min(3,entries.length)},()=>lane()));
  await checked(await admin.from('shipment_tracking_runs').update({completed_at:new Date().toISOString(),claimed,succeeded,failed}).eq('id',run));
  return {run,mode:settings.mode,claimed,succeeded,failed};
 }catch{
  await admin.from('shipment_tracking_runs').update({completed_at:new Date().toISOString(),claimed,succeeded,failed,error:'TRACKING_WORKER_FAILED'}).eq('id',run);
  throw Error('TRACKING_WORKER_FAILED');
 }
}
