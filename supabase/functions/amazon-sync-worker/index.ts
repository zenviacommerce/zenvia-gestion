import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { markJobFailed, markJobSuccess } from '../_shared/amazon/sync.ts';
import { syncOrdersJob } from '../_shared/amazon/orders.ts';
import { retryPendingAmazonTracking } from '../_shared/amazon/shipment-confirmation.ts';
import { syncFinancesJob } from '../_shared/amazon/finances.ts';
import { syncInventoryJob } from '../_shared/amazon/inventory.ts';

const MAX_WORKER_RUNTIME_MS=300_000;
const HEARTBEAT_MS=60_000;
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
async function dispatch(admin:any,job:any){
  if(job.source==='orders'){
    const rows=await syncOrdersJob(admin,job);
    try{await retryPendingAmazonTracking(admin,job.owner_id,10)}catch{/* Tracking must not fail order sync. */}
    return rows;
  }
  if(job.source==='finances')return syncFinancesJob(admin,job);
  if(job.source==='inventory')return syncInventoryJob(admin,job);
  throw new Error('Unsupported Amazon source: '+String(job.source));
}
async function run(admin:any,holderId:string){
  const deadline=Date.now()+MAX_WORKER_RUNTIME_MS;
  let leaseLost=false;
  let renewing=false;
  const heartbeat=setInterval(async()=>{
    if(renewing||leaseLost)return;
    renewing=true;
    try{
      const {data,error}=await admin.rpc('amazon_worker_renew_lease',{p_holder_id:holderId});
      if(error||data!==true){leaseLost=true;console.error('Amazon worker lease heartbeat failed',error?.message||'lease expired');}
    }catch(e){leaseLost=true;console.error('Amazon worker heartbeat exception',String(e));}
    finally{renewing=false;}
  },HEARTBEAT_MS);
  try{
    while(Date.now()<deadline&&!leaseLost){
      const {data:jobs,error}=await admin.rpc('amazon_claim_sync_jobs',{limit_count:1,p_holder_id:holderId});
      if(error)throw error;
      if(!jobs?.length)break;
      for(const job of jobs){
        try{
          const rowsProcessed=await dispatch(admin,job);
          if(leaseLost)throw new Error('Worker lease lost during job');
          const {data:stillOwner,error:renewError}=await admin.rpc('amazon_worker_renew_lease',{p_holder_id:holderId});
          if(renewError||stillOwner!==true){leaseLost=true;throw new Error('Worker lease lost before job completion');}
          await markJobSuccess(admin,job,rowsProcessed);
          console.info('amazon_worker_job_success',JSON.stringify({source:job.source,id:job.id,rowsProcessed}));
        }catch(e){
          if(leaseLost){console.error('amazon_worker_lease_lost',String(e));break;}
          try{await markJobFailed(admin,job,e);}catch(markError){console.error('amazon_worker_mark_failed_error',String(markError));throw markError;}
          console.error('amazon_worker_job_failed',JSON.stringify({source:job.source,id:job.id,error:String(e)}));
        }
      }
    }
  }catch(e){console.error('amazon_worker_background_error',String(e));}
  finally{
    clearInterval(heartbeat);
    try{const {error}=await admin.rpc('amazon_worker_release_lease',{p_holder_id:holderId});if(error)console.error('amazon_worker_release_error',error.message);}catch(e){console.error('amazon_worker_release_exception',String(e));}
  }
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Method not allowed'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const holderId=crypto.randomUUID();
    const {data:acquired,error}=await admin.rpc('amazon_worker_acquire_lease',{p_holder_id:holderId});
    if(error)throw error;
    if(acquired!==true)return response({ok:true,status:'worker_already_running'},200);
    EdgeRuntime.waitUntil(run(admin,holderId));
    return response({ok:true,status:'accepted'},202);
  }catch(error){console.error('amazon_worker_start_error',String(error));return response({error:error instanceof Error?error.message:'Worker error'},500);}
});
