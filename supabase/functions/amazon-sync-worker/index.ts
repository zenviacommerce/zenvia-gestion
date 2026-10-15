import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { markJobFailed, markJobSuccess } from '../_shared/amazon/sync.ts';
import { syncOrdersJob } from '../_shared/amazon/orders.ts';
import { retryPendingAmazonTracking } from '../_shared/amazon/shipment-confirmation.ts';
import { syncFinancesJob } from '../_shared/amazon/finances.ts';
import { syncInventoryJob } from '../_shared/amazon/inventory.ts';

const MAX_WORKER_RUNTIME_MS=300_000;
const SYNC_CLAIM_BUDGET_MS=100_000;
const HEARTBEAT_MS=60_000;
const EDGE_RUNTIME=globalThis as typeof globalThis & { EdgeRuntime?: {waitUntil?: (promise:Promise<unknown>)=>void} };
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
async function rpc(admin:any,name:string,args:any){
 const {data,error}=await admin.rpc(name,args);
 if(error)throw error;
 return data;
}
async function dispatch(admin:any,job:any){
 if(job.source==='orders'){
  const rows=await syncOrdersJob(admin,job);
  try{await retryPendingAmazonTracking(admin,job.owner_id,10)}catch{/* independent tracking retry */}
  return rows;
 }
 if(job.source==='finances')return syncFinancesJob(admin,job);
 if(job.source==='inventory')return syncInventoryJob(admin,job);
 throw new Error('Unsupported Amazon source: '+String(job.source));
}
async function run(admin:any,holder:string,budget:number){
 const started=Date.now();
 let leaseAlive=true;
 let heartbeatBusy=false;
 const heartbeat=setInterval(async()=>{
  if(heartbeatBusy)return;
  heartbeatBusy=true;
  try{if(await rpc(admin,'amazon_worker_renew_lease',{p_holder_id:holder})!==true)leaseAlive=false;}
  catch(e){leaseAlive=false;console.error('amazon_worker_heartbeat_failed',e);}
  finally{heartbeatBusy=false;}
 },HEARTBEAT_MS);
 let claimed=0;
 try{
  while(leaseAlive&&Date.now()-started<budget){
   const jobs=await rpc(admin,'amazon_claim_sync_jobs',{limit_count:1,p_holder_id:holder});
   if(!jobs?.length)break;
   const job=jobs[0];claimed++;
   try{
    const rows=await dispatch(admin,job);
    if(!leaseAlive)throw new Error('worker_lease_lost');
    await markJobSuccess(admin,job,rows);
   }catch(e){
    try{if(leaseAlive)await markJobFailed(admin,job,e);}catch(markError){console.error('amazon_worker_job_mark_failed',markError);}
   }
  }
 }catch(e){console.error('amazon_worker_loop_failed',e);}
 finally{
  clearInterval(heartbeat);
  try{await rpc(admin,'amazon_worker_release_lease',{p_holder_id:holder});}catch(e){console.error('amazon_worker_release_failed',e);}
  console.info('amazon_worker_completed',{claimed,elapsed_ms:Date.now()-started});
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{
  requireInternalSecret(req);
  const admin=createAdminClient();
  const holder=crypto.randomUUID();
  const acquired=await rpc(admin,'amazon_worker_acquire_lease',{p_holder_id:holder});
  if(acquired!==true)return response({ok:true,status:'worker_already_running',claimed:0},202);
  const canBackground=typeof EDGE_RUNTIME.EdgeRuntime?.waitUntil==='function';
  const task=run(admin,holder,canBackground?MAX_WORKER_RUNTIME_MS:SYNC_CLAIM_BUDGET_MS);
  if(canBackground){
   EDGE_RUNTIME.EdgeRuntime!.waitUntil!(task);
   return response({ok:true,status:'accepted',mode:'background',holder_id:holder},202);
  }
  await task;
  return response({ok:true,status:'completed',mode:'synchronous'},200);
 }catch(e){console.error('amazon_worker_request_failed',e);return response({ok:false,error:e instanceof Error?e.message:'worker_failed'},500);}
});
