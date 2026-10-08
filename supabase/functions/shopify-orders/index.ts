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
      id legacyResourceId name createdAt updatedAt
      cancelledAt displayFulfillmentStatus displayFinancialStatus
      email phone
      totalPriceSet{shopMoney{amount currencyCode}}
      shippingAddress{name company address1 address2 city provinceCode zip countryCodeV2 phone}
      billingAddress{name company address1 address2 city provinceCode zip countryCodeV2 phone}
      lineItems(first:100){nodes{id name sku quantity originalUnitPriceSet{shopMoney{amount currencyCode}} image{url}}}
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
    country_code:clean(address?.countryCodeV2).toUpperCase(),
  };
}
function mapItems(order:any){
  return (order?.lineItems?.nodes||[]).map((item:any)=>({
    id:clean(item?.id),
    name:clean(item?.name)||'Producto Shopify',
    sku:clean(item?.sku)||null,
    quantity:Number(item?.quantity)||1,
    unit_price:Number(item?.originalUnitPriceSet?.shopMoney?.amount)||0,
    image_url:clean(item?.image?.url)||null,
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
    const caller=await authenticate(req,admin);
    const body=await req.json().catch(()=>({}));
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
    if(!directAccounts.length)return response({ok:true,synced:0,accounts:[],configured:false});

    const minDate=new Date();
    minDate.setUTCDate(minDate.getUTCDate()-(history?365:14));
    const orderQuery=`updated_at:>=${minDate.toISOString().slice(0,10)}`;
    let synced=0;
    const results:any[]=[];
    for(const account of directAccounts){
      const c=await credentials(admin,account);
      let after:string|null=null,accountSynced=0,pages=0;
      do{
        const data=await gql(c,ORDER_QUERY,{first:100,after,query:orderQuery});
        const connection=data?.orders;
        const orders=connection?.nodes||[];
        const now=new Date().toISOString();
        const rows=orders.map((order:any)=>{
          const ship=shippingAddress(order.shippingAddress||{});
          const bill=shippingAddress(order.billingAddress||{});
          const tracking=latestTracking(order);
          const total=order?.totalPriceSet?.shopMoney;
          const remoteId=clean(order.legacyResourceId||order.id);
          return {
            owner_id:caller.data_owner_id,
            sendcloud_id:`shopify:${account.id}:${remoteId}`,
            sendcloud_remote_id:null,
            shipping_integration_account_id:null,
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
          const previous=await admin.from('fulfillment_orders').select('sendcloud_id,label_created_at,label_cancelled_at,tracking_number,tracking_url,carrier_name,tracking_status_code,tracking_status_message,tracking_updated_at,fulfilled_at,raw_payload').eq('owner_id',caller.data_owner_id).in('sendcloud_id',rows.map((row:any)=>row.sendcloud_id));
          if(previous.error)throw previous.error;
          const {error}=await admin.from('fulfillment_orders').upsert(preserveShopifyLabelTracking(rows,previous.data||[]),{onConflict:'owner_id,sendcloud_id'});
          if(error)throw error;
        }
        accountSynced+=rows.length;synced+=rows.length;pages+=1;
        after=connection?.pageInfo?.hasNextPage?clean(connection.pageInfo.endCursor):null;
      }while(after&&pages<20);
      await admin.from('integration_accounts').update({status:'connected',last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',account.id).eq('owner_id',caller.data_owner_id).eq('enabled',true).neq('status','disabled');
      results.push({accountId:account.id,displayName:account.display_name,synced:accountSynced,shopDomain:c.shopDomain});
    }
    return response({ok:true,configured:true,synced,accounts:results,history});
  }catch(error){
    const message=shopifyError(error,'Error interno.');
    return response({error:message},/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:500);
  }
});
