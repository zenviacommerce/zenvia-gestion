import { supabase, getActiveSupabase } from './supabase';
import { isAmazonAwaitingPayment } from './orderStatus';
import {markOrderLabelCreated,ordersSnapshotVersion,publishOrdersSnapshot,readOrdersSnapshot,resetOrdersSnapshot} from './ordersSnapshot';
import { loadAutomationRule, type OrderLabelCreatedAutomationConfig } from './automationRules';
import type { ShippingSettings } from './settingsSchema';
import {collectProviderQuotes,type ProviderQuotes,type QuoteProvider} from './providerQuotes';
export type {ProviderQuotes,QuoteProvider} from './providerQuotes';

export type OrderChannel = 'amazon' | 'shopify' | 'other';

export interface FulfillmentOrder {
  id:string; sendcloudId:string; orderId:string|null; orderNumber:string|null;
  sourceIntegrationAccountId:string|null; shippingIntegrationAccountId:string|null;
  integrationId:number; integrationName:string|null; integrationType:string|null; sourceChannel:OrderChannel;
  sourceStatus:string|null; orderCreatedAt:string|null; orderUpdatedAt:string|null;
  customerName:string|null; customerEmail:string|null; customerPhone:string|null;
  piiPurgedAt?:string|null; destinationCountryCode?:string|null;
  shippingAddress:Record<string,unknown>; billingAddress:Record<string,unknown>; items:Array<Record<string,unknown>>;
  totalAmount:number|null; currency:string|null; weightKg:number|null;
  packageLengthCm:number|null; packageWidthCm:number|null; packageHeightCm:number|null;
  sendcloudParcelId:number|null; sendcloudShipmentId:string|null;
  shippingProvider:'sendcloud'|'envia'|'mrw'|null; shippingRemoteId:string|null; shippingLabelUrl:string|null;
  trackingNumber:string|null; trackingUrl:string|null; carrierTrackingUrl?:string|null; trackingStatusCode:string|null; trackingStatusMessage:string|null; trackingUpdatedAt:string|null;
  shippingOptionCode:string|null; contractId:number|null;
  carrierCode:string|null; carrierName:string|null; shippingServiceName:string|null;
  shippingCostAmount:number|null; shippingCostCurrency:string|null; shippingCostSource:string|null;
  shippingCostNetAmount:number|null; shippingCostTaxAmount:number|null; shippingCostRecordedAt:string|null;
  labelCreatedAt:string|null; labelPrintedAt:string|null; labelPrintCount:number; labelPrintStateKnown:boolean; fulfilledAt:string|null; lastSyncedAt:string;
}

export interface SendcloudIntegration {
  id:number; shopName:string; type:string; shopUrl?:string|null; channel:OrderChannel; isApi?:boolean;
  sendcloudAccountId?:string|null; sendcloudAccountName?:string|null;
}
export interface SendcloudStatus {
  configured:boolean;
  integrations:SendcloudIntegration[];
  accounts?:Array<{id:string|null;displayName:string}>;
  message?:string;
}
export interface OrderAddressValidation {
  ok:boolean;
  inputAddressIsValid:boolean|null;
  recommendedAddress:Record<string,unknown>|null;
  reasons:string[];
  invalidAttributes:string[];
}
export interface ShippingOption {
  provider:'sendcloud'|'envia'|'mrw';
  providerName:string;
  integrationAccountId?:string|null;
  integrationAccountName?:string|null;
  code:string; name:string; carrierCode:string; carrierName:string; contractId:number|null;
  price:number|null; currency:string|null; billedWeightKg?:number|null; etaDays?:number|null; raw:Record<string,unknown>;
}
export interface LabelResult {
  provider?:ShippingOption['provider'];
  parcelId:number; shipmentId:string|null; trackingNumber:string|null; trackingUrl:string|null;
  shippingOptionCode:string|null; contractId:number|null; carrierCode?:string|null; carrierName?:string|null;
  shippingServiceName?:string|null; mimeType:string; base64:string;
  automation?:OrderLabelCreatedAutomationConfig;
  confirmationError?:string;
}
export interface LocalPrinter { id:string; name:string; default?:boolean; }
export interface ManualOrderItem { name:string; sku?:string; quantity:number; unitPrice:number; }
export interface ManualOrderInput {
  integrationId?:number; shippingIntegrationAccountId?:string|null; orderNumber:string; customerName:string; companyName?:string; email?:string; phone?:string;
  address:string; houseNumber?:string; address2?:string; postalCode:string; city:string; countryCode:string;
  weightKg:number; items:ManualOrderItem[];
}
export interface OrderUpdateInput {
  customerName:string; companyName?:string; email?:string; phone?:string; address:string; houseNumber?:string;
  address2?:string; postalCode:string; city:string; stateProvince?:string; stateProvinceName?:string; countryCode:string; weightKg:number;
  packageLengthCm?:number; packageWidthCm?:number; packageHeightCm?:number;
}

const PRINTER_KEY='zenvia-label-printer';
const HISTORY_SYNC_KEY='zenvia-orders-history-sync';
const ENVIA_HISTORY_SYNC_KEY='zenvia-envia-history-sync';

function toKg(value:unknown,unit:unknown){
  const n=Number(value);if(!Number.isFinite(n)||n<=0)return null;
  const u=String(unit||'kg').toLowerCase();if(u==='g')return n/1000;if(u==='lbs'||u==='lb')return n*0.45359237;return n;
}
function isBalearicAddress(address:Record<string,unknown>){
  const country=String(address?.country_code||'').trim().toUpperCase();
  const postal=String(address?.postal_code||'').replace(/\s+/g,'').trim();
  return country==='ES'&&/^07\d{3}$/.test(postal);
}
function enforcePurge(order:FulfillmentOrder):FulfillmentOrder{
  if(!order.piiPurgedAt)return order;
  return {...order,customerName:null,customerEmail:null,customerPhone:null,
    shippingAddress:{},billingAddress:{},shippingLabelUrl:null,trackingUrl:null,carrierTrackingUrl:null};
}
function mapRow(row:any):FulfillmentOrder{
  const measurement=row?.shipping_measurement||{};
  const weight=measurement?.weight;
  const dimension=measurement?.dimension||measurement?.dimensions||{};
  const dimensionUnit=String(dimension?.unit||'cm').toLowerCase();
  const dimensionFactor=dimensionUnit==='in'||dimensionUnit==='inch'||dimensionUnit==='inches'?2.54:dimensionUnit==='mm'?0.1:1;
  const dimensionCm=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n*dimensionFactor:null};
  const shippingAddress=row.shipping_address||{};
  const balearicPending=isBalearicAddress(shippingAddress)&&row.sendcloud_parcel_id==null;
  return enforcePurge({
    id:row.id, sendcloudId:String(row.sendcloud_remote_id||row.sendcloud_id), orderId:row.order_id||null, orderNumber:row.order_number||null,
    sourceIntegrationAccountId:row.source_integration_account_id||null, shippingIntegrationAccountId:row.shipping_integration_account_id||null,
    integrationId:Number(row.integration_id), integrationName:row.integration_name||null, integrationType:row.integration_type||null,
    sourceChannel:(row.source_channel||'other') as OrderChannel, sourceStatus:row.source_status||null,
    orderCreatedAt:row.order_created_at||null, orderUpdatedAt:row.order_updated_at||null,
    customerName:row.customer_name||null, customerEmail:row.customer_email||null, customerPhone:row.customer_phone||null, piiPurgedAt:row.pii_purged_at||null, destinationCountryCode:row.destination_country_code||null,
    shippingAddress, billingAddress:row.billing_address||{}, items:Array.isArray(row.items)?row.items:[],
    totalAmount:row.total_amount==null?null:Number(row.total_amount), currency:row.currency||null, weightKg:toKg(weight?.value,weight?.unit),
    packageLengthCm:row.package_length_cm==null?dimensionCm(dimension?.length):Number(row.package_length_cm),
    packageWidthCm:row.package_width_cm==null?dimensionCm(dimension?.width):Number(row.package_width_cm),
    packageHeightCm:row.package_height_cm==null?dimensionCm(dimension?.height):Number(row.package_height_cm),
    sendcloudParcelId:row.sendcloud_parcel_id==null?null:Number(row.sendcloud_parcel_id),
    sendcloudShipmentId:row.sendcloud_shipment_id||null,
    shippingProvider:row.shipping_provider==='envia'?'envia':row.shipping_provider==='mrw'?'mrw':row.shipping_provider==='sendcloud'?'sendcloud':(row.sendcloud_parcel_id||row.sendcloud_shipment_id?'sendcloud':null),
    shippingRemoteId:row.shipping_remote_id||null, shippingLabelUrl:row.shipping_label_url||null,
    trackingNumber:row.tracking_number||null, trackingUrl:row.tracking_url||null,
    carrierTrackingUrl:row.tracking_metadata?.number===row.tracking_number?row.tracking_metadata?.url||null:null,
    trackingStatusCode:row.tracking_status_code||null, trackingStatusMessage:row.tracking_status_message||null, trackingUpdatedAt:row.tracking_updated_at||null,
    shippingOptionCode:row.shipping_option_code||null, contractId:row.contract_id==null?null:Number(row.contract_id),
    carrierCode:row.carrier_code||null, carrierName:row.carrier_name||(balearicPending?'🏝 Baleares · usar Correos':null), shippingServiceName:row.shipping_service_name||null,
    shippingCostAmount:row.shipping_cost_amount==null?null:Number(row.shipping_cost_amount), shippingCostCurrency:row.shipping_cost_currency||null, shippingCostSource:row.shipping_cost_source||null,
    shippingCostNetAmount:row.shipping_cost_net_amount==null?null:Number(row.shipping_cost_net_amount), shippingCostTaxAmount:row.shipping_cost_tax_amount==null?null:Number(row.shipping_cost_tax_amount), shippingCostRecordedAt:row.shipping_cost_recorded_at||null,
    labelCreatedAt:row.label_created_at||null, labelPrintedAt:row.label_printed_at||null, labelPrintCount:Number(row.label_print_count||0), labelPrintStateKnown:row.label_print_state_known!==false, fulfilledAt:row.fulfilled_at||null, lastSyncedAt:row.last_synced_at,
  });
}

async function invokeFunction<T>(functionName:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
  const {data,error}=await supabase.functions.invoke(functionName,{body,signal});
  if(error){
    let detail='';
    const context=(error as any)?.context;
    if(context instanceof Response){
      try{
        const payload=await context.clone().json();
        detail=String(payload?.error||payload?.message||'').trim();
      }catch{/* respuesta no JSON */}
    }
    throw Object.assign(new Error(detail||error.message||`No se pudo conectar con ${functionName==='envia-shipping'?'Envia.com':functionName.startsWith('sendcloud')?'Sendcloud':'el servicio logístico'}.`),{status:context instanceof Response?context.status:undefined});
  }
  if(data?.error)throw new Error(String(data.error));
  return data as T;
}
function invokeSendcloud<T>(body:Record<string,unknown>){return invokeFunction<T>('sendcloud-orders',body);}
function invokeOrderTools<T>(body:Record<string,unknown>){return invokeFunction<T>('sendcloud-order-tools',body);}
function invokeOrderState<T>(body:Record<string,unknown>){return invokeFunction<T>('order-logistics-state',body);}
function invokeEnvia<T>(body:Record<string,unknown>){return invokeFunction<T>('envia-shipping',body);}
function invokeMrw<T>(body:Record<string,unknown>){return invokeFunction<T>('mrw-shipping',body);}
function invokeAmazonTracking<T>(body:Record<string,unknown>){return invokeFunction<T>('amazon-confirm-shipment',body);}

function orderCompleteness(order:FulfillmentOrder){
  let score=0;
  if(order.sendcloudId&&!order.sendcloudId.startsWith('amazon:'))score+=40;
  if(order.shippingIntegrationAccountId)score+=20;
  if(order.customerName)score+=8;
  if(order.customerPhone)score+=4;
  if(order.customerEmail)score+=2;
  if(String(order.shippingAddress?.address_line_1||'').trim())score+=8;
  if(String(order.shippingAddress?.postal_code||'').trim())score+=4;
  if(order.weightKg&&order.weightKg>0)score+=4;
  if(order.items.length)score+=2;
  if(order.sendcloudParcelId||order.shippingRemoteId||order.labelCreatedAt)score+=50;
  return score;
}
function dedupeMarketplaceOrders(orders:FulfillmentOrder[]){
  const result:FulfillmentOrder[]=[],byMarketplaceOrder=new Map<string,number>();
  for(const order of orders){
    const channel=order.sourceChannel;
    const key=(channel==='amazon'||channel==='shopify')&&order.orderNumber?`${channel}:${order.orderNumber.trim()}`:'';
    if(!key){result.push(order);continue}
    const existingIndex=byMarketplaceOrder.get(key);
    if(existingIndex==null){
      byMarketplaceOrder.set(key,result.length);result.push(order);continue;
    }
    const current=result[existingIndex];
    const preferred=orderCompleteness(order)>orderCompleteness(current)?order:current;
    const other=preferred===order?current:order;
    const purged=preferred.piiPurgedAt?preferred:other.piiPurgedAt?other:null;
    // During migration a marketplace order can temporarily exist both through
    // Sendcloud and through the direct connector. Present one operational row.
    result[existingIndex]=enforcePurge({
      ...preferred,
      piiPurgedAt:preferred.piiPurgedAt||other.piiPurgedAt||null,
      destinationCountryCode:purged?.destinationCountryCode||preferred.destinationCountryCode||other.destinationCountryCode||null,
      sourceIntegrationAccountId:preferred.sourceIntegrationAccountId||other.sourceIntegrationAccountId,
      customerName:preferred.customerName||other.customerName,
      customerEmail:preferred.customerEmail||other.customerEmail,
      customerPhone:preferred.customerPhone||other.customerPhone,
      shippingAddress:Object.keys(preferred.shippingAddress||{}).length?preferred.shippingAddress:other.shippingAddress,
      billingAddress:Object.keys(preferred.billingAddress||{}).length?preferred.billingAddress:other.billingAddress,
      items:preferred.items.length?preferred.items:other.items,
      totalAmount:preferred.totalAmount??other.totalAmount,
      currency:preferred.currency||other.currency,
      weightKg:preferred.weightKg??other.weightKg,
      packageLengthCm:preferred.packageLengthCm??other.packageLengthCm,
      packageWidthCm:preferred.packageWidthCm??other.packageWidthCm,
      packageHeightCm:preferred.packageHeightCm??other.packageHeightCm,
    });
  }
  return result;
}
let ordersClient:ReturnType<typeof getActiveSupabase>|null=null;
let authSubscription:{unsubscribe:()=>void}|null=null;
let ordersRead:Promise<FulfillmentOrder[]>|null=null;
export function listFulfillmentOrders():Promise<FulfillmentOrder[]>{
  const client=getActiveSupabase();
  if(ordersClient!==client){
    authSubscription?.unsubscribe();ordersClient=client;ordersRead=null;
    authSubscription=client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')resetOrdersSnapshot();}).data.subscription;
  }
  if(ordersRead)return ordersRead;
  const request=readFulfillmentOrders(client);ordersRead=request;
  void request.finally(()=>{if(ordersRead===request)ordersRead=null}).catch(()=>{});
  return request;
}
async function readFulfillmentOrders(client:ReturnType<typeof getActiveSupabase>):Promise<FulfillmentOrder[]>{
  const snapshotVersion=ordersSnapshotVersion();
  const {data,error}=await client.from('fulfillment_orders').select('id,sendcloud_id,sendcloud_remote_id,order_id,order_number,source_integration_account_id,shipping_integration_account_id,integration_id,integration_name,integration_type,source_channel,source_status,order_created_at,order_updated_at,pii_purged_at,destination_country_code,customer_name,customer_email,customer_phone,shipping_address,billing_address,items,total_amount,currency,shipping_measurement:raw_payload->shipping_details->measurement,tracking_metadata:raw_payload->_zenvia_tracking,package_length_cm,package_width_cm,package_height_cm,sendcloud_parcel_id,sendcloud_shipment_id,shipping_provider,shipping_remote_id,shipping_label_url,tracking_number,tracking_url,tracking_status_code,tracking_status_message,tracking_updated_at,shipping_option_code,contract_id,carrier_code,carrier_name,shipping_service_name,shipping_cost_amount,shipping_cost_currency,shipping_cost_source,shipping_cost_net_amount,shipping_cost_tax_amount,shipping_cost_recorded_at,label_created_at,label_printed_at,label_print_count,label_print_state_known,fulfilled_at,last_synced_at').order('order_created_at',{ascending:false,nullsFirst:false}).limit(10000).abortSignal(AbortSignal.timeout(15000));
  if(error)throw error;
  const orders=dedupeMarketplaceOrders((data||[]).map(mapRow)).filter(order=>!isAmazonAwaitingPayment(order));
  // Synchronization and the database identity trigger persist the account name.
  if(getActiveSupabase()!==client)return readOrdersSnapshot();
  return publishOrdersSnapshot(orders,snapshotVersion);
}
export type OrdersDashboardFilters={
  from:string;to:string;state:'pending'|'labelled'|'shipped'|'cancelled'|'all';
  channel:'all'|OrderChannel;query:string;tracking:string;country:string;carrier:string;
  selectedIds?:string[];page:number;pageSize:number;overdueHours:number;sortKey:string;sortDirection:'asc'|'desc';
};
export type OrdersDashboardKpis={
  pending:number;preparablePending:number;amazon:number;shopify:number;manual:number;labelled:number;
  shipped:number;cancelled:number;overduePending:number;
  sales:{gross:number;net:number;vat:number;count:number;average:number};
  // Server totals are the recorded baseline; narrow tariff candidates restore
  // the same fallback and repricing used by order shipping prices.
  transport:{total:number;net:number;tax:number;mrw:number;correos:number;other:number;
    shipments:number;valued:number;missing:number;basis:'recorded_only'|'recorded_and_tariff'};
};
export type OrdersDashboardPage={
  orders:FulfillmentOrder[];total:number;selectableTotal:number;page:number;pageSize:number;
  tariffCandidates:Array<FulfillmentOrder & {kpiCarrierLabel:string}>;
  kpis:OrdersDashboardKpis;
  facets:{countries:string[];carriers:string[]};
};
/**
 * One tenant-RLS-protected RPC provides the selected server page AND KPI
 * aggregates over all matching orders, not merely those visible on the page.
 * No full-list download on initial screen load.
 */
export async function fetchOrdersDashboardPage(filters:OrdersDashboardFilters):Promise<OrdersDashboardPage>{
  const client=getActiveSupabase();
  const {data,error}=await client.rpc('orders_dashboard_page_v1',{
    p_from:filters.from||null,p_to:filters.to||null,
    p_state:filters.state,p_channel:filters.channel,p_query:filters.query,
    p_tracking:filters.tracking,p_country:filters.country,p_carrier:filters.carrier,
    p_page:Math.max(0,filters.page),
    p_page_size:Math.min(100,Math.max(1,filters.pageSize)),
    p_overdue_hours:filters.overdueHours,
    p_sort_key:filters.sortKey,p_sort_direction:filters.sortDirection,
    ...(filters.selectedIds?{p_selected_ids:filters.selectedIds}:{}),
  }).abortSignal(AbortSignal.timeout(15000));
  if(error)throw error;
  if(!data||!Array.isArray(data.rows)||!data.kpis)throw new Error('La respuesta de estadísticas de pedidos no es válida.');
  return {
    orders:data.rows.map(mapRow),
    tariffCandidates:(Array.isArray(data.tariffCandidates)?data.tariffCandidates:[]).map((row:any)=>({...mapRow(row),kpiCarrierLabel:String(row.kpi_carrier_label||'')})),
    total:Number(data.total||0),
    selectableTotal:Number(data.selectableTotal||0),
    page:Number(data.page||0),
    pageSize:Number(data.pageSize||filters.pageSize),
    kpis:data.kpis as OrdersDashboardKpis,
    facets:{
      countries:Array.isArray(data.facets?.countries)?data.facets.countries:[],
      carriers:Array.isArray(data.facets?.carriers)?data.facets.carriers:[],
    },
  };
}

/** IDs come from the same server-side eligibility/filter scope as the dashboard. */
export async function fetchMatchingOrderIds(filters:OrdersDashboardFilters):Promise<string[]>{
  const {data,error}=await getActiveSupabase().rpc('orders_dashboard_selection_v1',{
    p_from:filters.from||null,p_to:filters.to||null,p_state:filters.state,
    p_channel:filters.channel,p_query:filters.query,p_tracking:filters.tracking,
    p_country:filters.country,p_carrier:filters.carrier,p_limit:2000,
  }).abortSignal(AbortSignal.timeout(15000));
  if(error)throw error;
  if(data?.exceeded||Number(data?.total)>2000)throw new Error('Hay más de 2.000 pedidos elegibles. Reduce los filtros antes de seleccionar todos.');
  if(!data||!Array.isArray(data.ids)||!Number.isInteger(data.total)||data.total<0||data.ids.length!==data.total||data.ids.some((id:unknown)=>typeof id!=='string'||!id)||new Set(data.ids).size!==data.total)throw new Error('La selección de pedidos ha cambiado o no es válida. Actualiza y vuelve a intentarlo.');
  return data.ids;
}
/** Re-read only the saved IDs; never silently add new arrivals or omit changed orders. */
export async function listSelectedOrdersForBulk(filters:OrdersDashboardFilters,ids:string[]):Promise<FulfillmentOrder[]>{
  if(!ids.length)return [];
  if(ids.length>2000||new Set(ids).size!==ids.length)throw new Error('La selección no es válida. Reduce los filtros y vuelve a seleccionar.');
  const result=await listMatchingOrdersForAction({...filters,from:'',to:'',state:'all',channel:'all',query:'',tracking:'all',country:'all',carrier:'all',selectedIds:ids});
  const actual=new Set(result.map(order=>order.id));
  if(actual.size!==ids.length||ids.some(id=>!actual.has(id)))throw new Error('El conjunto de pedidos ha cambiado. Actualiza y vuelve a seleccionar antes de generar etiquetas.');
  return result;
}

/** Only invoked by an explicit bulk/invoicing action, never on mount. */
export async function listMatchingOrdersForAction(filters:OrdersDashboardFilters):Promise<FulfillmentOrder[]>{
  const first=await fetchOrdersDashboardPage({...filters,page:0,pageSize:100});
  if(first.total>2000)throw new Error('Demasiados pedidos para una operación masiva. Reduce los filtros antes de continuar.');
  const result=[...first.orders];
  const pages=Math.ceil(first.total/100);
  for(let page=1;page<pages;page++){
    const next=await fetchOrdersDashboardPage({...filters,page,pageSize:100});
    if(next.total!==first.total)throw new Error('El conjunto de pedidos ha cambiado. Actualiza y vuelve a intentarlo.');
    result.push(...next.orders);
  }
  if(new Set(result.map(order=>order.id)).size!==first.total)throw new Error('El conjunto de pedidos ha cambiado. Actualiza y vuelve a intentarlo.');
  return result;
}
export async function listMatchingPendingOrdersForBulk(filters:OrdersDashboardFilters):Promise<FulfillmentOrder[]>{
  return listMatchingOrdersForAction({...filters,state:'pending'});
}

export function getSendcloudStatus(){return invokeSendcloud<SendcloudStatus>({action:'status'});}
export interface EnviaSyncResult{
  ok:true;configured:boolean;found:number;synced:number;
  accounts:Array<{accountId:string;accountName:string;environment:string;found:number;synced:number}>;
  message?:string|null;
}
export function getEnviaStatus(){return invokeEnvia<{ok:true;configured:boolean;accounts:Array<{id:string;displayName:string;environment:string;isDefault:boolean}>}>({action:'status'});}
export function syncEnviaShipments(months=2){return invokeEnvia<EnviaSyncResult>({action:'sync_shipments',months});}
export async function retryAmazonTrackingConfirmations(){
  try{
    const rule=await loadAutomationRule('order_label_created');
    if(rule.enabled&&rule.config.retryConfirmation&&rule.config.saveTracking)await invokeAmazonTracking({action:'retry_pending',limit:10});
  }catch{/* El worker de Amazon también reintentará la confirmación independientemente de Sendcloud. */}
}
export async function syncSendcloudOrders(history=false,retryTracking=true,automatic=false){
  const result=await invokeSendcloud<{ok:true;synced:number;enriched?:number;history?:boolean;integrations:SendcloudIntegration[]}>({action:'sync',history,automatic});
  if(retryTracking)await retryAmazonTrackingConfirmations();
  return result;
}
export async function syncShopifyOrders(history=false){
  return invokeFunction<{ok:true;configured:boolean;synced:number;history?:boolean;accounts?:Array<{accountId:string;displayName:string;synced:number;shopDomain:string}>}>('shopify-orders',{history});
}
export function createManualOrder(order:ManualOrderInput){return invokeOrderState<{ok:true;id:string;sendcloudId:string|null;orderNumber:string}>({action:'create_manual_order',order});}
export async function getShippingOptions(orderId:string,onUpdate?:(states:ProviderQuotes<ShippingOption>)=>void,onlyProviders:QuoteProvider[]=['sendcloud','envia','mrw']){
  const requests:Partial<Record<QuoteProvider,(signal:AbortSignal)=>Promise<{configured?:boolean;options:ShippingOption[];message?:string|null}>>>={};
  for(const provider of onlyProviders){
    requests[provider]=async signal=>{
      const endpoint=provider==='sendcloud'?'sendcloud-order-tools':provider==='envia'?'envia-shipping':'mrw-shipping';
      const action=provider==='sendcloud'?'shipping_options':provider==='envia'?'rates':'options';
      const result=await invokeFunction<{configured?:boolean;options:ShippingOption[];message?:string|null}>(endpoint,{action,orderId},signal);
      const options=(result.options||[]).map(option=>({...option,provider,providerName:provider==='envia'?'Envia.com':provider==='mrw'?'MRW directo':'Sendcloud'})).filter(option=>!(Number(option.price)===0&&/unstamped|sin franqueo|unfranked/i.test(option.name||'')));
      return {...result,options};
    };
  }
  const providers=await collectProviderQuotes(requests,onUpdate||(()=>{}));
  const options=Object.values(providers).flatMap(p=>p.options).sort((a,b)=>(a.price??Infinity)-(b.price??Infinity));
  return {weightKg:null,options,message:Object.values(providers).map(p=>p.message).filter(Boolean).join(' · ')||null,providers};
}

export function updateFulfillmentOrder(orderId:string,order:OrderUpdateInput){
  // ZENVIA is the operational source of truth. Provider systems are only
  // synchronized when that provider is actually used to quote/create a label.
  return invokeOrderState<{ok:true;weightKg:number}>({action:'update_order',orderId,order});
}
export function markOrderLabelPrinted(orderId:string){return invokeOrderState<{ok:true;printedAt:string;printCount:number}>({action:'mark_label_printed',orderId});}
export function validateOrderAddress(orderId:string,carrierCode='mrw'){return invokeOrderTools<OrderAddressValidation>({action:'validate_address',orderId,carrierCode});}
export async function confirmOrderTracking(orderId:string,trackingOverride?:Record<string,unknown>){
  const {data:order,error}=await supabase.from('fulfillment_orders').select('source_channel').eq('id',orderId).single();
  if(error)throw error;
  const endpoint=order.source_channel==='shopify'?'shopify-confirm-shipment':order.source_channel==='amazon'?'amazon-confirm-shipment':null;
  if(!endpoint)return {ok:true,skipped:true};
  return invokeFunction<{ok:boolean}>(endpoint,{action:'confirm_order_tracking',orderId,...(trackingOverride?{trackingOverride}:{})});
}
export async function createOrderLabel(orderId:string,option?:ShippingOption|null,pushTracking=true,onLabelReady?:(result:LabelResult&{automation:OrderLabelCreatedAutomationConfig})=>Promise<void>){
  const rule=await loadAutomationRule('order_label_created');
  const automation:OrderLabelCreatedAutomationConfig=rule.enabled
    ?rule.config
    :{saveTracking:false,pushToMarketplace:false,markSent:false,downloadPdf:false,retryConfirmation:false};
  const shippingOption=option?{
    provider:option.provider,providerName:option.providerName,integrationAccountId:option.integrationAccountId||null,
    code:option.code,contractId:option.contractId,carrierCode:option.carrierCode,carrierName:option.carrierName,
    name:option.name,price:option.price,currency:option.currency,
  }:null;
  const result=option?.provider==='envia'
    ?await invokeEnvia<LabelResult>({action:'create_label',orderId,shippingOption})
    :option?.provider==='mrw'
      ?await invokeMrw<LabelResult>({action:'create_label',orderId,shippingOption})
      :await invokeSendcloud<LabelResult>({action:'create_label',orderId,shippingOption});
  markOrderLabelCreated(orderId,{...result,provider:result.provider||shippingOption?.provider||'sendcloud'});
  let deliveryError:unknown;
  try{await onLabelReady?.({...result,automation})}catch(error){deliveryError=error}
  let confirmationError:string|undefined;
  if(pushTracking&&automation.pushToMarketplace){
    try{
      await confirmOrderTracking(orderId,{
          trackingNumber:result.trackingNumber,
          trackingUrl:result.trackingUrl,
          parcelId:result.parcelId,
          carrierCode:result.carrierCode||null,
          carrierName:result.carrierName||null,
          shippingServiceName:result.shippingServiceName||null,
      });
    }catch(error){confirmationError=String((error as Error)?.message||error||'No se pudo confirmar el envío.');}
  }
  if(deliveryError)throw deliveryError;
  return {...result,automation,confirmationError};
}
export async function fetchOrderLabel(orderId:string){
  const {data,error}=await supabase.from('fulfillment_orders').select('shipping_provider,sendcloud_parcel_id').eq('id',orderId).maybeSingle();
  if(error)throw error;
  return data?.shipping_provider==='envia'
    ?invokeEnvia<LabelResult>({action:'fetch_label',orderId})
    :data?.shipping_provider==='mrw'
      ?invokeMrw<LabelResult>({action:'fetch_label',orderId})
      :invokeSendcloud<LabelResult>({action:'fetch_label',orderId});
}

export function shouldRunHistorySync(){
  const today=new Date().toISOString().slice(0,10);
  return window.localStorage.getItem(HISTORY_SYNC_KEY)!==today;
}
export function markHistorySyncDone(){window.localStorage.setItem(HISTORY_SYNC_KEY,new Date().toISOString().slice(0,10));}
export function shouldRunEnviaHistorySync(){
  const today=new Date().toISOString().slice(0,10);
  return window.localStorage.getItem(ENVIA_HISTORY_SYNC_KEY)!==today;
}
export function markEnviaHistorySyncDone(){window.localStorage.setItem(ENVIA_HISTORY_SYNC_KEY,new Date().toISOString().slice(0,10));}

export function labelBlob(result:Pick<LabelResult,'base64'|'mimeType'>){
  const binary=atob(result.base64); const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:result.mimeType||'application/pdf'});
}
export function downloadLabel(blob:Blob,orderNumber?:string|null){
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
  const base=(orderNumber||'pedido').trim().replace(/[^a-z0-9._-]+/gi,'_').replace(/^_+|_+$/g,'')||'pedido';
  a.download=`${base}.pdf`; document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function openLabelForPrint(blob:Blob){
  const url=URL.createObjectURL(blob); const win=window.open(url,'_blank','noopener,noreferrer');
  if(!win){URL.revokeObjectURL(url);throw new Error('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.');}
  win.addEventListener('load',()=>window.setTimeout(()=>{try{win.focus();win.print();}catch{/* visor PDF */}},500),{once:true});
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
const ZENVIA_PRINT_AGENT='http://127.0.0.1:17931';
const LEGACY_SENDCLOUD_PRINT_CLIENT='http://127.0.0.1:1903';

async function zenviaPrinters():Promise<LocalPrinter[]>{
  const response=await fetch(`${ZENVIA_PRINT_AGENT}/printers`,{
    headers:{Accept:'application/json','X-Zenvia-Client':'gestion-web'},
  });
  if(!response.ok)throw new Error('ZENVIA Print Agent no responde.');
  const payload=await response.json() as {printers?:Array<{id?:string;name?:string;default?:boolean}>};
  return (payload.printers||[])
    .filter(item=>item.id&&item.name)
    .map(item=>({id:`zenvia:${item.id}`,name:String(item.name),default:Boolean(item.default)}));
}

async function legacySendcloudPrinters():Promise<LocalPrinter[]>{
  const response=await fetch(`${LEGACY_SENDCLOUD_PRINT_CLIENT}/printers`,{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('El Print Client de Sendcloud no responde.');
  const items=await response.json() as LocalPrinter[];
  return items.map(item=>({...item,id:`sendcloud:${item.id}`}));
}

export async function listLocalPrinters():Promise<LocalPrinter[]>{
  try{
    const printers=await zenviaPrinters();
    if(printers.length)return printers;
  }catch{/* fallback temporal */}
  try{return await legacySendcloudPrinters()}
  catch{throw new Error('No se detecta ZENVIA Print Agent ni el Print Client de Sendcloud.')}
}

export async function printLabelWithClient(blob:Blob,printerId:string,labelSize:ShippingSettings['labelSize']='AUTO'){
  const [source,...parts]=printerId.split(':');
  const rawId=parts.join(':')||printerId;
  if(source==='zenvia'){
    const response=await fetch(`${ZENVIA_PRINT_AGENT}/print`,{
      method:'POST',
      headers:{
        Accept:'application/json',
        'Content-Type':'application/pdf',
        'X-Zenvia-Client':'gestion-web',
        'X-Printer-Id':rawId,
        'X-Label-Size':labelSize,
      },
      body:blob,
    });
    if(!response.ok){
      const payload=await response.json().catch(()=>({})) as {error?:string};
      throw new Error(payload.error||'ZENVIA Print Agent no pudo imprimir la etiqueta.');
    }
    return;
  }

  const legacyId=source==='sendcloud'?rawId:printerId;
  const form=new FormData();form.append('file',new File([blob],'label.pdf',{type:blob.type||'application/pdf'}));
  const response=await fetch(`${LEGACY_SENDCLOUD_PRINT_CLIENT}/printers/${encodeURIComponent(legacyId)}/print`,{method:'POST',headers:{Accept:'application/json'},body:form});
  if(!response.ok)throw new Error('El Print Client no pudo imprimir la etiqueta.');
}
export function getSavedPrinter(){return window.localStorage.getItem(PRINTER_KEY)||'';}
export function savePrinter(printerId:string){if(printerId)window.localStorage.setItem(PRINTER_KEY,printerId);else window.localStorage.removeItem(PRINTER_KEY);}

export function getOrderTrackingLink(orderId:string){
  return invokeOrderState<{url:string|null;status:'ready'|'unavailable';message?:string}>({action:'resolve_tracking_link',orderId});
}

export function reconcileAmazonOrders(){return invokeFunction<{ok:boolean;processed:number;failures:Array<{orderId:string;error:string}>}>('amazon-reconcile-orders',{});}

export function completeAmazonRecipients(){return invokeFunction<{ok:boolean;enriched:number;failures:Array<{amazonAccountId:string;error:string}>}>('amazon-recipient-fallback',{});}
