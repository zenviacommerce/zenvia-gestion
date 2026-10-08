import {createAdminClient,authenticateUser} from '../_shared/amazon/supabase.ts';
import {shopifyAccountCredentials,shopifyStoredApplicationCredentials,shopifyError} from '../_shared/shopifyAuth.ts';
import {confirmShopifyShipment} from '../_shared/shopifyShipment.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
async function confirm(admin:any,ownerId:string,orderId:string){
 const found=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',ownerId).maybeSingle();
 if(found.error)throw found.error;const order=found.data;if(!order)throw new Error('Pedido no encontrado.');
 if(order.source_channel!=='shopify')return {status:'not_applicable'};
 if(!order.label_created_at||!order.tracking_number)throw new Error('La etiqueta no tiene seguimiento guardado. Activa guardar seguimiento para confirmar Shopify.');
 if(order.shopify_tracking_synced_at&&order.shopify_tracking_synced_number===order.tracking_number)return {status:'already_synced'};
 const lease=crypto.randomUUID();
 const claim=await admin.rpc('integration_shopify_claim_shipment',{p_order_id:orderId,p_owner_id:ownerId,p_lease:lease});
 if(claim.error)throw claim.error;const current=claim.data?.[0];if(!current)throw new Error('La confirmación Shopify ya está en curso.');
 try{
  const account=await admin.from('integration_accounts').select('*').eq('id',current.source_integration_account_id).eq('owner_id',ownerId).eq('provider','shopify').eq('enabled',true).neq('status','disabled').maybeSingle();
  if(account.error)throw account.error;if(!account.data)throw new Error('La cuenta Shopify del pedido está desconectada.');
  const c=await shopifyAccountCredentials(admin,account.data,await shopifyStoredApplicationCredentials(admin,ownerId));
  const deadline=Date.now()+120000;
  const request=async(query:string,variables:any)=>{
   if(Date.now()>=deadline)throw new Error('Shopify tardó demasiado. La confirmación se reintentará.');
   const res=await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':c.accessToken},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(Math.min(20000,deadline-Date.now()))});
   const payload=await res.json().catch(()=>({}));
   if(!res.ok||payload.errors?.length){const message=payload.errors?.map((e:any)=>e.message).join(' · ')||`Shopify (${res.status})`;throw new Error(/access denied|access scope/i.test(message)?'Faltan permisos Shopify: read_merchant_managed_fulfillment_orders y write_merchant_managed_fulfillment_orders. Actualiza la app y vuelve a conectar la tienda.':message);}
   return payload.data;
  };
  const result=await confirmShopifyShipment(request,{orderId:current.order_id,number:current.tracking_number,company:current.carrier_name||current.carrier_code||'Transportista',url:current.tracking_url});
  const now=new Date().toISOString();
  const saved=await admin.from('fulfillment_orders').update({shopify_tracking_synced_at:now,shopify_tracking_synced_number:current.tracking_number,shopify_tracking_sync_error:null,source_status:'shipped',fulfilled_at:current.fulfilled_at||now}).eq('id',orderId).eq('owner_id',ownerId).eq('shopify_tracking_lease',lease).eq('tracking_number',current.tracking_number);
  if(saved.error)throw saved.error;return result;
 }catch(error){
  const saved=await admin.from('fulfillment_orders').update({shopify_tracking_sync_error:shopifyError(error)}).eq('id',orderId).eq('owner_id',ownerId).eq('shopify_tracking_lease',lease);if(saved.error)console.error('No se pudo guardar la incidencia Shopify.');throw error;
 }finally{await admin.from('fulfillment_orders').update({shopify_tracking_lease:null,shopify_tracking_lease_until:null}).eq('id',orderId).eq('owner_id',ownerId).eq('shopify_tracking_lease',lease);}
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return response({error:'Método no permitido.'},405);
 try{
  const admin=createAdminClient(),caller=await authenticateUser(req,admin);
  if(caller.role!=='admin'&&!caller.permissions?.includes('orders'))return response({error:'No tienes permiso para gestionar pedidos.'},403);
  const body=await req.json().catch(()=>({}));
  if(body.action==='retry_pending'){
   const rule=await admin.from('automation_rules').select('enabled,config').eq('owner_id',caller.data_owner_id).eq('rule_key','order_label_created').maybeSingle();if(rule.error)throw rule.error;
   if(rule.data&&(rule.data.enabled===false||rule.data.config?.pushToMarketplace===false||rule.data.config?.retryConfirmation===false||rule.data.config?.saveTracking===false))return response({ok:true,retried:0});
   const pending=await admin.rpc('integration_shopify_pending_shipments',{p_owner_id:caller.data_owner_id});
   if(pending.error)throw pending.error;const results=[];
   for(const row of (pending.data||[]).filter((r:any)=>!r.shopify_tracking_synced_at||r.shopify_tracking_synced_number!==r.tracking_number).slice(0,5)){try{results.push({orderId:row.id,...await confirm(admin,caller.data_owner_id,row.id)})}catch(error){results.push({orderId:row.id,error:shopifyError(error)})}}
   return response({ok:true,retried:results.length,results});
  }
  if(body.action!=='confirm_order_tracking')return response({error:'Acción no válida.'},400);
  return response({ok:true,...await confirm(admin,caller.data_owner_id,String(body.orderId||''))});
 }catch(error){const message=shopifyError(error);return response({error:message},/Sesión no válida/.test(message)?401:500);}
});
