import {createAdminClient,getAdminKey,requireInternalSecret} from '../_shared/amazon/supabase.ts';
import {shopifyAccountCredentials,shopifyStoredApplicationCredentials} from '../_shared/shopifyAuth.ts';
import {verifyOrderWebhook,webhookMetadata,shopMatches,importCompleted} from '../_shared/shopifyOrderEvents.ts';

const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const topics=['ORDERS_CREATE','ORDERS_UPDATED'];
async function checked(query:any){const r=await query;if(r.error)throw new Error('Persistence failed');return r.data;}
async function accounts(admin:any,id?:string){
 let q=admin.from('integration_accounts').select('*').eq('provider','shopify').eq('enabled',true).neq('status','disabled').neq('credential_source','derived');if(id)q=q.eq('id',id);
 const rows=await checked(q);const active=[];
 for(const a of rows||[]){const w=await checked(admin.from('workspaces').select('status').eq('id',a.owner_id).maybeSingle());if(w&&['active','trialing'].includes(w.status)&&a.config?.syncOrders!==false)active.push(a);}
 return active;
}
async function gql(c:any,query:string,variables:any={}){
 const r=await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':c.accessToken},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(15000),redirect:'error'});
 const p=await r.json();if(!r.ok||p.errors?.length)throw new Error('Shopify registry request failed');return p.data;
}
async function registry(admin:any,a:any,install=false,remove=false){
 const app=await shopifyStoredApplicationCredentials(admin,a.owner_id),c=await shopifyAccountCredentials(admin,a,app);
 const current=await gql(c,'{currentAppInstallation{app{apiKey}}}');const appMatches=Boolean(app.ready&&current.currentAppInstallation?.app?.apiKey===app.clientId);
 const callback=Deno.env.get('SUPABASE_URL')+'/functions/v1/shopify-order-events?account='+a.id;
 const existing:any[]=[];let cursor=null;
 do{const data=await gql(c,'query($after:String){webhookSubscriptions(first:100,after:$after,topics:[ORDERS_CREATE,ORDERS_UPDATED]){pageInfo{hasNextPage endCursor}nodes{id topic uri}}}',{after:cursor});existing.push(...data.webhookSubscriptions.nodes);cursor=data.webhookSubscriptions.pageInfo.hasNextPage?data.webhookSubscriptions.pageInfo.endCursor:null;}while(cursor);
 if(remove){
  const state=await checked(admin.from('shopify_order_sync_state').select('webhook_subscriptions').eq('integration_account_id',a.id).maybeSingle());
  const owned=(state?.webhook_subscriptions||[]).filter((s:any)=>s.createdByThisRelease);
  const ours=new Set(existing.filter(h=>owned.some((o:any)=>o.id===h.id||(o.creationPending&&o.topic===h.topic&&o.uri===h.uri))).map(h=>h.id));
  for(const hook of existing.filter(h=>h.uri===callback&&ours.has(h.id))){const result=await gql(c,'mutation($id:ID!){webhookSubscriptionDelete(id:$id){deletedWebhookSubscriptionId userErrors{message}}}',{id:hook.id});if(result.webhookSubscriptionDelete.userErrors?.length)throw new Error('Webhook removal failed');}
  return {accountId:a.id,removed:existing.filter(h=>h.uri===callback&&ours.has(h.id)).map(h=>h.id)};
 }
 const installed=existing.filter(h=>h.uri===callback).map(h=>({...h,createdByThisRelease:false}));
 const old=await checked(admin.from('shopify_order_sync_state').select('webhook_subscriptions').eq('integration_account_id',a.id).maybeSingle());
 for(const h of installed)h.createdByThisRelease=Boolean(old?.webhook_subscriptions?.find((x:any)=>x.id===h.id||(x.creationPending&&x.topic===h.topic&&x.uri===h.uri))?.createdByThisRelease);
 if(install&&appMatches)for(const topic of topics.filter(t=>!installed.some(h=>h.topic===t))){
  await checked(admin.from('shopify_order_sync_state').update({webhook_subscriptions:[...installed,{topic,uri:callback,createdByThisRelease:true,creationPending:true}]}).eq('integration_account_id',a.id).eq('owner_id',a.owner_id));
  const data=await gql(c,'mutation($topic:WebhookSubscriptionTopic!,$input:WebhookSubscriptionInput!){webhookSubscriptionCreate(topic:$topic,webhookSubscription:$input){webhookSubscription{id topic uri}userErrors{message}}}',{topic,input:{uri:callback,format:'JSON',includeFields:['id','admin_graphql_api_id','created_at','updated_at']}});
  const result=data.webhookSubscriptionCreate;if(result.userErrors?.length||!result.webhookSubscription)throw new Error('Webhook registration failed');installed.push({...result.webhookSubscription,createdByThisRelease:true});
  await checked(admin.from('shopify_order_sync_state').update({webhook_subscriptions:installed}).eq('integration_account_id',a.id).eq('owner_id',a.owner_id));
 }
 if(install)await checked(admin.from('shopify_order_sync_state').update({webhook_checked_at:new Date().toISOString(),webhook_subscriptions:installed,webhook_error:appMatches?null:'App secret mismatch; two-minute polling retained'}).eq('integration_account_id',a.id).eq('owner_id',a.owner_id));
 return {accountId:a.id,appMatches,existing:existing.map(h=>({id:h.id,topic:h.topic,uri:h.uri})),installed};
}
async function destination(name:string,body:any){
 const r=await fetch(Deno.env.get('SUPABASE_URL')+'/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',apikey:getAdminKey()},body:JSON.stringify(body),signal:AbortSignal.timeout(95000),redirect:'error'});
 const data=await r.json().catch(()=>null);if(!r.ok||!importCompleted(data))throw new Error(name+' did not complete');return data;
}
export async function syncAccount(admin:any,a:any,poll=false){
 const lease=crypto.randomUUID();const acquired=await checked(admin.rpc('shopify_order_sync_acquire',{owner:a.owner_id,store:a.id,lease_token:lease,poll}));if(!acquired)return {accountId:a.id,skipped:true};
 let success=false;
 try{
  const pending=poll?[]:await checked(admin.from('shopify_order_events').select('*').eq('integration_account_id',a.id).eq('owner_id',a.owner_id).is('completed_at',null).lte('next_attempt_at',new Date().toISOString()).order('received_at').limit(20));
  const grouped=new Map<string,any[]>();for(const event of pending||[])grouped.set(event.order_id,[...(grouped.get(event.order_id)||[]),event]);
  if(!grouped.size&&!poll)return {accountId:a.id,skipped:true};
  const workStarted=Date.now();const batches:any[]=grouped.size?[...grouped.values()].slice(0,1):[null];let completed=0,failed=0;
  for(const events of batches){
   if(Date.now()-workStarted>45_000)break;
   const ids=events?.map((e:any)=>e.id)||[];
   if(events)for(const e of events)await checked(admin.from('shopify_order_events').update({attempts:e.attempts+1,last_error:null}).eq('id',e.id).eq('owner_id',a.owner_id));
   const body={ownerId:a.owner_id,integrationAccountId:a.id,syncSource:events?'webhook':'cron',receivedAt:events?.[0]?.received_at||new Date().toISOString(),...(events?{orderId:events[0].order_id}:{})};
   try{
    // These write different destinations. The analytics lease remains authoritative.
    await Promise.all([destination('shopify-orders',body),destination('shopify-analytics-sync',body)]);
    if(events)await checked(admin.from('shopify_order_events').update({completed_at:new Date().toISOString(),last_error:null}).eq('owner_id',a.owner_id).in('id',ids));
    completed++;
   }catch{
    if(events)await checked(admin.from('shopify_order_events').update({last_error:'Destination incomplete; retry pending',next_attempt_at:new Date(Date.now()+Math.min(300000,60000*Math.max(...events.map((e:any)=>e.attempts+1)))).toISOString()}).eq('owner_id',a.owner_id).in('id',ids));
    failed++;continue;
   }
  }
  success=failed===0;await checked(admin.from('shopify_order_sync_state').update({last_error:failed?'Some deliveries pending retry':null}).eq('integration_account_id',a.id).eq('lease',lease));
  console.info('shopify_sync_cycle',JSON.stringify({store:a.id,source:poll?'cron':'webhook',completed,failed}));
  return {accountId:a.id,completed,...(failed?{error:'Some deliveries pending retry'}:{})};
 }catch{
  await checked(admin.from('shopify_order_sync_state').update({last_error:'Store import incomplete; cursor preserved'}).eq('integration_account_id',a.id).eq('lease',lease));
  return {accountId:a.id,error:'Store import incomplete'};
 }finally{await checked(admin.rpc('shopify_order_sync_release',{owner:a.owner_id,store:a.id,lease_token:lease,success}));}
}
export async function handle(req:Request){
 if(req.method!=='POST')return response({error:'Method not allowed'},405);
 const admin=createAdminClient();
 try{
  const accountId=new URL(req.url).searchParams.get('account');
  if(accountId){
   const a=(await accounts(admin,accountId))[0];if(!a)return response({error:'Unknown shop'},401);
   if(!shopMatches(req.headers.get('x-shopify-shop-domain')||'',String(a.external_account_id||'')))return response({error:'Shop mismatch'},401);
   if(Number(req.headers.get('content-length')||0)>2_000_000)return response({error:'Payload too large'},413);
   const raw=new Uint8Array(await req.arrayBuffer());if(raw.length>2_000_000)return response({error:'Payload too large'},413);
   const app=await shopifyStoredApplicationCredentials(admin,a.owner_id);
   if(!await verifyOrderWebhook(raw,req.headers.get('x-shopify-hmac-sha256')||'',app.clientSecret))return response({error:'Invalid signature'},401);
   const metadata=webhookMetadata(JSON.parse(new TextDecoder().decode(raw)),req.headers.get('x-shopify-topic')||'',req.headers.get('x-shopify-webhook-id')||'');
   await checked(admin.from('shopify_order_events').upsert({owner_id:a.owner_id,integration_account_id:a.id,...metadata},{onConflict:'integration_account_id,delivery_id',ignoreDuplicates:true}));
   // Durable receipt precedes acknowledgement; cron retries if the isolate dies.
   const task=syncAccount(admin,a,false);const runtime=(globalThis as any).EdgeRuntime;if(runtime?.waitUntil)runtime.waitUntil(task);else await task;
   return response({ok:true});
  }
  requireInternalSecret(req);const body=await req.json().catch(()=>({}));const selected=await accounts(admin,body.integrationAccountId);
  if(body.action==='inspect'||body.action==='register'||body.action==='unregister'){
   const results=[];for(const a of selected){
    if(body.action==='inspect'){results.push(await registry(admin,a));continue;}
    const lease=crypto.randomUUID();if(!await checked(admin.rpc('shopify_order_sync_acquire',{owner:a.owner_id,store:a.id,lease_token:lease,poll:false}))){results.push({accountId:a.id,skipped:true});continue;}
    try{results.push(await registry(admin,a,body.action==='register',body.action==='unregister'));}finally{await checked(admin.rpc('shopify_order_sync_release',{owner:a.owner_id,store:a.id,lease_token:lease,success:false}));}
   }return response({ok:true,accounts:results});
  }
  if(body.action!=='tick'||!body.integrationAccountId)return response({error:'Tick requires exact account'},400);
  if(!selected.length)return response({error:'Unknown active account'},404);
  const results=[];const tickStarted=Date.now();
  for(const a of selected){
   // Handle pending deliveries even when the two-minute fallback is not due.
   try{results.push(await syncAccount(admin,a,false));results.push(await syncAccount(admin,a,true));if(Date.now()-tickStarted<180000)results.push(await syncAccount(admin,a,false));
    const state=await checked(admin.from('shopify_order_sync_state').select('webhook_checked_at').eq('integration_account_id',a.id).maybeSingle());
    if(Date.now()-tickStarted<15000&&(!state?.webhook_checked_at||Date.now()-Date.parse(state.webhook_checked_at)>86400000)){
     const lease=crypto.randomUUID();if(await checked(admin.rpc('shopify_order_sync_acquire',{owner:a.owner_id,store:a.id,lease_token:lease,poll:false}))){
      try{await registry(admin,a,true);}catch{await checked(admin.from('shopify_order_sync_state').update({webhook_checked_at:new Date().toISOString(),webhook_error:'Registration unavailable; two-minute polling retained'}).eq('integration_account_id',a.id));}finally{await checked(admin.rpc('shopify_order_sync_release',{owner:a.owner_id,store:a.id,lease_token:lease,success:false}));}
     }
    }
   }catch{results.push({accountId:a.id,error:'Retry pending'});}
  }
  return response({ok:results.every(r=>!r.error),accounts:results});
 }catch{return response({error:'Request rejected or persistence unavailable'},403);}
}
Deno.serve(handle);
