import {runMrwDiagnostic} from '../_shared/tracking/mrwDiagnostic.ts';
import {runProviderDiagnostic} from '../_shared/tracking/providerDiagnostic.ts';
import {previewTrackingReprocess,applyTrackingReprocess} from '../_shared/tracking/reprocess.ts';
import {configureSendcloudWebhook} from '../_shared/tracking/setup-webhook.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.105.0';
import {runTrackingWorker} from '../_shared/tracking/worker.ts';
function key(){try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(keys.default)return keys.default}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}
Deno.serve(async(req:Request)=>{
 const secret=key();if(req.method!=='POST')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405});
 if(!secret||req.headers.get('apikey')!==secret)return Response.json({error:'UNAUTHORIZED'},{status:401});
 const admin=createClient(Deno.env.get('SUPABASE_URL')||'',secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const environmentCredentials={sendcloud:{publicKey:Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY'),secretKey:Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET')}};
 try{
  const body=await req.json().catch(()=>({}));
  if(body.action==='provider_diagnostic')return Response.json({diagnostic:await runProviderDiagnostic(admin,fetch,environmentCredentials)});
  if(body.action==='mrw_diagnostic')return Response.json({diagnostic:await runMrwDiagnostic(admin,fetch,body.batchOnly===true)});
  if(body.action==='preview_reprocess')return Response.json({preview:await previewTrackingReprocess(admin,fetch,environmentCredentials)});
  if(body.action==='apply_reprocess')return Response.json({apply:await applyTrackingReprocess(admin,body.approvedCandidates,body.limit??25)});
  if(body.action&&!['run','webhook_availability','configure_sendcloud_webhook'].includes(body.action))return Response.json({error:'UNKNOWN_ACTION'},{status:400});
  if(body.action==='webhook_availability'||body.action==='configure_sendcloud_webhook'){
   const {data:accounts,error}=await admin.from('integration_accounts').select('id,owner_id,provider,secret_id,credential_source').eq('provider','sendcloud').eq('enabled',true).neq('status','disabled');if(error)throw error;
   const results=[];
   for(const account of (accounts||[]).slice(0,10)){
    let stored:any={};if(account.secret_id){const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:account.secret_id});if(error)throw error;stored=JSON.parse(String(data||'{}'))}
    const c={...(account.credential_source==='environment'?environmentCredentials.sendcloud:{}),...stored};
    const r=await fetch('https://panel.sendcloud.sc/api/v3/event-subscriptions/connections',{headers:{Authorization:'Basic '+btoa((c.publicKey||c.public_key||'')+':'+(c.secretKey||c.secret_key||''))},signal:AbortSignal.timeout(12000),redirect:'error'});
    const available=r.ok;await r.body?.cancel();
    if(body.action==='configure_sendcloud_webhook'&&available){const configured=await configureSendcloudWebhook(account,c,Deno.env.get('SUPABASE_URL')||'');const saved=await admin.from('shipment_tracking_account_health').update({webhook_status:JSON.stringify(configured)}).eq('account_id',account.id);if(saved.error)throw saved.error;results.push({account:account.id,...configured})}
    else results.push({account:account.id,status:r.status,available});
   }
   return Response.json({accounts:results});
  }
  return Response.json(await runTrackingWorker(admin,fetch,environmentCredentials));
 }catch{return Response.json({error:'TRACKING_WORKER_FAILED'},{status:503})}
});
