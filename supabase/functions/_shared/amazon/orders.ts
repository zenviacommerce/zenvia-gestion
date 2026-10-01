import { spApiRequest } from './sp-api.ts';
import { loadAmazonSpApiCredentials } from './config.ts';

const INCLUDED_DATA=['PROCEEDS','EXPENSE','PROMOTION','CANCELLATION','FULFILLMENT','TAX'];
const OPERATIONAL_INCLUDED_DATA=[...INCLUDED_DATA,'BUYER','RECIPIENT'];
const SAFE_LAG_MS=2*60*1000;

type Money={amount?:string|number|null;currencyCode?:string|null}|null|undefined;
function money(value:Money){const n=Number(value?.amount);return Number.isFinite(n)?n:null;}
function currency(value:Money){return value?.currencyCode?String(value.currencyCode):null;}
function minIso(value:string|undefined|null,limit:Date){if(!value)return limit.toISOString();const date=new Date(value);return (date<limit?date:limit).toISOString();}
function programs(order:any){return (Array.isArray(order?.programs)?order.programs:[]).map((value:any)=>String(value||'').trim().toUpperCase()).filter(Boolean);}

function proceedsBreakdown(proceeds:any,matcher:(type:string)=>boolean){
  const item=(proceeds?.breakdowns||[]).find((entry:any)=>matcher(String(entry?.type||'').toUpperCase()));
  return item?.subtotal||item?.value||null;
}
function taxMoney(proceeds:any){return proceedsBreakdown(proceeds,type=>type==='TAX');}
function shippingMoney(proceeds:any){return proceedsBreakdown(proceeds,type=>type.includes('SHIPPING')||type.includes('DELIVERY'));}
function discountMoney(proceeds:any){return proceedsBreakdown(proceeds,type=>type.includes('DISCOUNT')||type.includes('PROMOTION'));}

function clean(value:unknown){return String(value??'').trim();}
function merchantFulfilled(order:any){return clean(order?.fulfillment?.fulfilledBy).toUpperCase()==='MERCHANT';}
function operationalAddress(order:any){
  const address=order?.recipient?.deliveryAddress||{};
  const extended=address?.extendedFields||{};
  return {
    name:clean(address.name||order?.buyer?.buyerName)||null,
    company_name:clean(address.companyName||order?.buyer?.buyerCompanyName)||null,
    address_line_1:clean(address.addressLine1)||null,
    house_number:clean(extended.streetNumber)||null,
    address_line_2:[address.addressLine2,address.addressLine3].map(clean).filter(Boolean).join(' · ')||null,
    postal_code:clean(address.postalCode)||null,
    city:clean(address.city||address.municipality)||null,
    state_province_code:clean(address.stateOrRegion||address.districtOrCounty)||null,
    country_code:clean(address.countryCode).toUpperCase()||null,
    email:clean(order?.buyer?.buyerEmail)||null,
    phone_number:clean(address.phone)||null,
  };
}
function operationalItems(order:any){
  return (Array.isArray(order?.orderItems)?order.orderItems:[]).map((item:any)=>{
    const product=item?.product||{},proceeds=item?.proceeds||null;
    const itemAmount=proceedsBreakdown(proceeds,type=>type==='ITEM')||proceeds?.proceedsTotal||null;
    const quantity=Math.max(1,Number(item?.quantityOrdered)||1);
    const total=money(itemAmount);
    return {
      item_id:clean(item?.orderItemId)||null,
      sku:clean(product?.sellerSku)||null,
      product_id:clean(product?.asin)||null,
      name:clean(product?.title||product?.productName||product?.name||product?.sellerSku||product?.asin)||'Producto Amazon',
      quantity,
      unit_price:total==null?null:{value:Number((total/quantity).toFixed(2)),currency:currency(itemAmount)||'EUR'},
      total_price:total==null?null:{value:total,currency:currency(itemAmount)||'EUR'},
    };
  });
}
function mergeOperationalItems(existing:any[],fresh:any[]){
  const previous=Array.isArray(existing)?existing:[];
  return fresh.map(item=>{
    const match=previous.find(old=>clean(old?.item_id)===clean(item.item_id))
      ||previous.find(old=>clean(old?.sku)&&clean(old?.sku)===clean(item.sku))
      ||previous.find(old=>clean(old?.product_id)&&clean(old?.product_id)===clean(item.product_id));
    return match?{...match,...item,image_url:match.image_url||null,measurement:match.measurement||null}:item;
  });
}
async function amazonIntegrationAccount(admin:any,job:any){
  const {data,error}=await admin.from('integration_accounts')
    .select('id,config')
    .eq('owner_id',job.owner_id)
    .eq('provider','amazon')
    .eq('linked_resource_id',job.amazon_account_id)
    .eq('enabled',true)
    .neq('status','disabled')
    .maybeSingle();
  if(error)throw error;
  return data||null;
}
async function amazonIntegrationAccountId(admin:any,job:any){
  const account=await amazonIntegrationAccount(admin,job);
  return account?.id?String(account.id):null;
}
async function markOperationalReadiness(admin:any,job:any,status:'ready'|'pii_permission_missing',message=''){
  const account=await amazonIntegrationAccount(admin,job);
  if(!account?.id)return;
  const config=(account.config&&typeof account.config==='object'&&!Array.isArray(account.config))?account.config:{};
  const current=(config as any).operationalOrdersDirect||{};
  if(current?.status===status&&String(current?.message||'')===message)return;
  const next={
    ...config,
    operationalOrdersDirect:{
      status,
      checkedAt:new Date().toISOString(),
      ...(message?{message}:{}),
    },
  };
  const {error}=await admin.from('integration_accounts').update({config:next}).eq('id',account.id).eq('owner_id',job.owner_id);
  if(error)throw error;
}
async function fallbackWeightKg(admin:any,ownerId:string){
  const {data,error}=await admin.from('app_settings').select('config').eq('owner_id',ownerId).maybeSingle();
  if(error)throw error;
  const value=Number(data?.config?.shipping?.fallbackWeightKg);
  return Number.isFinite(value)&&value>0?value:1;
}
async function upsertOperationalAmazonOrders(admin:any,orders:any[],job:any){
  const candidates=orders.filter(order=>order?.orderId&&merchantFulfilled(order)&&order?.recipient?.deliveryAddress);
  if(!candidates.length)return 0;
  const sourceIntegrationAccountId=await amazonIntegrationAccountId(admin,job);
  if(!sourceIntegrationAccountId)return 0;
  const orderIds=candidates.map(order=>String(order.orderId));
  const {data:existing,error:existingError}=await admin.from('fulfillment_orders')
    .select('*')
    .eq('owner_id',job.owner_id)
    .eq('source_channel','amazon')
    .in('order_number',orderIds);
  if(existingError)throw existingError;
  const existingByOrder=new Map((existing||[]).map((row:any)=>[String(row.order_number||row.order_id||''),row]));
  const fallbackWeight=await fallbackWeightKg(admin,job.owner_id);
  let synced=0;
  for(const order of candidates){
    const orderId=String(order.orderId),current=existingByOrder.get(orderId)||null;
    const address=operationalAddress(order),freshItems=operationalItems(order);
    const grandTotal=order?.proceeds?.grandTotal||null;
    const rawPayload={
      ...(current?.raw_payload&&typeof current.raw_payload==='object'?current.raw_payload:{}),
      amazon:{
        marketplaceId:clean(order?.salesChannel?.marketplaceId||job.marketplace_id),
        programs:programs(order),
        deliveryPreference:order?.recipient?.deliveryPreference||null,
      },
      shipping_details:{
        ...(current?.raw_payload?.shipping_details||{}),
        measurement:{
          ...(current?.raw_payload?.shipping_details?.measurement||{}),
          weight:current?.raw_payload?.shipping_details?.measurement?.weight||{value:fallbackWeight,unit:'kg'},
        },
      },
    };
    const patch:any={
      order_id:orderId,order_number:orderId,
      source_integration_account_id:sourceIntegrationAccountId,
      integration_name:'Amazon',integration_type:'amazon-direct',source_channel:'amazon',
      source_status:clean(order?.fulfillment?.fulfillmentStatus)||null,
      order_created_at:order?.createdTime||null,order_updated_at:order?.lastUpdatedTime||null,
      customer_name:address.name||clean(order?.buyer?.buyerName)||null,
      customer_email:address.email||null,customer_phone:address.phone_number||null,
      shipping_address:address,
      items:mergeOperationalItems(current?.items||[],freshItems),
      total_amount:money(grandTotal),currency:currency(grandTotal)||null,
      raw_payload:rawPayload,last_synced_at:new Date().toISOString(),
    };
    if(current?.id){
      const {error:updateError}=await admin.from('fulfillment_orders').update(patch).eq('id',current.id).eq('owner_id',job.owner_id);
      if(updateError)throw updateError;
    }else{
      const syntheticId=`amazon:${job.amazon_account_id}:${orderId}`;
      const {error:insertError}=await admin.from('fulfillment_orders').insert({
        owner_id:job.owner_id,sendcloud_id:syntheticId,integration_id:0,billing_address:{},...patch,
      });
      if(insertError){
        if(String(insertError?.code||'')==='23505'){
          const {error:updateError}=await admin.from('fulfillment_orders').update(patch).eq('owner_id',job.owner_id).eq('sendcloud_id',syntheticId);
          if(updateError)throw updateError;
        }else throw insertError;
      }
    }
    synced+=1;
  }
  return synced;
}

export function normalizeAmazonOrder(order:any,job:any){
  const marketplaceId=String(order?.salesChannel?.marketplaceId||job.marketplace_id||'');
  const grandTotal=order?.proceeds?.grandTotal||null;
  const tax=taxMoney(order?.proceeds);
  const shipping=shippingMoney(order?.proceeds);
  const discount=discountMoney(order?.proceeds);
  const orderPrograms=programs(order);
  return {
    owner_id:job.owner_id,
    amazon_account_id:job.amazon_account_id,
    amazon_order_id:String(order?.orderId||''),
    marketplace_id:marketplaceId,
    purchase_date:order?.createdTime||null,
    last_update_date:order?.lastUpdatedTime||null,
    order_status:order?.fulfillment?.fulfillmentStatus||null,
    fulfillment_channel:order?.fulfillment?.fulfilledBy||null,
    sales_channel:order?.salesChannel?.channelName||null,
    currency_code:currency(grandTotal)||currency(tax)||null,
    gross_sales:money(grandTotal),
    vat_amount:money(tax),
    shipping_amount:money(shipping),
    promotion_discount:money(discount),
    order_total:money(grandTotal),
    programs:orderPrograms,
    is_business_order:orderPrograms.includes('AMAZON_BUSINESS'),
    synced_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
  };
}

export function normalizeAmazonOrderItems(order:any,job:any){
  const marketplaceId=String(order?.salesChannel?.marketplaceId||job.marketplace_id||'');
  return (order?.orderItems||[]).filter((item:any)=>item?.orderItemId).map((item:any)=>{
    const proceeds=item?.proceeds||null;
    const itemAmount=proceedsBreakdown(proceeds,type=>type==='ITEM')||proceeds?.proceedsTotal||null;
    const tax=taxMoney(proceeds);
    const shipping=shippingMoney(proceeds);
    const discount=discountMoney(proceeds);
    const unitPrice=item?.product?.price?.unitPrice||null;
    const quantity=Number(item?.quantityOrdered)||0;
    const derivedPrice=money(itemAmount)??(money(unitPrice)!=null?money(unitPrice)!*quantity:null);
    return {
      owner_id:job.owner_id,
      amazon_account_id:job.amazon_account_id,
      amazon_order_id:String(order?.orderId||''),
      marketplace_id:marketplaceId,
      order_item_id:String(item.orderItemId),
      asin:item?.product?.asin?String(item.product.asin):null,
      seller_sku:item?.product?.sellerSku?String(item.product.sellerSku):null,
      quantity_ordered:quantity,
      quantity_shipped:Number(item?.fulfillment?.quantityFulfilled)||0,
      item_price:derivedPrice,
      item_tax:money(tax),
      shipping_price:money(shipping),
      shipping_tax:null,
      promotion_discount:money(discount),
      currency_code:currency(itemAmount)||currency(unitPrice)||currency(tax)||null,
      synced_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    };
  });
}

async function upsertPage(admin:any,orders:any[],job:any){
  const orderRows=orders.filter(order=>order?.orderId).map(order=>normalizeAmazonOrder(order,job));
  const itemRows=orders.flatMap(order=>normalizeAmazonOrderItems(order,job));
  if(orderRows.length){
    const {error}=await admin.from('amazon_orders').upsert(orderRows,{onConflict:'owner_id,amazon_account_id,marketplace_id,amazon_order_id'});
    if(error)throw error;
  }
  if(itemRows.length){
    const {error}=await admin.from('amazon_order_items').upsert(itemRows,{onConflict:'owner_id,amazon_account_id,marketplace_id,amazon_order_id,order_item_id'});
    if(error)throw error;
  }
  const operational=await upsertOperationalAmazonOrders(admin,orders,job);
  return orderRows.length+itemRows.length+operational;
}

export async function syncOrdersJob(admin:any,job:any){
  if(!job?.marketplace_id||!job?.window_from)throw new Error('Job de pedidos incompleto.');
  const mode=String(job?.payload?.mode||'hourly');
  const safeBefore=new Date(Date.now()-SAFE_LAG_MS);
  const before=minIso(job.window_to,safeBefore);
  if(new Date(job.window_from)>=new Date(before))return 0;
  const baseQuery:any={
    marketplaceIds:[job.marketplace_id],
    maxResultsPerPage:100,
    includedData:OPERATIONAL_INCLUDED_DATA,
  };
  if(mode==='initial'){
    baseQuery.createdAfter=job.window_from;
    baseQuery.createdBefore=before;
  }else{
    baseQuery.lastUpdatedAfter=job.window_from;
    baseQuery.lastUpdatedBefore=before;
  }
  const credentials=await loadAmazonSpApiCredentials(admin,{amazonAccountId:job.amazon_account_id,ownerId:job.owner_id});
  let paginationToken:string|undefined;
  let processed=0;
  do{
    const query={...baseQuery,...(paginationToken?{paginationToken}:{})};
    let data:any;
    try{
      data=await spApiRequest('/orders/2026-01-01/orders',{query},credentials);
      await markOperationalReadiness(admin,job,'ready');
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(!/Amazon SP-API \(403\)/.test(message))throw error;
      await markOperationalReadiness(
        admin,
        job,
        'pii_permission_missing',
        'Amazon no ha autorizado BUYER/RECIPIENT para esta aplicación. El análisis sigue sincronizando, pero los pedidos operativos directos necesitan acceso PII de destinatario.',
      );
      data=await spApiRequest('/orders/2026-01-01/orders',{query:{...query,includedData:INCLUDED_DATA}},credentials);
    }
    const orders=Array.isArray(data?.orders)?data.orders:[];
    processed+=await upsertPage(admin,orders,job);
    paginationToken=data?.pagination?.nextToken||undefined;
  }while(paginationToken);
  return processed;
}
