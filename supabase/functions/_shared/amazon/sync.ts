import { sanitizeAmazonError } from './http.ts';

export const INITIAL_SYNC_FROM='2026-01-01T00:00:00Z';
export const BACKFILL_WINDOW_DAYS=7;
export const OVERLAP_HOURS=6;
export const CURRENT_SYNC_MAX_LOOKBACK_HOURS=7*24;

type Mode='initial'|'hourly'|'manual'|'reconcile';
export type AmazonSyncSource='orders'|'finances'|'inventory';
type Source=AmazonSyncSource;
const ALL_SYNC_SOURCES:AmazonSyncSource[]=['orders','finances','inventory'];
function enabledSourceSet(enabledSources?:AmazonSyncSource[]){return new Set(enabledSources===undefined?ALL_SYNC_SOURCES:enabledSources);}
type Account={id:string;owner_id:string;initial_sync_from?:string|null;region?:string|null};
type Marketplace={marketplace_id:string;active?:boolean};
// Supported by the existing EU SP-API endpoint; reject other regions.
const EU_MARKETPLACE_IDS=new Set(['A1RKKUPIHCS9HS','A13V1IB3VIYZZH','A1PA6795UKMFR9','APJ6JRA9NG5V4','A1805IZSGTT6HS','A2NODRKZP88ZB9','A1C3SOZRARQ6R3','AMEN7PMS3EDWL','A28R8C7NBKEWEA','A1F83G8C2ARO7P']);

function iso(value:Date|string){return new Date(value).toISOString();}
function plusDays(value:Date,days:number){const next=new Date(value);next.setUTCDate(next.getUTCDate()+days);return next;}
function minusHours(value:Date,hours:number){const next=new Date(value);next.setUTCHours(next.getUTCHours()-hours);return next;}
function hourKey(value:Date){const d=new Date(value);d.setUTCMinutes(0,0,0);return d.toISOString();}

function jobKey(source:Source,marketplaceId:string|null,from:string|null,to:string|null,mode:Mode){
  return [mode,source,marketplaceId||'global',from||'current',to||'current'].join(':');
}

async function insertJobs(admin:any,rows:any[]){
  for(let offset=0;offset<rows.length;offset+=200){
    const batch=rows.slice(offset,offset+200);
    const {error}=await admin.from('amazon_sync_jobs').upsert(batch,{onConflict:'owner_id,amazon_account_id,job_key',ignoreDuplicates:true});
    if(error)throw error;
  }
  return rows.length;
}

export async function enqueueInitialBackfill(admin:any,account:Account,marketplaces:Marketplace[],until=new Date(),enabledSources?:AmazonSyncSource[]){
  const start=new Date(account.initial_sync_from||INITIAL_SYNC_FROM);
  const end=new Date(until);
  const rows:any[]=[];
  const enabled=enabledSourceSet(enabledSources);
  for(const marketplace of marketplaces.filter(item=>item.active!==false)){
    let cursor=new Date(start);
    while(cursor<end){
      const windowEnd=plusDays(cursor,BACKFILL_WINDOW_DAYS);
      const clipped=windowEnd>end?end:windowEnd;
      for(const source of ['orders','finances'] as const){
        if(!enabled.has(source))continue;
        const from=iso(cursor),to=iso(clipped);
        rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey(source,marketplace.marketplace_id,from,to,'initial'),source,marketplace_id:marketplace.marketplace_id,scope_key:marketplace.marketplace_id,window_from:from,window_to:to,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode:'initial'}});
      }
      cursor=clipped;
    }
    if(enabled.has('inventory'))rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey('inventory',marketplace.marketplace_id,null,hourKey(end),'initial'),source:'inventory',marketplace_id:marketplace.marketplace_id,scope_key:marketplace.marketplace_id,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode:'initial',snapshot:'current'}});
  }
  await insertJobs(admin,rows);
  return rows;
}

export async function enqueueHourlySync(admin:any,account:Account,marketplaces:Marketplace[],mode:Extract<Mode,'hourly'|'manual'|'reconcile'>='hourly',now=new Date(),enabledSources?:AmazonSyncSource[]){
  const ids=[...new Set(marketplaces.filter(item=>item.active!==false).map(item=>item.marketplace_id))].sort();
  const enabled=enabledSourceSet(enabledSources);
  if(enabled.has('orders')&&((account.region&&account.region!=='EU')||ids.some(id=>!EU_MARKETPLACE_IDS.has(id))))throw new Error('Unsupported Amazon marketplace region.');
  const {data:states,error}=await admin.from('amazon_sync_state')
    .select('source,scope_key,marketplace_id,high_water_mark')
    .eq('owner_id',account.owner_id)
    .eq('amazon_account_id',account.id);
  if(error)throw error;
  const stateMap=new Map((states||[]).map((state:any)=>[`${state.source}:${state.scope_key}`,state]));
  const rows:any[]=[];
  if(enabled.has('orders')&&ids.length){
    const bucket=new Date(Math.floor(now.getTime()/(5*60*1000))*(5*60*1000));
    const baselines=ids.map(id=>{const state:any=stateMap.get(`orders:${id}`);return state?.high_water_mark?new Date(state.high_water_mark):minusHours(now,OVERLAP_HOURS);});
    const baseline=new Date(Math.min(...baselines.map(date=>date.getTime())));
    const overlapStart=minusHours(baseline,OVERLAP_HOURS);
    const freshnessFloor=minusHours(now,CURRENT_SYNC_MAX_LOOKBACK_HOURS);
    const from=iso(overlapStart<freshnessFloor?freshnessFloor:overlapStart);
    rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:`incremental:orders:region:EU:${bucket.toISOString()}`,source:'orders',marketplace_id:null,scope_key:'region:EU',window_from:from,window_to:iso(now),status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode,region:'EU',marketplace_ids:ids}});
  }
  for(const marketplaceId of ids){
    for(const source of ['finances'] as const){
      if(!enabled.has(source))continue;
      const state:any=stateMap.get(`${source}:${marketplaceId}`);
      const baseline=state?.high_water_mark?new Date(state.high_water_mark):minusHours(now,OVERLAP_HOURS);
      // Finance movements may be published late with an older posting timestamp.
      // Replay a wider window; transaction keys and atomic upserts are idempotent.
      const overlapStart=minusHours(baseline,24);
      const freshnessFloor=minusHours(now,CURRENT_SYNC_MAX_LOOKBACK_HOURS);
      const boundedStart=overlapStart<freshnessFloor?freshnessFloor:overlapStart;
      const from=iso(boundedStart),to=iso(now);
      rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey(source,marketplaceId,from,to,mode),source,marketplace_id:marketplaceId,scope_key:marketplaceId,window_from:from,window_to:to,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode,high_water_mark:state?.high_water_mark||null}});
    }
    if(enabled.has('inventory'))rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey('inventory',marketplaceId,null,hourKey(now),mode),source:'inventory',marketplace_id:marketplaceId,scope_key:marketplaceId,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode,snapshot:'current'}});
  }
  await insertJobs(admin,rows);
  return rows;
}

export async function markJobSuccess(admin:any,job:any,rowsProcessed:number){
  const finished=new Date().toISOString();
  const durationMs=job.started_at?Math.max(0,Date.now()-new Date(job.started_at).getTime()):null;
  const {data:completed,error}=await admin.from('amazon_sync_jobs').update({status:'success',rows_processed:rowsProcessed,finished_at:finished,locked_at:null,last_error:null,updated_at:finished,duration_ms:durationMs,lease_holder_id:null}).eq('id',job.id).eq('status','running').eq('lease_holder_id',job.lease_holder_id).select('id');
  if(error)throw error;
  if(!completed?.length)throw new Error('Job lease ownership lost before success update');

  const grouped=job.source==='orders'&&Array.isArray(job.payload?.marketplace_ids);
  const scopes:string[]=grouped?job.payload.marketplace_ids:[job.scope_key||job.marketplace_id||'global'];
  const candidateHighWater=new Date(job.source==='orders'?(job.orders_completed_before||job.window_to||finished):(job.window_to||finished));
  for(const scopeKey of scopes){
    const {data:existingState,error:existingStateError}=await admin.from('amazon_sync_state')
      .select('high_water_mark')
      .eq('owner_id',job.owner_id)
      .eq('amazon_account_id',job.amazon_account_id)
      .eq('source',job.source)
      .eq('scope_key',scopeKey)
      .maybeSingle();
    if(existingStateError)throw existingStateError;

    let highWater=candidateHighWater.toISOString();
    if(existingState?.high_water_mark){
      const currentHighWater=new Date(existingState.high_water_mark);
      if(!Number.isNaN(currentHighWater.getTime())&&currentHighWater>candidateHighWater){
        highWater=currentHighWater.toISOString();
      }
    }

    const {error:stateError}=await admin.from('amazon_sync_state').upsert({owner_id:job.owner_id,amazon_account_id:job.amazon_account_id,source:job.source,scope_key:scopeKey,marketplace_id:grouped?scopeKey:job.marketplace_id||null,high_water_mark:highWater,last_successful_at:finished,checkpoint:{last_job_id:job.id,rows_processed:rowsProcessed},updated_at:finished},{onConflict:'owner_id,amazon_account_id,source,scope_key'});
    if(stateError)throw stateError;

  }
  const {error:accountError}=await admin.from('amazon_accounts').update({last_successful_sync_at:finished,updated_at:finished})
    .eq('id',job.amazon_account_id)
    .eq('owner_id',job.owner_id);
  if(accountError)throw accountError;
}

export async function markJobFailed(admin:any,job:any,errorValue:unknown){
  const attempts=Number(job.attempts)||1,maxAttempts=Number(job.max_attempts)||5;
  const terminal=attempts>=maxAttempts;
  const delaySeconds=Math.min(3600,Math.max(60,60*(2**Math.max(0,attempts-1))));
  const availableAt=new Date(Date.now()+delaySeconds*1000).toISOString();
  const errorMessage=sanitizeAmazonError(errorValue instanceof Error?errorValue.message:errorValue);
  const durationMs=job.started_at?Math.max(0,Date.now()-new Date(job.started_at).getTime()):null;
  const {data:updated,error}=await admin.from('amazon_sync_jobs').update({status:terminal?'failed':'queued',available_at:availableAt,locked_at:null,lease_holder_id:null,finished_at:terminal?new Date().toISOString():null,last_error:errorMessage,updated_at:new Date().toISOString(),attempts,duration_ms:durationMs}).eq('id',job.id).eq('status','running').eq('lease_holder_id',job.lease_holder_id).select('id');
  if(error)throw error;
  if(!updated?.length)throw new Error('Job lease ownership lost before failure update');
}
