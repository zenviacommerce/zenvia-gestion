import {authenticateUser,createAdminClient,requireInternalSecret} from '../_shared/amazon/supabase.ts';
import {recipientCandidate,recipientSource,recipientPatch} from '../_shared/recipientFallback.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function fetchRows(account:any,admin:any){
 const {data:secret,error}=account.secret_id?await admin.rpc('integration_read_secret',{p_secret_id:account.secret_id}):{data:'{}',error:null};
 if(error)throw error;
 const stored=JSON.parse(String(secret||'{}'));
 const env=account.credential_source==='environment';
 const publicKey=String(stored.publicKey||stored.public_key||(env?(Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY')):'')||'');
 const secretKey=String(stored.secretKey||stored.secret_key||(env?(Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET')):'')||'');
 const token=String(stored.token||stored.apiToken||stored.api_token||'');
 if(account.provider==='sendcloud'&&(!publicKey||!secretKey))throw new Error('Faltan las claves de la cuenta Sendcloud seleccionada.');
 if(account.provider==='envia'&&!token)throw new Error('Falta el token de la cuenta Envia.com seleccionada.');
 const auth=account.provider==='sendcloud'?`Basic ${btoa(publicKey+':'+secretKey)}`:`Bearer ${token}`;
 const from=new Date(Date.now()-90*86400000).toISOString().slice(0,10);const rows:any[]=[];let nextSendcloudUrl='';
 for(let page=1;page<=5;page++){
  const url=account.provider==='sendcloud'?new URL(nextSendcloudUrl||'https://panel.sendcloud.sc/api/v3/orders'):new URL(`${account.config?.environment==='production'?'https://queries.envia.com':'https://queries.test.envia.com'}/v4/orders`);
  if(!nextSendcloudUrl)url.searchParams.set('page',String(page));
  if(account.provider==='sendcloud'){url.searchParams.set('page_size','100');url.searchParams.set('order_created_at_min',from);url.searchParams.set('sort','-order_created_at');}
  else {url.searchParams.set('limit','100');url.searchParams.set('date_from',from);url.searchParams.set('sort_by','created_at_ecommerce');url.searchParams.set('sort_direction','desc');}
  const res=await fetch(url,{headers:{Authorization:auth,Accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!res.ok)throw new Error(`${account.provider} no pudo consultar pedidos (HTTP ${res.status}).`);
  const data=await res.json();const batch=account.provider==='sendcloud'?data.data:data.orders_info;
  if(!Array.isArray(batch))throw new Error(`${account.provider} devolvió un formato de pedidos no reconocido.`);
  rows.push(...batch);
  if(account.provider==='sendcloud'){
   const link=(res.headers.get('link')||'').split(',').find(part=>/rel="next"/.test(part));
   nextSendcloudUrl=link?.match(/<([^>]+)>/)?.[1]||'';
   if(!nextSendcloudUrl)break;
   const next=new URL(nextSendcloudUrl);
   if(next.origin!=='https://panel.sendcloud.sc'||!next.pathname.startsWith('/api/v3/orders'))throw new Error('Sendcloud devolvió una paginación no válida.');
  }else if(batch.length<100)break;
 }
 return rows;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{
  const admin=createAdminClient();const body=await req.json().catch(()=>({}));let ownerId='';
  try{requireInternalSecret(req);ownerId=String(body.ownerId||'');}catch{
   const caller=await authenticateUser(req,admin);
   if(caller.role!=='admin'&&!caller.permissions?.includes('orders'))return response({error:'Sin permiso para gestionar pedidos.'},403);
   ownerId=caller.data_owner_id;
  }
  let query=admin.from('integration_accounts').select('id,owner_id,provider,config,enabled,status,secret_id,credential_source').eq('enabled',true).neq('status','disabled').in('provider',['amazon','sendcloud','envia']);
  if(ownerId)query=query.eq('owner_id',ownerId);
  const {data:accounts,error}=await query;if(error)throw error;
  let enriched=0;const failures:any[]=[];const cache=new Map<string,any[]>();
  for(const amazon of (accounts||[]).filter((a:any)=>a.provider==='amazon'&&a.config?.recipientSourceAccountId)){
   try{
    const account=recipientSource(amazon,accounts||[]);if(!account)throw new Error('La cuenta seleccionada no está disponible en esta empresa.');
    const {data:orders,error:orderError}=await admin.from('fulfillment_orders').select('id,order_number,shipping_address,customer_name,customer_email,customer_phone,raw_payload,last_synced_at,pii_purged_at').eq('owner_id',amazon.owner_id).eq('source_channel','amazon').eq('source_integration_account_id',amazon.id).is('pii_purged_at',null).is('fulfilled_at',null).order('order_created_at',{ascending:false}).limit(200);
    if(orderError)throw orderError;
    const incomplete=(orders||[]).filter((o:any)=>!o.pii_purged_at&&(!o.shipping_address?.name||!o.shipping_address?.address_line_1||!o.shipping_address?.city||!o.customer_name));
    if(!incomplete.length)continue;
    if(!cache.has(account.id))cache.set(account.id,(await fetchRows(account,admin)).map(row=>recipientCandidate(account.provider,row)).filter(Boolean));
    for(const order of incomplete){
     const matches=cache.get(account.id)!.filter(row=>row.reference===order.order_number);
     // Ambiguous external records never provide customer data.
     if(!matches.length||new Set(matches.map(row=>JSON.stringify(row.address))).size!==1)continue;
     const patch=recipientPatch(order,matches[0].address,account.id,account.provider);if(!patch)continue;
     // A concurrent SP-API update always wins; retry next cycle instead of replacing it.
     const {data:count,error:saveError}=await admin.rpc('apply_amazon_recipient_fallback',{
      p_order_id:order.id,p_owner_id:amazon.owner_id,p_amazon_account_id:amazon.id,
      p_expected_raw:order.raw_payload,p_expected_synced_at:order.last_synced_at,p_patch:patch,
     });
     if(saveError)throw saveError;enriched+=Number(count)||0;
    }
   }catch(e){failures.push({amazonAccountId:amazon.id,error:e instanceof Error?e.message:'No se pudieron completar destinatarios.'});}
  }
  return response({ok:failures.length===0,enriched,failures});
 }catch(e){return response({error:e instanceof Error?e.message:'Error al completar destinatarios.'},500);}
});
