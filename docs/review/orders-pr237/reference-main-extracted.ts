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

const text=(value:unknown)=>typeof value==='string'?value:'';
const iso=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;


function timestampDateKey(value?:string|null){
  if(!value)return ''; const date=new Date(value);
  return Number.isNaN(date.getTime())?value.slice(0,10):iso(date);
}
function inPeriod(key:string,from:string,to:string){return Boolean(key)&&(!from||key>=from)&&(!to||key<=to);}
function orderDateKey(order:FulfillmentOrder){return timestampDateKey(order.orderCreatedAt);}
function labelTimestamp(order:FulfillmentOrder){return order.labelCreatedAt||order.fulfilledAt||order.trackingUpdatedAt||null;}
function shippedDateKey(order:FulfillmentOrder){return timestampDateKey(order.fulfilledAt||order.trackingUpdatedAt||order.labelCreatedAt||order.orderUpdatedAt||order.orderCreatedAt);}

function orderStatusCode(order:FulfillmentOrder){return String(order.sourceStatus||'').trim().toLowerCase();}
function isCancelledOrder(order:FulfillmentOrder){
  const source=orderStatusCode(order);
  const tracking=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  return source.includes('cancel')||tracking.includes('cancelled')||tracking.includes('canceled');
}
function hasShippingLabel(order:FulfillmentOrder){return Boolean(order.sendcloudParcelId||order.shippingRemoteId||order.labelCreatedAt);}
function labelPrintState(order:FulfillmentOrder){
  if(!hasShippingLabel(order))return {label:'—',className:'none',sort:''};
  if(order.labelPrintedAt)return {label:'Impreso',className:'printed',sort:`2-${order.labelPrintedAt}`};
  if(order.labelPrintStateKnown)return {label:'No impreso',className:'unprinted',sort:'1'};
  return {label:'Sin información',className:'unknown',sort:'0'};
}
function isReadyForDispatch(order:FulfillmentOrder){
  if(!hasShippingLabel(order))return false;
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  return raw.includes('ready to send')||raw.includes('ready for shipment')||raw.includes('announced')||raw.includes('being announced')||raw.includes('no label');
}
function isProcessedOrder(order:FulfillmentOrder){
  if(isCancelledOrder(order))return false;
  // Marketplace fulfillment confirms dispatch independently of carrier pickup.
  const confirmedStatus=orderStatusCode(order);
  if(['fulfilled','shipped','delivered'].includes(confirmedStatus))return true;
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ').trim();

  if(hasShippingLabel(order)){
    // Etiquetados must mean exactly this: label created, but the carrier has
    // not yet registered a physical/logistical event.
    const preDispatch=
      !raw||
      raw.includes('created')||
      raw.includes('pending')||
      raw.includes('ready to send')||
      raw.includes('ready for shipment')||
      raw.includes('announced')||
      raw.includes('being announced')||
      raw.includes('no label')||
      raw.includes('announcement failed')||
      raw.includes('error collecting');

    if(preDispatch)return false;
    if(isCancelledOrder(order))return false;

    // Any other carrier event means the shipment has progressed beyond merely
    // having a label: sorting, date changes, transit, delivery attempts,
    // incidents, returns, delivery, etc. It belongs in Enviados.
    return true;
  }

  const status=orderStatusCode(order);
  return status==='fulfilled'||status==='shipped'||status==='delivered';
}
function isLabelledOrder(order:FulfillmentOrder){return hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function isPendingOrder(order:FulfillmentOrder){return !isAmazonAwaitingPayment(order)&&!hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function canPrepareOrder(order:FulfillmentOrder){return !order.piiPurgedAt&&isPendingOrder(order);}
function orderState(order:FulfillmentOrder){
  if(isCancelledOrder(order))return {label:'Cancelado',className:'cancelled'};
  if(isLabelledOrder(order))return {label:'Etiquetado',className:'ready'};
  if(isProcessedOrder(order))return {label:'Enviado',className:'closed'};
  return {label:'Pendiente',className:'pending'};
}

const VAT_RATES:Record<string,number>={ES:21,PT:23,FR:20,DE:19,IT:22,NL:21,BE:21,AT:20,IE:23,PL:23,CZ:21,GR:24,HU:27,RO:21,FI:25.5,SE:25,DK:25,HR:25,SI:22,SK:23,LT:21,LV:21,EE:24,BG:20,CY:19,MT:18,LU:17,GB:20};
function taxParts(order:FulfillmentOrder){
  const gross=order.totalAmount||0,rate=VAT_RATES[text(order.destinationCountryCode||order.shippingAddress.country_code).trim().toUpperCase()]||0;
  if(!rate)return {gross,net:gross,vat:0}; const net=gross/(1+rate/100); return {gross,net,vat:gross-net};
}

function isAmazonAwaitingPayment(order:FulfillmentOrder){
  const status=orderStatusCode(order).replace(/[^a-z]/g,'');
  return order.sourceChannel==='amazon'&&['pending','pendingavailability','invoiceunconfirmed'].includes(status);
}


globalThis.fns={mapRow,dedupeMarketplaceOrders,isAmazonAwaitingPayment,isPendingOrder,isProcessedOrder,isCancelledOrder,taxParts,inPeriod,orderDateKey,shippedDateKey};