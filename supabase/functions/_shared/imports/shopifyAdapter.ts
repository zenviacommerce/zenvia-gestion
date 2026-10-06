import {checked,guardImportItem} from './repository.ts';
import type {ImportJob,ImportItem,ImportOutcome} from '../../../../shared/imports/contracts.ts';
const clean=(value:unknown)=>String(value??'').trim();
async function readSecret(admin:any,secretId:string|null){
  if(!secretId)return {};
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales de Shopify no tienen un formato válido.')}
}
function normalizeDomain(value:unknown){return clean(value).toLowerCase().replace(/^https?:\/\//,'').replace(/\/+$/,'');}
async function credentials(admin:any,account:any){
  const stored=await readSecret(admin,account.secret_id||null);
  const shopDomain=normalizeDomain(stored.shopDomain||stored.shop_domain||account.external_account_id||account.config?.shopDomain);
  const accessToken=clean(stored.accessToken||stored.access_token);
  const apiVersion=clean(account.config?.apiVersion)||'2026-07';
  if(!shopDomain||!accessToken)throw new Error('Faltan dominio o access token de Shopify.');
  return {shopDomain,accessToken,apiVersion};
}
async function gql(c:any,query:string,variables:Record<string,unknown>={}){
  const res=await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/graphql.json`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json','X-Shopify-Access-Token':c.accessToken},
    body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(20000),
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
      displayFulfillmentStatus displayFinancialStatus
      email phone
      totalPriceSet{shopMoney{amount currencyCode}}
      customer{displayName email phone}
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
  const status=clean(order?.displayFulfillmentStatus).toUpperCase();
  if(status==='FULFILLED')return 'shipped';
  if(status==='PARTIALLY_FULFILLED')return 'partially_shipped';
  if(status==='RESTOCKED')return 'cancelled';
  return 'pending';
}

export async function executeShopify(admin:any,job:ImportJob,item:ImportItem):Promise<ImportOutcome>{
 const account=await checked<any>(admin.from('integration_accounts').select('*').eq('id',item.input.accountId).eq('owner_id',job.owner_id).eq('provider','shopify').eq('enabled',true).single());
 if(account.credential_source==='derived'||account.config?.syncOrders===false)return {status:'skipped',stage:'Cuenta sin sincronización directa'};
 const c=await credentials(admin,account);const since=new Date(job.created_at);since.setUTCDate(since.getUTCDate()-(job.options.history?365:14));
 const data=await gql(c,ORDER_QUERY,{first:100,after:item.checkpoint.after||null,query:`updated_at:>=${since.toISOString().slice(0,10)}`});
 const connection=data?.orders;if(!connection)throw new Error('Shopify no devolvió la página de pedidos.');
 const orders=connection.nodes||[],now=new Date().toISOString();
        const rows=orders.map((order:any)=>{
          const ship=shippingAddress(order.shippingAddress||{});
          const bill=shippingAddress(order.billingAddress||{});
          const tracking=latestTracking(order);
          const total=order?.totalPriceSet?.shopMoney;
          const remoteId=clean(order.legacyResourceId||order.id);
          return {
            owner_id:job.owner_id,
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
            customer_name:clean(order.customer?.displayName||ship.name)||null,
            customer_email:clean(order.email||order.customer?.email)||null,
            customer_phone:clean(order.phone||order.customer?.phone||ship.phone_number)||null,
            shipping_address:{...ship,email:clean(order.email||order.customer?.email)||null},
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

 await guardImportItem(admin,job,item);
 if(rows.length)await checked(admin.rpc('import_order_write',{p_item:item.id,p_lease:item.lease_token,p_action:'upsert',p_rows:rows}));
 const synced=(Number(item.checkpoint.synced)||0)+rows.length;const after=connection.pageInfo?.hasNextPage?connection.pageInfo.endCursor:null;
 return {status:after?'queued':'imported',stage:after?`Shopify · ${synced} pedidos`:'Pedidos actualizados',checkpoint:{after,synced},result:{synced,accountId:account.id}};
}
