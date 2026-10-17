import { authenticateAdminUser, createAdminClient, getAdminKey } from '../_shared/amazon/supabase.ts';
import { ensureAmazonAccountAndMarketplaces } from '../_shared/amazon/marketplaces.ts';
import { enqueueHourlySync } from '../_shared/amazon/sync.ts';
import { filterAutomaticMarketplaces, loadAmazonAutomaticSyncSettings } from '../_shared/amazon/settings.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});}


async function kickWorker(){
  const url=(Deno.env.get('SUPABASE_URL')||'').trim();
  const key=getAdminKey();
  if(!url||!key)return false;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8_000);
  try{
    const result=await fetch(`${url.replace(/\/$/,'')}/functions/v1/amazon-sync-worker`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':key},
      body:'{}',
      signal:controller.signal,
    });
    return result.ok;
  }catch{return false;}
  finally{clearTimeout(timeout);}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  if(Deno.env.get('AMAZON_SYNC_MANUAL_PAUSED')==='true'){
    return response({error:'Sincronización de Amazon pausada por mantenimiento.'},503);
  }
  const admin=createAdminClient();
  try{
    const caller=await authenticateAdminUser(req,admin);
    if(caller.role!=='admin')return response({error:'Solo un administrador puede sincronizar Amazon.'},403);
    const body=await req.json().catch(()=>({}));
    const requestedId=String(body?.integrationAccountId||'').trim();

    let integrationIds:Array<string|null>=[];
    if(requestedId){
      const {data,error}=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id).eq('provider','amazon').eq('id',requestedId).neq('status','disabled').maybeSingle();
      if(error)throw error;
      if(!data)return response({error:'La cuenta de Amazon seleccionada no está disponible.'},404);
      integrationIds=[data.id];
    }else{
      const {data,error}=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id).eq('provider','amazon').eq('enabled',true).neq('status','disabled').order('is_default',{ascending:false});
      if(error)throw error;
      integrationIds=(data||[]).map((row:any)=>String(row.id));
      if(!integrationIds.length)return response({error:'Amazon todavía no está conectado para este workspace.'},409);
    }

    // Recover historical failed windows as bounded daily slices rather than requeueing
    // hundreds of obsolete hourly jobs. Upserts are idempotent.
    let recoveryJobs=0;
    if(body?.recoverFailed!==false && body?.ordersOnly!==true){
      const {data:failed,error:failedError}=await admin.from('amazon_sync_jobs')
        .select('owner_id,amazon_account_id,marketplace_id,window_from,window_to')
        .eq('owner_id',caller.data_owner_id).eq('source','orders').eq('status','failed')
        .order('window_from',{ascending:true}).limit(1000);
      if(failedError)throw failedError;
      const grouped=new Map<string,any>();
      for(const job of failed||[]){
        if(!job.marketplace_id||!job.window_from)continue;
        const start=Date.parse(String(job.window_from));
        const end=Date.parse(String(job.window_to||job.window_from));
        if(!Number.isFinite(start)||!Number.isFinite(end))continue;
        const dayMs=86_400_000;
        const first=Math.floor(start/dayMs)*dayMs;
        const last=Math.floor(Math.max(start,end-1)/dayMs)*dayMs;
        for(let timestamp=first;timestamp<=last&&timestamp<first+21*dayMs;timestamp+=dayMs){
          const date=new Date(timestamp).toISOString().slice(0,10);
          const key=[job.amazon_account_id,job.marketplace_id,date].join(':');
          if(!grouped.has(key))grouped.set(key,{...job,date});
        }
      }
      const keys=Array.from(grouped.values()).sort((a,b)=>a.date.localeCompare(b.date));
      if(keys.length){
        const jobKeys=keys.map(job=>`recovery:v2:orders:${job.marketplace_id}:${job.date}`);
        const present=new Set<string>();
        for(let offset=0;offset<jobKeys.length;offset+=100){
          const {data:existing,error:existingError}=await admin.from('amazon_sync_jobs').select('job_key').eq('owner_id',caller.data_owner_id).in('job_key',jobKeys.slice(offset,offset+100));
          if(existingError)throw existingError;
          for(const entry of existing||[])present.add(String(entry.job_key));
        }
        const recovery=keys.filter(job=>!present.has(`recovery:v2:orders:${job.marketplace_id}:${job.date}`)).slice(0,30).map(job=>({
          owner_id:caller.data_owner_id,amazon_account_id:job.amazon_account_id,
          job_key:`recovery:v2:orders:${job.marketplace_id}:${job.date}`,
          source:'orders',marketplace_id:job.marketplace_id,scope_key:job.marketplace_id,
          window_from:job.date+'T00:00:00Z',
          window_to:new Date(Date.parse(job.date+'T00:00:00Z')+86400000).toISOString(),
          status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),
          payload:{mode:'hourly',recovery:true}
        }));
        if(recovery.length){
          const {error:insertError}=await admin.from('amazon_sync_jobs').upsert(recovery,{onConflict:'owner_id,amazon_account_id,job_key',ignoreDuplicates:true});
          if(insertError)throw insertError;
          recoveryJobs=recovery.length;
        }
      }
    }
    let jobs=0,processed=0;
    const orderJobIds:string[]=[];
    const ordersOnly=body?.ordersOnly===true;
    for(const integrationAccountId of integrationIds){
      const bootstrap=await ensureAmazonAccountAndMarketplaces(admin,caller.data_owner_id,integrationAccountId);
      const settings=await loadAmazonAutomaticSyncSettings(admin,caller.data_owner_id,integrationAccountId);
      const marketplaces=filterAutomaticMarketplaces(bootstrap.marketplaces,settings.activeMarketplaceIds);
      const sources=ordersOnly?settings.enabledSources.filter(source=>source==='orders'):settings.enabledSources;
      const created=await enqueueHourlySync(admin,bootstrap.account,marketplaces,'manual',new Date(),sources);
      const orderKeys=created.filter(job=>job.source==='orders').map(job=>job.job_key);
      if(orderKeys.length){
        const {data:orderJobs,error:jobError}=await admin.from('amazon_sync_jobs').select('id').eq('owner_id',caller.data_owner_id).eq('amazon_account_id',bootstrap.account.id).in('job_key',orderKeys);
        if(jobError)throw jobError;
        orderJobIds.push(...(orderJobs||[]).map((job:any)=>String(job.id)));
      }
      jobs+=created.length;processed+=1;
    }
    const workerKicked=jobs+recoveryJobs>0?await kickWorker():false;
    return response({ok:true,accounts:processed,jobs,recoveryJobs,workerKicked,orderJobIds});
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo solicitar la sincronización de Amazon.';
    const status=/sesión|administrador|acceso/i.test(message)?403:500;
    return response({error:message},status);
  }
});
