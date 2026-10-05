import { supabase } from './supabase';
import { loadAutomationRule, type OrderLabelCreatedAutomationConfig } from './automationRules';
import type { ShippingSettings } from './settingsSchema';

export type OrderChannel = 'amazon' | 'shopify' | 'other';

export interface FulfillmentOrder {
  id:string; sendcloudId:string; orderId:string|null; orderNumber:string|null;
  sourceIntegrationAccountId:string|null; shippingIntegrationAccountId:string|null;
  integrationId:number; integrationName:string|null; integrationType:string|null; sourceChannel:OrderChannel;
  sourceStatus:string|null; orderCreatedAt:string|null; orderUpdatedAt:string|null;
  customerName:string|null; customerEmail:string|null; customerPhone:string|null;
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
  parcelId:number; shipmentId:string|null; trackingNumber:string|null; trackingUrl:string|null;
  shippingOptionCode:string|null; contractId:number|null; carrierCode?:string|null; carrierName?:string|null;
  shippingServiceName?:string|null; mimeType:string; base64:string;
  automation?:OrderLabelCreatedAutomationConfig;
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
  address2?:string; postalCode:string; city:string; stateProvince?:string; countryCode:string; weightKg:number;
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
function mapRow(row:any):FulfillmentOrder{
  const measurement=row?.raw_payload?.shipping_details?.measurement||{};
  const weight=measurement?.weight;
  const dimension=measurement?.dimension||measurement?.dimensions||{};
  const dimensionUnit=String(dimension?.unit||'cm').toLowerCase();
  const dimensionFactor=dimensionUnit==='in'||dimensionUnit==='inch'||dimensionUnit==='inches'?2.54:dimensionUnit==='mm'?0.1:1;
  const dimensionCm=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n*dimensionFactor:null};
  const shippingAddress=row.shipping_address||{};
  const balearicPending=isBalearicAddress(shippingAddress)&&row.sendcloud_parcel_id==null;
  return {
    id:row.id, sendcloudId:String(row.sendcloud_remote_id||row.sendcloud_id), orderId:row.order_id||null, orderNumber:row.order_number||null,
    sourceIntegrationAccountId:row.source_integration_account_id||null, shippingIntegrationAccountId:row.shipping_integration_account_id||null,
    integrationId:Number(row.integration_id), integrationName:row.integration_name||null, integrationType:row.integration_type||null,
    sourceChannel:(row.source_channel||'other') as OrderChannel, sourceStatus:row.source_status||null,
    orderCreatedAt:row.order_created_at||null, orderUpdatedAt:row.order_updated_at||null,
    customerName:row.customer_name||null, customerEmail:row.customer_email||null, customerPhone:row.customer_phone||null,
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
    carrierTrackingUrl:row.raw_payload?._zenvia_tracking?.number===row.tracking_number?row.raw_payload._zenvia_tracking.url||null:null,
    trackingStatusCode:row.tracking_status_code||null, trackingStatusMessage:row.tracking_status_message||null, trackingUpdatedAt:row.tracking_updated_at||null,
    shippingOptionCode:row.shipping_option_code||null, contractId:row.contract_id==null?null:Number(row.contract_id),
    carrierCode:row.carrier_code||null, carrierName:row.carrier_name||(balearicPending?'🏝 Baleares · usar Correos':null), shippingServiceName:row.shipping_service_name||null,
    shippingCostAmount:row.shipping_cost_amount==null?null:Number(row.shipping_cost_amount), shippingCostCurrency:row.shipping_cost_currency||null, shippingCostSource:row.shipping_cost_source||null,
    shippingCostNetAmount:row.shipping_cost_net_amount==null?null:Number(row.shipping_cost_net_amount), shippingCostTaxAmount:row.shipping_cost_tax_amount==null?null:Number(row.shipping_cost_tax_amount), shippingCostRecordedAt:row.shipping_cost_recorded_at||null,
    labelCreatedAt:row.label_created_at||null, labelPrintedAt:row.label_printed_at||null, labelPrintCount:Number(row.label_print_count||0), labelPrintStateKnown:row.label_print_state_known!==false, fulfilledAt:row.fulfilled_at||null, lastSyncedAt:row.last_synced_at,
  };
}

async function invokeFunction<T>(functionName:string,body:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.functions.invoke(functionName,{body});
  if(error){
    let detail='';
    const context=(error as any)?.context;
    if(context instanceof Response){
      try{
        const payload=await context.clone().json();
        detail=String(payload?.error||payload?.message||'').trim();
      }catch{/* respuesta no JSON */}
    }
    throw new Error(detail||error.message||`No se pudo conectar con ${functionName==='envia-shipping'?'Envia.com':functionName.startsWith('sendcloud')?'Sendcloud':'el servicio logístico'}.`);
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
    // During migration a marketplace order can temporarily exist both through
    // Sendcloud and through the direct connector. Present one operational row.
    result[existingIndex]={
      ...preferred,
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
    };
  }
  return result;
}
export async function listFulfillmentOrders():Promise<FulfillmentOrder[]>{
  const {data,error}=await supabase.from('fulfillment_orders').select('*').order('order_created_at',{ascending:false,nullsFirst:false}).limit(10000);
  if(error)throw error;
  return dedupeMarketplaceOrders((data||[]).map(mapRow));
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
export async function getShippingOptions(orderId:string){
  const [sendcloudResult,enviaResult,mrwResult]=await Promise.allSettled([
    invokeOrderTools<{weightKg:number;options:Array<Omit<ShippingOption,'provider'|'providerName'>>;message?:string|null}>({action:'shipping_options',orderId}),
    invokeEnvia<{configured:boolean;options:ShippingOption[];message?:string|null;diagnostics?:Array<{account?:string;carrier?:string|null;message:string}>}>({action:'rates',orderId}),
    invokeMrw<{configured:boolean;options:ShippingOption[];message?:string|null}>({action:'options',orderId}),
  ]);
  const sendcloud=sendcloudResult.status==='fulfilled'?sendcloudResult.value:null;
  const envia=enviaResult.status==='fulfilled'?enviaResult.value:null;
  const mrw=mrwResult.status==='fulfilled'?mrwResult.value:null;
  const directMrwAvailable=Boolean(mrw?.configured&&(mrw?.options||[]).length);
  const sendcloudOptions=(sendcloud?.options||[]).map(option=>({
    ...option,provider:'sendcloud' as const,providerName:'Sendcloud',
  })).filter(option=>{
    const label=`${option.carrierCode||''} ${option.carrierName||''} ${option.code||''} ${option.name||''}`.toLowerCase();
    if(Number(option.price)===0&&/unstamped|sin franqueo|unfranked/.test(label))return false;
    if(directMrwAvailable&&/\bmrw\b/.test(label))return false;
    return true;
  });
  const enviaOptions=(envia?.options||[]).filter(option=>!(directMrwAvailable&&/\bmrw\b/i.test(`${option.carrierCode||''} ${option.carrierName||''}`)));
  const mrwOptions=mrw?.options||[];
  const noProviderOptions=!sendcloud&&!envia&&!mrw;
  if(noProviderOptions){
    if(mrwResult.status==='rejected')throw mrwResult.reason;
    if(enviaResult.status==='rejected')throw enviaResult.reason;
    if(sendcloudResult.status==='rejected')throw sendcloudResult.reason;
  }
  const options=[...sendcloudOptions,...enviaOptions,...mrwOptions].sort((a,b)=>{
    const ap=a.price==null?Number.MAX_VALUE:a.price,bp=b.price==null?Number.MAX_VALUE:b.price;
    return ap-bp;
  });
  const messages=[sendcloud?.message,envia?.message,mrw?.message].filter(Boolean).join(' · ');
  return {weightKg:sendcloud?.weightKg??null,options,message:messages||null,diagnostics:envia?.diagnostics||[]};
}
export function updateFulfillmentOrder(orderId:string,order:OrderUpdateInput){
  // ZENVIA is the operational source of truth. Provider systems are only
  // synchronized when that provider is actually used to quote/create a label.
  return invokeOrderState<{ok:true;weightKg:number}>({action:'update_order',orderId,order});
}
export function markOrderLabelPrinted(orderId:string){return invokeOrderState<{ok:true;printedAt:string;printCount:number}>({action:'mark_label_printed',orderId});}
export function validateOrderAddress(orderId:string,carrierCode='mrw'){return invokeOrderTools<OrderAddressValidation>({action:'validate_address',orderId,carrierCode});}
export async function createOrderLabel(orderId:string,option?:ShippingOption|null,pushTracking=true){
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
  if(pushTracking&&automation.pushToMarketplace){
    try{
      await invokeAmazonTracking({
        action:'confirm_order_tracking',
        orderId,
        trackingOverride:{
          trackingNumber:result.trackingNumber,
          trackingUrl:result.trackingUrl,
          parcelId:result.parcelId,
          carrierCode:result.carrierCode||null,
          carrierName:result.carrierName||null,
          shippingServiceName:result.shippingServiceName||null,
        },
      });
    }catch{/* Tracking can be retried later when enabled and persisted. */}
  }
  return {...result,automation};
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
