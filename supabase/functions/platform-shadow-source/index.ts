import {createClient} from 'npm:@supabase/supabase-js@2.105.0';
import {signShadow,verifyShadow,secureEqual,readLimitedBody} from '../_shared/platform-shadow-protocol.ts';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const serviceKey=()=>{try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(keys.default)return keys.default;}catch{}return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';};
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'METHOD'},405);
 const admin=createClient(Deno.env.get('SUPABASE_URL')||'',serviceKey(),{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async(name:string,args:Record<string,unknown>={})=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error(error.code||'RPC_FAILED');return data;};
 try{
  const cfg=await rpc('platform_shadow_source_credentials');if(!cfg?.enabled)return json({error:'DISABLED'},503);
  if(secureEqual(req.headers.get('x-shadow-worker')||'',cfg.worker_token||'')){
   const lease=crypto.randomUUID();if(!await rpc('platform_shadow_source_drain_lease',{p_lease:lease}))return json({busy:true});
   let delivered=0,failed=0;const started=Date.now();
   try{
    const send=async()=>{
     const event=await rpc('platform_shadow_source_claim',{p_lease:lease});if(!event)return false;
     let success=false;let code='DELIVERY_FAILED',retryAfter=0;
     try{const raw=JSON.stringify(event);const response=await fetch(cfg.receiver_url,{method:'POST',headers:await signShadow(raw,cfg.key_id,cfg.hmac_key),body:raw,signal:AbortSignal.timeout(10000)});success=response.ok;code='HTTP_'+response.status;const retry=response.headers.get('Retry-After');if(retry)retryAfter=/^\d+$/.test(retry)?Number(retry):Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000));await response.body?.cancel();}catch{code='NETWORK_OR_TIMEOUT';}
     const ack=await rpc('platform_shadow_source_ack',{p_event:event.event_id,p_lease:lease,p_success:success,p_error:success?null:code,p_retry_after:Number.isFinite(retryAfter)?Math.min(3600,retryAfter):0});if(ack){if(success)delivered++;else failed++;}return true;
    };
    for(let i=0;i<50&&Date.now()-started<30000;i++){const active=await Promise.all([send(),send()]);if(!active.some(Boolean))break;}
   }finally{await rpc('platform_shadow_source_drain_lease',{p_lease:lease,p_release:true});}
   return json({delivered,failed});
  }
  const raw=await readLimitedBody(req);const nonce=await verifyShadow(req,raw,cfg.key_id,cfg.hmac_key||'');
  if(!nonce)return json({error:'SIGNATURE'},401);
  if(!await rpc('platform_shadow_source_nonce',{p_nonce:nonce}))return json({error:'REPLAY'},409);
  const body=JSON.parse(raw);if(body.action!=='snapshot'||body.source_project_ref!==cfg.source_project_ref||body.generation!==cfg.generation)return json({error:'SOURCE_SCOPE'},403);
  let upper=body.upper?new Date(body.upper):new Date();if(!Number.isFinite(upper.getTime())||upper.getTime()>Date.now()+300000)return json({error:'INVALID_CURSOR'},400);
  if(body.full_repair===true){await rpc('platform_shadow_source_bootstrap');upper=new Date();}
  const preciseUpper=body.full_repair===true||!body.upper?upper.toISOString():body.upper;
  const page=await rpc('platform_shadow_source_snapshot',{p_after:body.after||null,p_id:body.id||null,p_upper:preciseUpper,p_limit:100,p_metrics_after:body.metrics_after||null});return json({...page,upper:preciseUpper});
 }catch(error){const code=error instanceof Error&&error.message==='BODY_TOO_LARGE'?'BODY_TOO_LARGE':'SOURCE_FAILED';console.error(code);return json({error:code},code==='BODY_TOO_LARGE'?413:500);}
});
