import {requireInternalSecret} from '../_shared/amazon/supabase.ts';
import {resolveOrderPackageWeight} from '../_shared/orderPackageWeight.ts';
import {assertHumanMfa} from '../_shared/mfa.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { shopifyAccountCredentials, shopifyError, shopifyStoredApplicationCredentials } from '../_shared/shopifyAuth.ts';
import { preserveShopifyLabelTracking } from '../_shared/shopifyShipment.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function clean(value:unknown){return String(value??'').trim();}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return String(parsed.default)}catch{}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
async function authenticate(req:Request,admin:any){
  const token=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Sesión no válida.');
  await assertHumanMfa(req,false);
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para sincronizar pedidos.');
  return caller;
}
async function readSecret(admin:any,secretId:string|null){
  if(!secretId)return {};
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales de Shopify no tienen un formato válido.')}
}
function normalizeDomain(value:unknown){return clean(value).toLowerCase().replace(/^https?:\/\//,'').replace(/\/+$/,'');}
async function credentials(admin:any,account:any){
  return shopifyAccountCredentials(admin,account,await shopifyStoredApplicationCredentials(admin,account.owner_id));
}
async function gql(c:any,query:string,variables:Record<string,unknown>={}){
  const res=await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/graphql.json`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json','X-Shopify-Access-Token':c.accessToken},
    body:JSON.stringify({query,variables}),
  });
  const text=await res.text();let payload:any={};try{payload=JSON.parse(text)}catch{}
  if(!res.ok)throw new Error(`Shopify (${res.status}): ${clean(payload?.errors?.[0]?.message||text).slice(0,700)}`);
  if(Array.isArray(payload?.errors)&&payload.errors.length)throw new Error('Shopify: '+payload.errors.map((item:any)=>clean(item?.message)).filter(Boolean).join(' · '));
  return payload?.data;
}
const ORDER_QUERY=`
query ZenviaOrders($first:Int!,$after:String,$query:String){
  orders(first:$first,after:$after,sortKey:UPDATED_AT,reverse:true,query:$query){
    pageInfo{hasNextPage endCursor}
    nodes{
      id legacyResourceId name createdAt updatedAt taxesIncluded
      cancelledAt displayFulfillmentStatus displayFinancialStatus
      email phone
      totalPriceSet{shopMoney{amount currencyCode}}
      shippingAddress{name company address1 address2 city province provinceCode zip countryCodeV2 phone}
      billingAddress{name company address1 address2 city province provinceCode zip countryCodeV2 phone}
      lineItems(first:100){pageInfo{hasNextPage endCursor} nodes{id name sku variant{id} quantity weight{value unit} originalUnitPriceSet{shopMoney{amount currencyCode}} discountAllocations{allocatedAmountSet{shopMoney{amount currencyCode}}} taxLines{rate priceSet{shopMoney{amount currencyCode}}} image{url}}}
      shippingLines(first:100){pageInfo{hasNextPage} nodes{title discountedPriceSet{shopMoney{amount currencyCode}} taxLines{rate priceSet{shopMoney{amount currencyCode}}}}}
      fulfillments(first:20){id status createdAt updatedAt trackingInfo(first:10){company number url}}
    }
  }
}`;
function shippingAddress(address:any){
  return {
    name:clean(address?.name),
    company_name:clean(address?.company)||null,
    phone_number:clean(address?.phone)||null,
    email:null,
    address_line_1:clean(address?.address1),
    address_line_2:clean(address?.address2)||null,
    house_number:null,
    postal_code:clean(address?.zip),
    city:clean(address?.city),
    state_province_code:clean(address?.provinceCode)||null,
    state_province_name:clean(address?.province)||null,
    country_code:clean(address?.countryCodeV2).toUpperCase(),
  };
}
function mapItems(order:any){
  return (order?.lineItems?.nodes||[]).map((item:any)=>({
    id:clean(item?.id),
    name:clean(item?.name)||'Producto Shopify',
    sku:clean(item?.sku||item?.variant?.id)||null,
    quantity:Number(item?.quantity)||1,
    unit_price:Number(item?.originalUnitPriceSet?.shopMoney?.amount)||0,
    image_url:clean(item?.image?.url)||null,
    measurement:item.weight?{weight:item.weight}:null,
    weight_source:item.weight?'shopify_variant':null,
  }));
}
function latestTracking(order:any){
  const fulfillments=Array.isArray(order?.fulfillments)?order.fulfillments:[];
  for(const fulfillment of fulfillments){
    const info=Array.isArray(fulfillment?.trackingInfo)?fulfillment.trackingInfo.find((item:any)=>clean(item?.number)||clean(item?.url)):null;
    if(info)return {
      fulfillment,
      number:clean(info.number)||null,
      url:clean(info.url)||null,
      company:clean(info.company)||null,
    };
  }
  return null;
}
function sourceStatus(order:any){
  if(order.cancelledAt)return 'cancelled';
  const status=clean(order?.displayFulfillmentStatus).toUpperCase();
  if(status==='FULFILLED')return 'shipped';
  if(status==='PARTIALLY_FULFILLED')return 'partially_shipped';
  if(status==='RESTOCKED')return 'cancelled';
  return 'pending';
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return response({error:'Configuración interna no disponible.'},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const runStartedAt=new Date().toISOString();
    const body=await req.json().catch(()=>({}));
    const internal=Object.prototype.hasOwnProperty.call(body,'ownerId');
    let caller:any;
    if(internal){
      requireInternalSecret(req);
      if(!clean(body.ownerId)||!clean(body.integrationAccountId)||!['webhook','cron'].includes(body.syncSource))throw new Error('Llamada interna no autorizada.');
      const {data:workspace,error}=await admin.from('workspaces').select('status').eq('id',body.ownerId).maybeSingle();
      if(error)throw error;
      if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('El acceso de tu empresa está suspendido.');
      caller={data_owner_id:clean(body.ownerId)};
    }else caller=await authenticate(req,admin);
    const target=internal?clean(body.orderId):'';
    if(target&&!/^\d+$/.test(target))throw new Error('ID de pedido Shopify inválido.');
    const source=internal?body.syncSource:'browser';
    const receivedAt=internal&&body.receivedAt?new Date(body.receivedAt).toISOString():runStartedAt;
    const history=Boolean(body?.history);
    const requestedId=clean(body?.integrationAccountId);
    let query=admin.from('integration_accounts')
      .select('*')
      .eq('owner_id',caller.data_owner_id)
      .eq('provider','shopify')
      .eq('enabled',true)
      .neq('status','disabled');
    if(requestedId)query=query.eq('id',requestedId);
    const {data:accounts,error:accountsError}=await query;
    if(accountsError)throw accountsError;
    const directAccounts=(accounts||[]).filter((account:any)=>account.credential_source!=='derived'&&account.config?.syncOrders!==false);
    if(internal&&!directAccounts.length)throw new Error('Cuenta Shopify no disponible.');
    if(!directAccounts.length)return response({ok:true,synced:0,accounts:[],configured:false});


    let synced=0;
    const results:any[]=[];
    for(const account of directAccounts){
      try{
      const cursor=Date.parse(account.config?.shopify_orders_cursor_at||'');
      const minDate=new Date(!history&&Number.isFinite(cursor)?cursor-6*3600000:Date.parse(runStartedAt)-(history?365:14)*86400000);
      const orderQuery=target?`id:${target}`:`updated_at:>=${minDate.toISOString()} updated_at:<=${runStartedAt}`;
      const c=await credentials(admin,account);
      let after:string|null=null,accountSynced=0,pages=0;
      let scopedOrderQuery=ORDER_QUERY;
      do{
        let data:any;
        try{data=await gql(c,scopedOrderQuery,{first:100,after,query:orderQuery});}
        catch(error){if(!/access denied.*variant|access.*read_products/i.test(shopifyError(error)))throw error;scopedOrderQuery=scopedOrderQuery.replaceAll('variant{id}','');data=await gql(c,scopedOrderQuery,{first:100,after,query:orderQuery});}
        const connection=data?.orders;
        if(!Array.isArray(connection?.nodes)||typeof connection?.pageInfo?.hasNextPage!=='boolean')throw new Error('Shopify no devolvió una página de pedidos completa.');
        const orders=connection.nodes;
        if(target&&orders.some((order:any)=>clean(order.legacyResourceId||clean(order.id).split('/').pop())!==target))throw new Error('Shopify devolvió un pedido distinto al solicitado.');
        // Never rate a truncated basket. Fetch all remaining line-item pages.
        for(const order of orders){
          const lineFields=scopedOrderQuery.match(/lineItems\(first:100\)\{pageInfo\{hasNextPage endCursor\} nodes\{([\s\S]*?)\}\}\n/)?.[1];
          while(order.lineItems?.pageInfo?.hasNextPage){
            const cursor=order.lineItems.pageInfo.endCursor;if(!cursor||!lineFields)throw new Error('Shopify: faltan líneas del pedido para calcular el peso.');
            const next=await gql(c,`query ZenviaOrderRemainingLines($id:ID!,$after:String!){order(id:$id){lineItems(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{${lineFields}}}}}`,{id:order.id,after:cursor});
            const page=next?.order?.lineItems;if(!page||page.pageInfo?.endCursor===cursor)throw new Error('Shopify: no se pudieron completar las líneas del pedido.');
            order.lineItems.nodes.push(...page.nodes);order.lineItems.pageInfo=page.pageInfo;
          }
        }
        const now=new Date().toISOString();
        const rows=orders.map((order:any)=>{
          const ship=shippingAddress(order.shippingAddress||{});
          const bill=shippingAddress(order.billingAddress||{});
          const tracking=latestTracking(order);
          const total=order?.totalPriceSet?.shopMoney;
          const remoteId=clean(order.legacyResourceId||clean(order.id).split('/').pop());
          return {
            owner_id:caller.data_owner_id,
            sendcloud_id:`shopify:${account.id}:${remoteId}`,
            sendcloud_remote_id:null,
            source_integration_account_id:account.id,
            order_id:clean(order.id)||remoteId,
            order_number:clean(order.name)||remoteId,
            integration_id:0,
            integration_name:account.display_name||c.shopDomain,
            integration_type:'shopify-direct',
            source_channel:'shopify',
            source_status:sourceStatus(order),
            order_created_at:order.createdAt||now,
            order_updated_at:order.updatedAt||now,
            customer_name:clean(ship.name||bill.name)||null,
            customer_email:clean(order.email)||null,
            customer_phone:clean(order.phone||ship.phone_number||bill.phone_number)||null,
            shipping_address:{...ship,email:clean(order.email)||null},
            billing_address:bill,
            items:mapItems(order),
            total_amount:total?.amount==null?null:Number(total.amount),
            currency:clean(total?.currencyCode)||null,
            raw_payload:{...order,provider:'shopify',shop_domain:c.shopDomain,integration_account_id:account.id},
            tracking_number:tracking?.number||null,
            tracking_url:tracking?.url||null,
            carrier_name:tracking?.company||null,
            tracking_status_code:tracking?.fulfillment?.status||null,
            tracking_status_message:tracking?.fulfillment?.status||null,
            tracking_updated_at:tracking?.fulfillment?.updatedAt||null,
            fulfilled_at:tracking?.fulfillment?.createdAt||null,
            last_synced_at:now,
          };
        });
        if(rows.length){
          const previous=await admin.from('fulfillment_orders').select('sendcloud_id,order_updated_at,label_created_at,label_cancelled_at,tracking_number,tracking_url,carrier_name,tracking_status_code,tracking_status_message,tracking_updated_at,fulfilled_at,raw_payload').eq('owner_id',caller.data_owner_id).in('sendcloud_id',rows.map((row:any)=>row.sendcloud_id));
          if(previous.error)throw previous.error;
          const freshRows=rows.filter((row:any)=>{const old=(previous.data||[]).find((p:any)=>p.sendcloud_id===row.sendcloud_id);return !old?.order_updated_at||Date.parse(old.order_updated_at)<=Date.parse(row.order_updated_at);});
          const merged=preserveShopifyLabelTracking(freshRows,previous.data||[]);
          const {data:settings,error:settingsError}=await admin.from('app_settings').select('config').eq('owner_id',caller.data_owner_id).maybeSingle();if(settingsError)throw settingsError;
          for(const row of merged){const old=(previous.data||[]).find((p:any)=>p.sendcloud_id===row.sendcloud_id);if(old?.raw_payload?.shipping_details){row.raw_payload={...row.raw_payload,shipping_details:old.raw_payload.shipping_details,_zenvia_weight:old.raw_payload._zenvia_weight};}if(old?.raw_payload?._zenvia_local_shipping_updated_at){row.raw_payload._zenvia_local_shipping_updated_at=old.raw_payload._zenvia_local_shipping_updated_at;}await resolveOrderPackageWeight(admin,{...row,label_created_at:old?.label_created_at},settings?.config?.shipping||{}).then(result=>{if(result){row.raw_payload._zenvia_weight=result;row.raw_payload.shipping_details={...(row.raw_payload.shipping_details||{}),measurement:{...(row.raw_payload.shipping_details?.measurement||{}),weight:{value:result.kg,unit:'kg'}}};}});}
          if(merged.length){const {error}=await admin.from('fulfillment_orders').upsert(merged,{onConflict:'owner_id,sendcloud_id'});if(error)throw error;}
          for(const row of rows){const traced=await admin.rpc('shopify_record_order_ingestion',{owner:caller.data_owner_id,store:account.id,remote_order_id:clean(row.raw_payload.legacyResourceId||clean(row.raw_payload.id).split('/').pop()),remote_created_at:row.order_created_at,destination:'operational',source,received_at:receivedAt});if(traced.error)throw traced.error;}
        }
        accountSynced+=rows.length;synced+=rows.length;pages+=1;
        if(!connection?.pageInfo)throw new Error('Shopify no devolvió una página de pedidos completa.');
        const previousCursor=after;
        after=connection.pageInfo.hasNextPage?clean(connection.pageInfo.endCursor):null;
        if(connection.pageInfo.hasNextPage&&(!after||after===previousCursor||pages>=20))throw new Error('Shopify: importación incompleta; no se avanzó el cursor.');
      }while(after&&pages<20);
      if(target&&!accountSynced)throw new Error('Shopify: pedido solicitado no encontrado.');
      if(!target){
        const committed=await admin.rpc('shopify_commit_orders_cursor',{owner:caller.data_owner_id,store:account.id,checkpoint_at:runStartedAt});
        if(committed.error)throw committed.error;
        if(committed.data!==true)throw new Error('No se pudo guardar el cursor de Shopify; la cuenta ya no está disponible.');
      }
      const saved=await admin.from('integration_accounts').update({status:'connected',last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',account.id).eq('owner_id',caller.data_owner_id).eq('enabled',true).neq('status','disabled').select('id').maybeSingle();
      if(!saved.data&&!saved.error)throw new Error('Cuenta Shopify no disponible.');
      if(saved.error)throw saved.error;
      results.push({accountId:account.id,displayName:account.display_name,synced:accountSynced,shopDomain:c.shopDomain});
      }catch(error){results.push({accountId:account.id,synced:0,error:shopifyError(error)});}
    }
    return response({ok:results.every(r=>!r.error),configured:true,synced,accounts:results,history});
  }catch(error){
    const message=shopifyError(error,'Error interno.');
    return response({error:message},/Sesión no válida|no autorizada/.test(message)?401:/permiso|suspendido/.test(message)?403:500);
  }
});
