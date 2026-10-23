import {createAdminClient,authenticateUser} from '../_shared/amazon/supabase.ts';
import {loadAmazonSpApiCredentials} from '../_shared/amazon/config.ts';
import {spApiRequest} from '../_shared/amazon/sp-api.ts';
import {shopifyAccountCredentials,shopifyStoredApplicationCredentials} from '../_shared/shopifyAuth.ts';
import {amazonCancellationXml,amazonFeedResult,shopifyCancellationInput} from '../_shared/orderCancellation.ts';
import {cancelCarrier,cancellationAccount,CancellationRejected} from '../_shared/cancelCarriers.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
async function sourceCancel(admin:any,order:any,op:any,refresh:boolean,beforeMutation:()=>Promise<void>){
 if(order.source_channel==='shopify'){
  const {account}=await cancellationAccount(admin,order,'shopify',true);const c=await shopifyAccountCredentials(admin,account,await shopifyStoredApplicationCredentials(admin,order.owner_id));
  const gql=async(query:string,variables:any)=>{const res=await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':c.accessToken},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});const payload=await res.json();if(!res.ok||payload.errors?.length){const message=payload.errors?.map((e:any)=>e.message).join(' · ')||`Shopify (${res.status})`;if(/access denied|scope/i.test(message))throw new CancellationRejected('Falta el permiso write_orders en Shopify. Actualiza los permisos de la app y vuelve a conectar la tienda.');if((res.status>=400&&res.status<500&&res.status!==408&&res.status!==429)||(payload.errors?.length&&payload.errors.every((e:any)=>['ACCESS_DENIED','GRAPHQL_VALIDATION_FAILED','UNDEFINED_FIELD','VARIABLES_IN_ALLOWED_POSITION','variableRequiresValidType','undefinedField'].includes(e.extensions?.code))))throw new CancellationRejected(message);throw new Error(message);}return payload.data;};
  const id=String(order.order_id).startsWith('gid://')?order.order_id:`gid://shopify/Order/${order.order_id}`;
  const state=await gql('query($id:ID!){order(id:$id){id cancelledAt}}',{id});if(!state.order)throw new CancellationRejected('Shopify no encuentra este pedido.');if(state.order.cancelledAt)return {status:'confirmed',message:'Shopify confirma que el pedido está cancelado.'};
  if(refresh){if(op.remote_id){const job=await gql('query($id:ID!){job(id:$id){id done}}',{id:op.remote_id});if(job.job?.done)return {status:'unknown',message:'Shopify terminó la tarea, pero el pedido todavía no figura cancelado.'};}return {status:'pending',message:'Cancelación pendiente de confirmación en Shopify.'};}
  const input=shopifyCancellationInput(id,op.details);
  await beforeMutation();
  const data=await gql('mutation($orderId:ID!,$reason:OrderCancelReason!,$refundMethod:OrderCancelRefundMethodInput!,$restock:Boolean!,$notifyCustomer:Boolean!){orderCancel(orderId:$orderId,reason:$reason,refundMethod:$refundMethod,restock:$restock,notifyCustomer:$notifyCustomer){job{id done} orderCancelUserErrors{field message code} userErrors{field message}}}',input);
  const result=data.orderCancel,errors=[...(result.orderCancelUserErrors||[]),...(result.userErrors||[])];if(errors.length)throw new CancellationRejected(errors.map((e:any)=>e.message).join(' · '));
  return {status:'pending',remoteId:result.job?.id,message:'Shopify ha recibido la cancelación. Pendiente de confirmación.'};
 }
 if(order.source_channel!=='amazon')throw new CancellationRejected('Solo se pueden cancelar pedidos de origen Amazon o Shopify.');
 const {account}=await cancellationAccount(admin,order,'amazon',true);
 let query=admin.from('amazon_orders').select('amazon_account_id,marketplace_id,fulfillment_channel').eq('owner_id',order.owner_id).eq('amazon_order_id',order.order_id);
 if(account.linked_resource_id)query=query.eq('amazon_account_id',account.linked_resource_id);
 const local=await query.limit(2);if(local.error)throw local.error;if(local.data?.length!==1)throw new CancellationRejected('No se puede determinar de forma segura la cuenta del pedido Amazon.');const context=local.data[0];
 const credentials=await loadAmazonSpApiCredentials(admin,{amazonAccountId:context.amazon_account_id,integrationAccountId:account.id,ownerId:order.owner_id});
 const remote:any=await spApiRequest(`/orders/v0/orders/${encodeURIComponent(order.order_id)}`,{},credentials);const current=remote.payload||remote;
 if(current.FulfillmentChannel!=='MFN')throw new CancellationRejected('La cancelación desde ZENVIA solo admite pedidos FBM.');
 if(current.OrderStatus==='Canceled')return {status:'confirmed',message:'Amazon confirma que el pedido está cancelado.'};
 if(refresh){
  if(!op.remote_id)return {status:'unknown',message:'No hay identificador de solicitud. Comprueba el pedido en Amazon; no se reenviará la cancelación.'};
  const feed:any=await spApiRequest(`/feeds/2021-06-30/feeds/${encodeURIComponent(op.remote_id)}`,{},credentials);
  if(['FATAL','CANCELLED'].includes(feed.processingStatus))return {status:'rejected',message:'Amazon no procesó el fichero de cancelación.'};
  if(feed.processingStatus!=='DONE')return {status:'pending',message:'Amazon está procesando la cancelación.'};
  const doc:any=await spApiRequest(`/feeds/2021-06-30/documents/${encodeURIComponent(feed.resultFeedDocumentId)}`,{},credentials);const res=await fetch(doc.url,{signal:AbortSignal.timeout(20000)});if(!res.ok)throw new Error('No se pudo leer el informe de Amazon.');let body=res.body;if(doc.compressionAlgorithm==='GZIP'&&body)body=body.pipeThrough(new DecompressionStream('gzip'));const result=amazonFeedResult(await new Response(body).text());return result.status==='confirmed'?{status:'pending',message:'Amazon aceptó el fichero; pendiente de que el pedido figure cancelado.'}:result;
 }
 if(current.OrderStatus!=='Unshipped')throw new CancellationRejected(`Amazon no permite esta cancelación desde ZENVIA: estado ${current.OrderStatus}. Gestiona el pedido en Seller Central.`);
 // Use live lines so the cancellation covers the complete order.
 const itemIds:string[]=[];let token='';do{const result:any=await spApiRequest(`/orders/v0/orders/${encodeURIComponent(order.order_id)}/orderItems`,{query:token?{NextToken:token}:{}},credentials);const p=result.payload||result;for(const item of p.OrderItems||[])itemIds.push(String(item.OrderItemId));token=p.NextToken||'';}while(token);
 const xml=amazonCancellationXml(credentials.sellerId,order.order_id,itemIds,op.details.reason);
 const doc:any=await spApiRequest('/feeds/2021-06-30/documents',{method:'POST',maxAttempts:1,body:{contentType:'text/xml; charset=UTF-8'}},credentials);
 const uploaded=await fetch(doc.url,{method:'PUT',headers:{'Content-Type':'text/xml; charset=UTF-8'},body:xml,signal:AbortSignal.timeout(25000)});if(!uploaded.ok)throw new CancellationRejected('No se pudo subir el fichero de cancelación a Amazon.');
 await beforeMutation();
 const feed:any=await spApiRequest('/feeds/2021-06-30/feeds',{method:'POST',maxAttempts:1,body:{feedType:'POST_ORDER_ACKNOWLEDGEMENT_DATA',marketplaceIds:[context.marketplace_id],inputFeedDocumentId:doc.feedDocumentId}},credentials);
 return {status:'pending',remoteId:feed.feedId,message:'Amazon ha recibido la cancelación. Pendiente del informe de procesamiento.'};
}
const identity=(order:any)=>({provider:order.shipping_provider||'sendcloud',accountId:order.shipping_integration_account_id??null,reference:String(order.shipping_remote_id||order.sendcloud_parcel_id||order.tracking_number||''),trackingNumber:order.tracking_number??null,labelCreatedAt:order.label_created_at??null});
function sameIdentity(expected:any,current:ReturnType<typeof identity>){
 if(!expected||!Object.prototype.hasOwnProperty.call(expected,'labelCreatedAt'))return false;
 return ['provider','accountId','reference','trackingNumber'].every(key=>expected[key]===current[key as keyof typeof current])&&
  (expected.labelCreatedAt===current.labelCreatedAt||(expected.labelCreatedAt!=null&&current.labelCreatedAt!=null&&Date.parse(expected.labelCreatedAt)===Date.parse(current.labelCreatedAt)));
}
async function generationKey(current:ReturnType<typeof identity>){
 const stamp=current.labelCreatedAt==null?null:new Date(current.labelCreatedAt).toISOString();
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([current.provider,current.accountId,current.reference,current.trackingNumber,stamp])));
 return 'shipment:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{
  const admin=createAdminClient(),caller=await authenticateUser(req,admin);
  if(caller.role!=='admin'&&!caller.permissions?.includes('orders'))return response({error:'No tienes permiso para gestionar pedidos.'},403);
  const body=await req.json(),owner=caller.data_owner_id;
  const found=await admin.from('fulfillment_orders').select('*').eq('id',body.orderId).eq('owner_id',owner).maybeSingle();
  if(found.error)throw found.error;const order=found.data;if(!order)return response({error:'Pedido no encontrado.'},404);
  if(order.pii_purged_at)return response({error:'Los datos personales de este pedido se han retirado.'},409);
  if(body.action==='context'){
   if(!sameIdentity(body.expected,identity(order)))return response({error:'La expedición ha cambiado. Actualiza el pedido.'},409);
   const account=await admin.from('integration_accounts').select('display_name').eq('id',order.shipping_integration_account_id).eq('owner_id',owner).eq('provider',order.shipping_provider||'sendcloud').maybeSingle();
   if(account.error)throw account.error;if(!account.data?.display_name)return response({error:'No se pudo verificar la cuenta de transporte.'},409);
   return response({ok:true,accountName:account.data.display_name});
  }
  const refresh=body.action==='refresh';if(!refresh&&body.action!=='cancel')return response({error:'Acción no válida.'},400);
  let operations:any[]=[];
  if(refresh){
   let query=admin.from('order_cancellation_operations').select('*').eq('order_id',order.id).eq('owner_id',owner).in('status',['submitting','pending','unknown','confirmed','rejected']).order('created_at',{ascending:false}).limit(50);
   if(body.kind==='label')query=query.eq('kind','label');
   const result=await query;if(result.error)throw result.error;operations=result.data||[];
  }else{
   const kind=body.kind;if(!['label','order'].includes(kind))return response({error:'Acción de cancelación no válida.'},400);
   const current=identity(order),provider=kind==='label'?current.provider:order.source_channel;
   if(kind==='label'){
    if(order.external_shipment!=null)return response({error:'Este envío externo debe anularse con su agencia.'},409);
    if(!current.reference||order.label_cancelled_at)return response({error:'El pedido no tiene una etiqueta activa.'},409);
    if(!sameIdentity(body.expected,current))return response({error:'La expedición ha cambiado. Actualiza el pedido y revisa la etiqueta antes de cancelar.'},409);
   }
   if(kind==='order'&&!['amazon','shopify'].includes(provider))return response({error:'Este origen no admite cancelación.'},400);
   if(kind==='order'&&!['customer','inventory','address','other'].includes(body.reason))return response({error:'Selecciona el motivo de cancelación.'},400);
   const claim=await admin.rpc('integration_start_cancellation',{p_order_id:order.id,p_owner_id:owner,p_kind:kind,p_provider:provider,p_reference:kind==='label'?await generationKey(current):`${provider}:${order.source_integration_account_id}:${order.order_id}`,p_user_id:caller.user_id,p_details:{reason:body.reason||'other',refund:body.refund===true,restock:body.restock!==false,shipmentRef:current.reference,trackingNumber:order.tracking_number,parcelId:order.sendcloud_parcel_id,shippingRemoteId:order.shipping_remote_id,shippingAccountId:order.shipping_integration_account_id,carrierCode:order.carrier_code,shippingCost:order.shipping_cost_amount,labelCreatedAt:order.label_created_at??null}});
   if(claim.error)throw claim.error;if(!claim.data.claimed)return response({ok:true,operations:[claim.data.operation]});operations=[claim.data.operation];
  }
  const results=[];
  for(const op of operations){
   if(refresh&&['confirmed','rejected'].includes(op.status)){results.push(op);continue;}
   // Refresh only queries the original shipment; an uncertain mutation is never resent.
   if(refresh&&op.status==='submitting'&&Date.now()-Date.parse(op.created_at)<180000){results.push(op);continue;}
   let result:any,attempted=false;const beforeMutation=async()=>{attempted=true;};
   try{
    const snapshot=op.kind==='label'?{...order,shipping_provider:op.provider,shipping_integration_account_id:op.details.shippingAccountId,sendcloud_parcel_id:op.details.parcelId,shipping_remote_id:op.details.shippingRemoteId,tracking_number:op.details.trackingNumber,carrier_code:op.details.carrierCode}:order;
    result=op.kind==='label'?await cancelCarrier(admin,snapshot,refresh,beforeMutation):await sourceCancel(admin,order,op,refresh,beforeMutation);
    if(!refresh&&!attempted&&result.status==='unknown')result={status:'rejected',message:'No se ha enviado la cancelación porque no se pudo verificar la expedición. Actualiza y revisa sus datos.'};
   }catch(error){
    const rejected=!refresh&&(!attempted||error instanceof CancellationRejected);
    result={status:rejected?'rejected':refresh&&op.status==='pending'?'pending':'unknown',message:rejected?'No se ha podido cancelar el envío. Revisa la cuenta y el estado con la agencia.':'El resultado no está confirmado. Comprueba el estado; la solicitud no se reenviará.'};
   }
   const saved=await admin.rpc('integration_finish_cancellation',{p_operation_id:op.id,p_owner_id:owner,p_status:result.status,p_message:result.message,p_remote_id:result.remoteId||null});if(saved.error)throw saved.error;
   const persisted=await admin.from('order_cancellation_operations').select('*').eq('id',op.id).eq('owner_id',owner).maybeSingle();if(persisted.error)throw persisted.error;
   if(!persisted.data)throw new Error('CANCELLATION_RESULT_UNAVAILABLE');results.push(persisted.data);
  }
  return response({ok:true,operations:results});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  if(message==='Sesión no válida.')return response({error:message},401);
  if(message.startsWith('MFA_'))return response({error:'Se requiere verificar tu sesión con MFA.',code:message==='MFA_REQUIRED'?'MFA_REQUIRED':'MFA_UNAVAILABLE'},403);
  return response({error:'No se pudo gestionar la cancelación. Actualiza el pedido y revisa si ya hay una solicitud en curso.'},400);
 }
});
