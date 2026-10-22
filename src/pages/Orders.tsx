import {ExternalShipmentModal} from '../components/ExternalShipmentModal';
import {registerExternalShipment} from '../services/externalShipment';
import {loadIntegrationAccounts,type IntegrationAccount} from '../services/integrationAccounts';
import {PageTabs} from '../components/PageTabs';
import {OrdersWorkbenchFilters,type OrdersWorkbenchFilterValues} from '../components/OrdersWorkbenchFilters';
import {TransportTariffsPanel} from '../components/TransportTariffsPanel';
import {ORDERS_TABS,isOrdersTab,parseOrdersTab,ordersTabUrl,ordersTabUsesPeriod,ordersTabActions,type OrdersTab} from '../services/ordersWorkbench';
import {readViewCache,writeViewCache} from '../services/viewCache';
import '../orders-workbench.css';
import {ShipmentTrackingHistory} from '../components/ShipmentTrackingHistory';
import {loadShipmentTrackingEvents} from '../services/shipmentTrackingHistory';
import {trackingPresentation} from '../services/shipmentTracking';
import {ShipmentTrackingStatus} from '../components/ShipmentTrackingStatus';
import {countLabel} from '../services/pluralization';
import {PageHeader} from '../components/PageHeader';
import {OrderProductLines} from '../components/OrderProductLines';
import {PickupReportModal,PickupReportHistory,PickupOrderMembership} from '../components/PickupReports';
import {useEntityRefresh} from '../hooks/useEntityRefresh';
import {ShippingProviderStatus} from '../components/ShippingProviderStatus';
import { isAmazonAwaitingPayment } from '../services/orderStatus';
import { watchFulfillmentOrders } from '../services/orderLiveUpdates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { requestAmazonSync } from '../services/amazon';
import {
  AlertCircle, Calculator, CheckCircle2, ChevronRight, Download, Euro,
  ExternalLink, ImageOff, LoaderCircle, MapPin, PackageCheck, Percent, Pencil, FileText, Plus, Printer, RefreshCw,
  Search, Settings2, ShoppingBag, Store, Trash2, Truck, X,
} from 'lucide-react';
import { OrderInvoiceModal } from '../components/OrderInvoiceModal';
import { OrderEditModal } from '../components/OrderEditModal';
import { SelectField } from '../components/forms/SelectField';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { defaultDateFilter, periodLabel } from '../services/filters';
import {
  createManualOrder, createOrderLabel, confirmOrderTracking, fetchOrderLabel,
  completeAmazonRecipients, getEnviaStatus, getSendcloudStatus, getShippingOptions, getOrderTrackingLink, labelBlob, fetchOrdersDashboardPage, listMatchingOrdersForAction, listMatchingPendingOrdersForBulk, fetchMatchingOrderIds, listSelectedOrdersForBulk, markOrderLabelPrinted,
  openLabelForPrint,
  syncShopifyOrders, reconcileAmazonOrders, retryAmazonTrackingConfirmations, updateFulfillmentOrder,
  type FulfillmentOrder, type ManualOrderItem, type OrderChannel, type OrderUpdateInput,
  type SendcloudStatus, type ShippingOption, type ProviderQuotes, type QuoteProvider, type OrdersDashboardFilters, type OrdersDashboardKpis,
} from '../services/orders';
import { bulkLabelZipFilename, labelPdfFilename, uniqueLabelPdfFilename } from '../services/orderLabelFiles';
import { firstMatchingShippingRule, selectShippingOptionWithDefault } from '../services/shippingRuleCore';
import { defaultShippingRules, loadShippingRules, type ShippingRule } from '../services/shippingRules';
import { prepareLabelPdf } from '../services/labelPdf';
import { useSettings } from '../context/SettingsContext';
import { loadAmazonProductImages } from '../services/amazon';
import { listTransportTariffs, type TransportTariffDocument } from '../services/transportTariffs';
import {
  transportKpisWithTariffs, calculateDefaultShippingPreview, trackingUrlForOrder, estimateTransportTariffForOption, shippingPriceForOrder, validateOrderForCarrier,
  type OrderValidationIssue, type ShippingPricePreview,
} from '../services/orderShipping';
import { errorMessage, showError, showInfo, showSuccess } from '../services/toast';
import { persistRememberedFilter, rememberedFilter } from '../services/uiPreferences';
import { formatAppDateTime } from '../services/formatting';
import { startActivity } from '../services/activity';
import { confirmAction } from '../services/actionDialog';
import type { GeneralSettings, ShippingSettings } from '../services/settingsSchema';
import { SortableTableHeader, TableSortReset, useSortableTable } from '../components/SortableTableHeader';

const money=(value:number|null,currency='EUR')=>value==null?'—':new Intl.NumberFormat('es-ES',{style:'currency',currency:currency||'EUR'}).format(value);
const dateLabel=(value:string|null|undefined,general:GeneralSettings)=>formatAppDateTime(value,general,'—');
const regionNames=typeof Intl!=='undefined'&&'DisplayNames' in Intl?new Intl.DisplayNames(['es'],{type:'region'}):null;
const countryName=(code:string)=>regionNames?.of(code)||code;
const text=(value:unknown)=>typeof value==='string'?value:'';
const iso=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;

function downloadBlob(blob:Blob,fileName:string){
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function downloadLabel(blob:Blob,fileName:string){
  const clean=(fileName||'etiqueta.pdf').replace(/[^a-z0-9._-]+/gi,'_');
  downloadBlob(blob,clean.toLowerCase().endsWith('.pdf')?clean:`${clean}.pdf`);
}

type OrderFilter='pending'|'labelled'|'shipped'|'issues'|'cancelled'|'all';
type TrackingFilter='all'|'none'|'ready'|'transit'|'route'|'pickup'|'delivered'|'issue'|'cancelled'|'returned';

function timestampDateKey(value?:string|null){
  if(!value)return ''; const date=new Date(value);
  return Number.isNaN(date.getTime())?value.slice(0,10):iso(date);
}
function inPeriod(key:string,from:string,to:string){return Boolean(key)&&(!from||key>=from)&&(!to||key<=to);}
function orderDateKey(order:FulfillmentOrder){return timestampDateKey(order.orderCreatedAt);}
function labelTimestamp(order:FulfillmentOrder){return order.labelCreatedAt||order.fulfilledAt||order.trackingUpdatedAt||null;}
function shippedDateKey(order:FulfillmentOrder){return timestampDateKey(order.fulfilledAt||order.trackingUpdatedAt||order.labelCreatedAt||order.orderUpdatedAt||order.orderCreatedAt);}
function channelLabel(order:FulfillmentOrder){
  if(order.sourceChannel==='amazon')return 'Amazon'; if(order.sourceChannel==='shopify')return 'Shopify';
  const source=`${order.integrationName||''} ${order.integrationType||''}`.toLowerCase();
  return source.includes('api')||source.includes('zenvia')?'Manual':'Otro';
}
function addressLine(address:Record<string,unknown>){
  const first=[text(address.address_line_1),text(address.house_number)].filter(Boolean).join(' ');
  const second=[text(address.postal_code),text(address.city)].filter(Boolean).join(' ');
  return [first,text(address.address_line_2),second,text(address.country_code)].filter(Boolean).join(' · ')||'Dirección no disponible';
}
function itemLabel(item:Record<string,unknown>){return text(item.name)||text(item.description)||text(item.sku)||'Producto';}
function itemQty(item:Record<string,unknown>){return Number(item.quantity||1)||1;}
function itemAsin(item:Record<string,unknown>){return text(item.product_id)||text(item.asin);}
function itemImageUrl(item:Record<string,unknown>,fallbackImages:Record<string,string>){
  const direct=text(item.image_url).trim();
  if(direct)return direct;
  const asin=itemAsin(item);
  return asin?fallbackImages[asin]||'':'';
}
function productsText(order:FulfillmentOrder){return order.items.map(item=>`${itemLabel(item)} ${text(item.sku)} x${itemQty(item)}`).join(' · ');}
function weightValueLabel(weightKg:number|null|undefined,unit:ShippingSettings['weightUnit']){if(weightKg==null)return '—';const value=unit==='g'?weightKg*1000:weightKg;return `${value.toLocaleString('es-ES',{minimumFractionDigits:0,maximumFractionDigits:unit==='g'?0:3})} ${unit}`;}
function weightLabel(order:FulfillmentOrder,unit:ShippingSettings['weightUnit']){return weightValueLabel(order.weightKg,unit)+(order.weightEstimated?' (estimado)':'');}
function orderAgeHours(order:FulfillmentOrder){if(!order.orderCreatedAt)return 0;const created=new Date(order.orderCreatedAt).getTime();return Number.isFinite(created)?Math.max(0,(Date.now()-created)/3600000):0;}
function orderStatusCode(order:FulfillmentOrder){return String(order.sourceStatus||'').trim().toLowerCase();}
function isCancelledOrder(order:FulfillmentOrder){
  const source=orderStatusCode(order);
  return source.includes('cancel')||trackingPresentation(order).state==='cancelled';
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
function trackingState(order:FulfillmentOrder){
  if(!hasShippingLabel(order)&&!order.trackingNumber)return {label:'Sin etiqueta',className:'none'};
  return trackingPresentation(order);
}
function trackingDetail(order:FulfillmentOrder){
  const code=String(order.trackingStatusCode||'').trim().toUpperCase();
  const message=String(order.trackingStatusMessage||'').trim();
  const labels:Record<string,string>={
    DELIVERY_FAILED:'Intento de entrega fallido',
    RETURNED_TO_SENDER:'Devuelto al remitente',
    ADDRESS_INVALID:'Dirección no válida',
    ANNOUNCEMENT_FAILED:'Error al comunicar el envío al transportista',
    UNABLE_TO_DELIVER:'No se pudo realizar la entrega',
    ERROR_COLLECTING:'Error durante la recogida',
    REFUSED:'Envío rechazado',
    DELIVERY_DELAYED:'Entrega retrasada',
    CANCELLED:'Envío cancelado',
    CANCELED:'Envío cancelado',
  };
  return {
    title:labels[code]||message||code||'Sin detalle adicional',
    raw:message&&message!==labels[code]?message:'',
    code,
  };
}
function trackingFilterCode(order:FulfillmentOrder):Exclude<TrackingFilter,'all'>{
  const tracking=trackingState(order);
  if(tracking.className==='delivered')return 'delivered';
  if(tracking.className==='route')return 'route';
  if(tracking.className==='pickup')return 'pickup';
  if(tracking.className==='issue')return 'issue';
  if(tracking.className==='cancelled')return 'cancelled';
  if(tracking.className==='returned')return 'returned';
  if(tracking.className==='ready')return 'ready';
  if(tracking.className==='transit')return 'transit';
  return 'none';
}
function matchesOrderContext(order:FulfillmentOrder,query:string,channel:'all'|OrderChannel,trackingFilter:TrackingFilter,countryFilter:string,carrierFilter:string){
  if(channel!=='all'&&order.sourceChannel!==channel)return false;
  if(trackingFilter!=='all'&&trackingFilterCode(order)!==trackingFilter)return false;
  const country=text(order.destinationCountryCode||order.shippingAddress.country_code).trim().toUpperCase()||'XX';
  if(countryFilter!=='all'&&country!==countryFilter)return false;
  const carrier=carrierLabel(order).trim().toLowerCase();
  if(carrierFilter!=='all'&&carrier!==carrierFilter)return false;
  const q=query.trim().toLowerCase();
  const haystack=[order.orderNumber||'',order.orderId||'',order.customerName||'',order.trackingNumber||'',order.trackingStatusMessage||'',carrierLabel(order),productsText(order),country].join(' ').toLowerCase();
  return !q||haystack.includes(q);
}
function countryCode(code:unknown){
  const value=text(code).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value)?value:'';
}
function CountryFlag({code}:{code:unknown}){
  const value=countryCode(code);
  if(!value)return null;
  return <span className="ordersCountryFlag" aria-label={value} title={value}>
    <img src={`https://flagcdn.com/24x18/${value.toLowerCase()}.png`} srcSet={`https://flagcdn.com/48x36/${value.toLowerCase()}.png 2x`} alt="" loading="lazy" referrerPolicy="no-referrer"/>
  </span>;
}
function customerWithCountry(order:FulfillmentOrder,fallback='—'){
  const name=order.customerName||text(order.shippingAddress.name)||fallback;
  return <span className="ordersCustomerCountry"><CountryFlag code={order.shippingAddress.country_code}/><span>{name}</span></span>;
}
function carrierLabel(order:FulfillmentOrder){
  const known=(order.carrierCode||order.carrierName||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  if(known==='correosexpress')return 'Correos Express';
  if(known==='correos')return 'Correos';
  if(known==='mrw')return 'MRW';
  if(order.carrierName)return order.carrierName;
  const raw=(order.carrierCode||order.shippingOptionCode?.split(':')[0]||'').toLowerCase();
  if(raw.includes('correos'))return 'Correos'; if(raw.includes('mrw'))return 'MRW';
  return raw?raw.toUpperCase():'—';
}

const VAT_RATES:Record<string,number>={ES:21,PT:23,FR:20,DE:19,IT:22,NL:21,BE:21,AT:20,IE:23,PL:23,CZ:21,GR:24,HU:27,RO:21,FI:25.5,SE:25,DK:25,HR:25,SI:22,SK:23,LT:21,LV:21,EE:24,BG:20,CY:19,MT:18,LU:17,GB:20};
function taxParts(order:FulfillmentOrder){
  const gross=order.totalAmount||0,rate=VAT_RATES[text(order.destinationCountryCode||order.shippingAddress.country_code).trim().toUpperCase()]||0;
  if(!rate)return {gross,net:gross,vat:0}; const net=gross/(1+rate/100); return {gross,net,vat:gross-net};
}
function preferredCarrier(option:ShippingOption){const h=`${option.carrierCode} ${option.carrierName} ${option.name} ${option.code}`.toLowerCase();if(h.includes('mrw'))return 'mrw';if(h.includes('correos'))return 'correos';return '';}

export function OrderDrawer({order,shippingPrice,validationIssues,productImages,onClose,onPrepare,onEdit,onPrint,onDownload,onInvoice,onConfirmShipment,onRegisterExternal,busy}:{order:FulfillmentOrder;shippingPrice:ShippingPricePreview|null;validationIssues:OrderValidationIssue[];productImages:Record<string,string>;onClose:()=>void;onPrepare:()=>void;onEdit:()=>void;onPrint:()=>void;onDownload:()=>void;onInvoice:()=>void;onConfirmShipment:()=>void;onRegisterExternal?:()=>void;busy:boolean}){
  const {settings}=useSettings();
  const [trackingLink,setTrackingLink]=useState<string|null>(trackingUrlForOrder(order));
  useEffect(()=>{
    let cancelled=false;
    const recorded=trackingUrlForOrder(order);
    setTrackingLink(recorded);
    if(order.piiPurgedAt||recorded||!order.trackingNumber)return;
    void getOrderTrackingLink(order.id).then(result=>{
      if(cancelled)return;
      setTrackingLink(result.url);
    }).catch(()=>{/* Missing tracking links leave this optional action hidden. */});
    return()=>{cancelled=true};
  },[order.id,order.piiPurgedAt,order.shippingProvider,order.trackingNumber,order.trackingUrl,order.carrierTrackingUrl]);
  const labelled=hasShippingLabel(order),state=orderState(order),tracking=trackingState(order),canPrepare=canPrepareOrder(order);
  return <div className="ordersDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="ordersDrawer">
    <div className="ordersDrawerHead"><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><h2>Pedido {order.orderNumber||order.orderId||order.sendcloudId}</h2><p>{dateLabel(order.orderCreatedAt,settings.general)} · {order.integrationName||'Sendcloud'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
    <div className="ordersDrawerKpis"><div><span>Estado</span><strong>{state.label}</strong></div><div><span>Total</span><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></div><div><span>Peso</span><strong>{weightLabel(order,settings.shipping.weightUnit)}</strong></div><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div><div><span>Envío</span><strong>{shippingPrice?money(shippingPrice.totalAmount,shippingPrice.currency):'—'}</strong></div></div>
    {validationIssues.length>0&&<section className="ordersDrawerSection"><div className="errorBox ordersValidationBox"><AlertCircle size={17}/><div><strong>Revisar antes de generar la etiqueta</strong>{validationIssues.map((issue,index)=><span key={`${issue.field}-${index}`}>{issue.message}</span>)}</div></div></section>}
    <section className="ordersDrawerSection"><h3>Entrega</h3><div className="ordersAddress"><MapPin size={17}/><div><strong>{customerWithCountry(order,'Cliente')}</strong>{text(order.shippingAddress.company_name)&&<small>{text(order.shippingAddress.company_name)}</small>}<span>{addressLine(order.shippingAddress)}</span>{order.customerPhone&&<small>{order.customerPhone}</small>}{order.customerEmail&&<small>{order.customerEmail}</small>}</div></div></section>
    <section className="ordersDrawerSection"><div className="ordersSectionHead"><h3>Contenido</h3><span>{order.items.length} línea{order.items.length===1?'':'s'}</span></div>{order.items.length?<div className="ordersItems">{order.items.map((item,index)=>{const image=itemImageUrl(item,productImages);return <div key={`${itemLabel(item)}-${index}`}><div className="ordersItemMain">{image?<img className="ordersDrawerProductThumb" src={image} alt="" loading="lazy" referrerPolicy="no-referrer"/>:order.sourceChannel==='amazon'?<span className="ordersDrawerProductThumb ordersProductThumbPlaceholder"><ImageOff size={17}/></span>:null}<div className="ordersItemText"><strong>{itemLabel(item)}</strong><span>{text(item.sku)||text(item.product_id)||''}</span></div></div><b>x{itemQty(item)}</b></div>})}</div>:<div className="masterEmptyMini">Sin líneas de producto.</div>}</section>
    {shippingPrice&&<section className="ordersDrawerSection"><h3>Coste de envío</h3><div className="ordersShipmentInfo"><div><span>Total</span><strong>{money(shippingPrice.totalAmount,shippingPrice.currency)}</strong></div><div><span>Base</span><strong>{shippingPrice.netAmount==null?'—':money(shippingPrice.netAmount,shippingPrice.currency)}</strong></div><div><span>IVA</span><strong>{shippingPrice.taxAmount==null?'—':money(shippingPrice.taxAmount,shippingPrice.currency)}</strong></div><div><span>Origen</span><strong>{shippingPrice.source==='recorded'?'Coste seleccionado':shippingPrice.source==='tariff_estimate'?'Tarifa estimada':shippingPrice.note||'Cotización logística'}</strong></div>{shippingPrice.note&&<div><span>Nota</span><strong>{shippingPrice.note}</strong></div>}</div></section>}
    {order.shippingCostSource==='external_manual'&&<section className="ordersDrawerSection"><h3>Envío externo</h3><p>Registrado en ZENVIA. No hay una etiqueta descargable en la aplicación.</p></section>}
    {!order.piiPurgedAt&&!order.trackingNumber&&!labelled&&!order.fulfilledAt&&!isCancelledOrder(order)&&onRegisterExternal&&<section className="ordersDrawerSection"><button className="secondary" disabled={busy} onClick={onRegisterExternal}><Truck size={16}/> Registrar envío externo</button></section>}
    <PickupOrderMembership orderId={order.id} onOpen={()=>window.dispatchEvent(new CustomEvent('zenvia:pickup-history',{detail:order.id}))}/>
    {(labelled||isProcessedOrder(order))&&<section className="ordersDrawerSection"><h3>Expedición</h3>{tracking.className==='issue'&&(()=>{const detail=trackingDetail(order);return <div className="ordersTrackingIssueDetail"><AlertCircle size={17}/><div><strong>Detalle de la incidencia</strong><span>{detail.title}</span>{detail.raw&&<small>{detail.raw}</small>}{detail.code&&<small>Código: {detail.code}</small>}</div></div>})()}<div className="ordersShipmentInfo"><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div><div><span>Servicio</span><strong>{order.shippingServiceName||order.shippingOptionCode||'—'}</strong></div><div><span>Fecha pedido</span><strong>{dateLabel(order.orderCreatedAt,settings.general)}</strong></div><div><span>{order.shippingCostSource==='external_manual'?'Fecha envío':'Fecha etiqueta'}</span><strong>{dateLabel(labelTimestamp(order),settings.general)}</strong></div><div><span>Seguimiento</span><strong><ShipmentTrackingStatus order={order} staleDays={settings.orders.trackingStaleDays}/></strong></div>{order.trackingCheckedAt&&<div><span>Última comprobación</span><strong>{dateLabel(order.trackingCheckedAt,settings.general)}</strong></div>}<div><span>Tracking</span><strong>{order.trackingNumber||'—'}</strong></div>{order.shippingCostSource!=='external_manual'&&<div><span>Impresión</span><strong>{order.labelPrintedAt?`Impreso · ${order.labelPrintCount||1} vez${(order.labelPrintCount||1)===1?'':'es'}`:order.labelPrintStateKnown?'No impreso':'Sin información histórica'}</strong></div>}{trackingLink&&<a href={trackingLink} target="_blank" rel="noreferrer">{order.shippingProvider==='mrw'?'Consultar manualmente en MRW':'Abrir seguimiento'} <ExternalLink size={14}/></a>}</div></section>}
    {!order.piiPurgedAt&&order.trackingNumber&&<ShipmentTrackingHistory orderId={order.id} shipmentKey={`${order.trackingNumber}:${order.labelCreatedAt||''}`} loadEvents={loadShipmentTrackingEvents}/>}
    {order.sourceChannel==='shopify'&&labelled&&!isProcessedOrder(order)&&<section className="ordersDrawerSection"><h3>Confirmación del envío</h3><p>Reintenta con la etiqueta y el seguimiento ya existentes.</p><button className="secondary" disabled={busy} onClick={onConfirmShipment}><Truck size={16}/> Confirmar envío en Shopify</button></section>}
    {order.sourceChannel==='shopify'&&<section className="ordersDrawerSection"><h3>Factura</h3><p>La facturación es opcional y manual. No se emite al crear la etiqueta.</p><button className="secondary" onClick={onInvoice} disabled={busy}><FileText size={16}/> Generar / ver factura</button></section>}
    <div className="ordersDrawerActions">{order.piiPurgedAt?<div className="ordersNoAction"><AlertCircle size={16}/><span>Datos personales eliminados. Envío y etiquetas no disponibles.</span></div>:labelled?<><button className="secondary" disabled={busy} onClick={onDownload}><Download size={16}/> Descargar</button><button className="primary" disabled={busy} onClick={onPrint}><Printer size={16}/> Imprimir</button></>:canPrepare?<><button className="secondary" disabled={busy} onClick={onEdit}><Pencil size={16}/> Editar pedido</button><button className="primary" disabled={busy} onClick={onPrepare}>{busy?<><LoaderCircle className="spin" size={16}/> Preparando…</>:<><Truck size={16}/> Preparar etiqueta</>}</button></>:<div className={`ordersNoAction ${state.className}`}><AlertCircle size={16}/><span>{isCancelledOrder(order)?'Pedido cancelado. No se puede generar etiqueta.':'Este pedido ya está procesado.'}</span></div>}</div>
  </aside></div>;
}

function shippingOptionKey(option:ShippingOption|null|undefined){
  if(!option)return '';
  return [option.provider,option.integrationAccountId||'',option.carrierCode||'',option.code||'',option.contractId??''].join('|');
}

function LabelModal({order,options,tariffs,message,loading,providerStates,onRetry,preferredOption,onClose,onCreate}:{order:FulfillmentOrder;options:ShippingOption[];tariffs:TransportTariffDocument[];message:string;loading:boolean;providerStates:ProviderQuotes<ShippingOption>;onRetry:(provider:QuoteProvider)=>void;preferredOption:ShippingOption|null;onClose:()=>void;onCreate:(option:ShippingOption|null)=>void}){
  const {settings}=useSettings();
  const providers=Array.from(new Set(options.map(option=>option.provider)));
  const priced=options.filter(option=>option.price!=null&&Number.isFinite(option.price)&&Number(option.price)>0).sort((a,b)=>(a.price??Number.MAX_VALUE)-(b.price??Number.MAX_VALUE));
  const cheapest=priced[0]||null;
  const preferredKey=shippingOptionKey(preferredOption);
  const selectionMode=settings.orders.shippingSelectionMode;
  const firstUsable=selectionMode==='none'
    ?null
    :preferredOption||cheapest||options.find(option=>!/^unstamped(?:\s+letter)?$/i.test(option.name||''))||options[0]||null;
  const [selectedKey,setSelectedKey]=useState(()=>shippingOptionKey(firstUsable));

  useEffect(()=>{
    const available=new Set(options.map(shippingOptionKey));
    if(preferredKey&&available.has(preferredKey)){setSelectedKey(current=>available.has(current)?current:preferredKey);return}
    setSelectedKey(current=>available.has(current)?current:shippingOptionKey(firstUsable));
  },[order.id,preferredKey,options.length]);

  const selected=options.find(option=>shippingOptionKey(option)===selectedKey)||null;
  const comparison=options.map(option=>({option,tariff:estimateTransportTariffForOption(order,tariffs,option)}));
  const selectOption=(option:ShippingOption)=>setSelectedKey(shippingOptionKey(option));

  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersLabelModal">
    <div className="modalHead"><div><h3>Crear etiqueta · {order.orderNumber||order.orderId}</h3><p>Compara los servicios disponibles de tus proveedores logísticos, selecciona uno y confirma la creación de la etiqueta.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersLabelBody">
      <div className="ordersLabelContext"><div><span>Peso del paquete</span><strong>{weightLabel(order,settings.shipping.weightUnit)}</strong></div><div><span>Destino</span><strong>{text(order.shippingAddress.postal_code)||'—'} · {text(order.shippingAddress.city)||text(order.shippingAddress.country_code)||'—'}</strong></div></div>
      <ShippingProviderStatus states={providerStates} onRetry={onRetry}/>
      {loading&&<div className="ordersOptionsLoading"><LoaderCircle className="spin"/><span>Consultando proveedores, servicios y precios…</span></div>}
      <>
        {message&&<div className="ordersQuoteMessage"><AlertCircle size={15}/><span>{message}</span></div>}
        {options.length>0&&<section className="ordersComparison">
          <div className="ordersComparisonHead"><div><strong>Opciones de envío</strong><span>Ordenadas por precio final para que puedas elegir directamente la opción más conveniente.</span></div><small>{priced.length?countLabel(priced.length,'opción con precio','opciones con precio'):'Sin precios disponibles'}</small></div>
          {priced.length>0&&<div className="ordersBestOptions">
            <div className="ordersBestOptionsTitle"><strong>Mejores opciones</strong><span>Las {settings.shipping.topOptionsCount} tarifas más económicas disponibles ahora mismo.</span></div>
            <div className="ordersBestOptionsGrid">{priced.slice(0,settings.shipping.topOptionsCount).map((option,index)=>{
              const isSelected=shippingOptionKey(option)===selectedKey;
              const tariff=estimateTransportTariffForOption(option.packageWeightKg?{...order,weightKg:option.packageWeightKg}:order,tariffs,option);
              return <button type="button" className={'ordersBestOption '+(isSelected?'selected':'')} aria-pressed={isSelected} key={'best-'+shippingOptionKey(option)} onClick={()=>selectOption(option)}>
                <div className="ordersBestRank">{index+1}º</div>
                <div className="ordersBestIdentity"><span className={'ordersProviderBadge '+option.provider}>{option.providerName}</span><strong>{option.carrierName||option.carrierCode||'Transportista'}</strong><small>{option.name||option.code}</small></div>
                <div className="ordersBestPriceValue"><strong>{money(option.price!,option.currency||'EUR')}</strong><small>{option.provider==='envia'?'IVA y combustible incluidos':option.provider==='mrw'?'Según tarifa MRW':tariff?.documentName?'Tarifa disponible':'Precio Sendcloud'}</small></div>
              </button>;
            })}</div>
          </div>}
          <div className="ordersComparisonList">{comparison.slice().sort((a,b)=>{
            const ap=a.option.price!=null&&a.option.price>0?a.option.price:Number.MAX_VALUE;
            const bp=b.option.price!=null&&b.option.price>0?b.option.price:Number.MAX_VALUE;
            if(ap!==bp)return ap-bp;
            return (a.option.carrierName||'').localeCompare(b.option.carrierName||'');
          }).map(({option,tariff},index)=>{
            const isSelected=shippingOptionKey(option)===selectedKey;
            const rank=option.price!=null?priced.findIndex(item=>shippingOptionKey(item)===shippingOptionKey(option))+1:0;
            return <button type="button" className={'ordersComparisonRow '+(isSelected?'selected':'')} aria-pressed={isSelected} key={'comparison-'+option.provider+'-'+(option.integrationAccountId||'')+'-'+option.carrierCode+'-'+option.code+'-'+index} onClick={()=>selectOption(option)}>
              <div className="ordersComparisonIdentity"><span className={'ordersProviderBadge '+option.provider}>{option.providerName}</span><strong>{option.carrierName||option.carrierCode||'Transportista'}</strong><small>{option.name||option.code}{shippingOptionKey(option)===preferredKey?' · Predeterminada':''}</small></div>
              <div><span>Precio final</span><strong>{option.price==null?'—':money(option.price,option.currency||'EUR')}</strong>{rank>0&&rank<=settings.shipping.topOptionsCount&&<small className="ordersBestPrice">{rank===1?'Más barato':rank+'º más barato'}</small>}</div>
              <div><span>Origen del precio</span><strong>{option.provider==='mrw'?'Tarifa MRW':option.provider==='envia'?'Envia.com':'Sendcloud'}</strong><small>{option.provider==='envia'&&option.price!=null?'IVA y combustible incluidos':option.provider==='mrw'?'Calculado con tu tarifa subida':option.price!=null?'Tarifa disponible':'Sin precio disponible'}</small></div>
            </button>;
          })}</div>
        </section>}
        {!options.length?<div className="ordersNoOption">No hay servicios disponibles en los proveedores logísticos conectados.</div>:<div className="ordersCarrierGrid">
          {providers.map(provider=>{
            const providerOptions=options.filter(option=>option.provider===provider);
            const providerName=providerOptions[0]?.providerName||provider;
            const carrierGroups=Array.from(new Map(providerOptions.map(option=>{
              const key=(option.carrierCode||option.carrierName||'transportista').toLowerCase();
              return [key,{name:option.carrierName||option.carrierCode||'Transportista',options:providerOptions.filter(item=>(item.carrierCode||item.carrierName||'transportista').toLowerCase()===key)}];
            })).values());
            return <section className="ordersCarrierCard" key={provider}>
              <div className="ordersCarrierHead"><Truck size={18}/><div><strong>{providerName}</strong><span>{provider==='envia'?'Comparativa multitransportista en tiempo real':provider==='mrw'?'Conexión directa con MRW':'Servicios de tu cuenta Sendcloud'}</span></div></div>
              <div className="ordersCarrierGroups">{carrierGroups.map(group=><section className="ordersCarrierGroup" key={provider+'-'+group.name}>
                <div className="ordersCarrierGroupHead"><strong>{group.name}</strong><small>{countLabel(group.options.length,'servicio','servicios')}</small></div>
                <div className="ordersOptionList">{group.options.map((option,index)=>{
                  const isSelected=shippingOptionKey(option)===selectedKey;
                  return <button className={isSelected?'selected':''} aria-pressed={isSelected} key={`${provider}-${option.integrationAccountId||''}-${option.carrierCode}-${option.code}-${index}`} onClick={()=>selectOption(option)}>
                    <div><strong>{option.name||option.code}</strong><small>{option.integrationAccountName?`${option.integrationAccountName} · `:''}{option.billedWeightKg?`Peso facturable ${weightValueLabel(option.billedWeightKg,settings.shipping.weightUnit)} · `:''}{option.etaDays?`${option.etaDays} día${option.etaDays===1?'':'s'} · `:''}{option.code}</small></div>
                    <span className={option.price==null?'noPrice':''}>{option.price==null?'Precio no disponible':money(option.price,option.currency||'EUR')}</span>
                  </button>;
                })}</div>
              </section>)}</div>
            </section>;
          })}
        </div>}
      </>
    </div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!selected} onClick={()=>selected&&onCreate(selected)}>{selected?'Crear etiqueta':'Selecciona un servicio'}</button></div>
  </section></div>;
}
function ManualOrderModal({saving,defaultCountryCode,fallbackWeightKg,weightUnit,onClose,onSave}:{saving:boolean;defaultCountryCode:string;fallbackWeightKg:number;weightUnit:ShippingSettings['weightUnit'];onClose:()=>void;onSave:(value:any)=>void}){
  const [orderNumber,setOrderNumber]=useState(`MAN-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(Date.now()).slice(-5)}`);
  const [customerName,setCustomerName]=useState(''); const [companyName,setCompanyName]=useState(''); const [email,setEmail]=useState(''); const [phone,setPhone]=useState('');
  const [address,setAddress]=useState(''); const [houseNumber,setHouseNumber]=useState(''); const [postalCode,setPostalCode]=useState(''); const [city,setCity]=useState(''); const [countryCode,setCountryCode]=useState(defaultCountryCode||'ES');
  const [weightValue,setWeightValue]=useState(weightUnit==='g'?(fallbackWeightKg||1)*1000:(fallbackWeightKg||1)); const [items,setItems]=useState<ManualOrderItem[]>([{name:'',sku:'',quantity:1,unitPrice:0}]);
  const updateItem=(index:number,key:keyof ManualOrderItem,value:string|number)=>setItems(prev=>prev.map((item,i)=>i===index?{...item,[key]:value}:item));
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersManualModal">
    <div className="modalHead"><div><h3>Nuevo pedido manual</h3><p>Se crea primero en ZENVIA. El proveedor logístico se elige después al preparar la etiqueta.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersManualBody">
      <div className="ordersManualGrid"><label><span>N.º pedido</span><input value={orderNumber} onChange={e=>setOrderNumber(e.target.value)}/></label><label><span>Cliente *</span><input value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label><label><span>Nombre de la empresa (opcional)</span><input value={companyName} onChange={e=>setCompanyName(e.target.value)}/></label><label><span>Teléfono</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className="wide"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="wide"><span>Dirección *</span><input value={address} onChange={e=>setAddress(e.target.value)}/></label><label><span>Número</span><input value={houseNumber} onChange={e=>setHouseNumber(e.target.value)}/></label><label><span>Código postal *</span><input value={postalCode} onChange={e=>setPostalCode(e.target.value)}/></label><label><span>Ciudad *</span><input value={city} onChange={e=>setCity(e.target.value)}/></label><label><span>País *</span><input maxLength={2} value={countryCode} onChange={e=>setCountryCode(e.target.value.toUpperCase())}/></label><label><span>Peso total ({weightUnit})</span><input type="number" min={weightUnit==='g'?'1':'0.01'} step={weightUnit==='g'?'1':'0.01'} value={weightValue} onChange={e=>setWeightValue(Number(e.target.value)||0)}/></label></div>
      <div className="ordersManualItems"><div className="ordersSectionHead"><h3>Productos</h3><button className="link" onClick={()=>setItems(prev=>[...prev,{name:'',sku:'',quantity:1,unitPrice:0}])}><Plus size={14}/> Añadir línea</button></div>{items.map((item,index)=><div className="ordersManualItem" key={index}><input placeholder="Producto" value={item.name} onChange={e=>updateItem(index,'name',e.target.value)}/><input placeholder="SKU" value={item.sku||''} onChange={e=>updateItem(index,'sku',e.target.value)}/><input type="number" min="1" placeholder="Uds" value={item.quantity} onChange={e=>updateItem(index,'quantity',Math.max(1,Number(e.target.value)||1))}/><input type="number" min="0" step="0.01" placeholder="€/ud" value={item.unitPrice} onChange={e=>updateItem(index,'unitPrice',Math.max(0,Number(e.target.value)||0))}/><button className="iconBtn dangerText" disabled={items.length===1} onClick={()=>setItems(prev=>prev.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>)}</div>
    </div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving} onClick={()=>onSave({orderNumber,customerName,companyName,email,phone,address,houseNumber,postalCode,city,countryCode,weightKg:weightUnit==='g'?weightValue/1000:weightValue,items})}>{saving?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear pedido</button></div>
  </section></div>;
}
export function Orders({pendingOnly=false,active=true}:{pendingOnly?:boolean;active?:boolean}={}){
  const [externalOrder,setExternalOrder]=useState<FulfillmentOrder|null>(null);
  const [externalAccounts,setExternalAccounts]=useState<IntegrationAccount[]>([]);

  const {settings,preferences,patchPreferences,updateSection}=useSettings();
  const remembered=rememberedFilter<{
    query:string;state:OrderFilter;trackingFilter:TrackingFilter;countryFilter:string;carrierFilter:string;pickupReportFilter:'all'|'none'|'in';dateFilter:ReturnType<typeof defaultDateFilter>;
  }>(preferences,'orders.filters',{query:'',state:'pending',trackingFilter:'all',countryFilter:'all',carrierFilter:'all',pickupReportFilter:'all',dateFilter:defaultDateFilter(preferences.defaultPeriod)});
  const [activeTab,setActiveTab]=useState<OrdersTab>(()=>{
    if(pendingOnly)return 'pending';
    const urlTab=parseOrdersTab(window.location.search),cached=readViewCache<string>('orders:workbench:last-tab');
    return urlTab||(isOrdersTab(cached)?cached:isOrdersTab(remembered.state)?remembered.state:'pending');
  });
  const state:OrderFilter=activeTab==='reports'?'all':activeTab;
  const actionsForTab=ordersTabActions(activeTab);
  const [workbenchCounters,setWorkbenchCounters]=useState<Partial<Record<OrdersTab,number>>|null>(null);
  const [tariffsOpen,setTariffsOpen]=useState(false);
  const [compactHeader,setCompactHeader]=useState(()=>window.innerWidth<768);
  useEffect(()=>{const resize=()=>setCompactHeader(window.innerWidth<768);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
  useEffect(()=>{
    writeViewCache('orders:workbench:last-tab',activeTab);
    if(active&&parseOrdersTab(window.location.search)!==activeTab)window.history.replaceState(window.history.state,'',ordersTabUrl(window.location.href,activeTab));
  },[activeTab]);
  useEffect(()=>{const pop=()=>{const tab=parseOrdersTab(window.location.search);if(tab)setActiveTab(tab)};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
  const changeTab=(tab:OrdersTab)=>{
    if(tab===activeTab)return;
    window.history.pushState({...window.history.state,ordersTab:tab},'',ordersTabUrl(window.location.href,tab));
    setActiveTab(tab);
  };
  const [orders,setOrders]=useState<FulfillmentOrder[]>([]),[status,setStatus]=useState<SendcloudStatus|null>(null),[enviaStatus,setEnviaStatus]=useState<{configured:boolean;accounts:Array<{id:string;displayName:string;environment:string;isDefault:boolean}>}|null>(null);
  const [loading,setLoading]=useState(true),[syncing,setSyncing]=useState(false),[error,setError]=useState('');
  const [page,setPage]=useState(0),[matchingTotal,setMatchingTotal]=useState(0),[selectableTotal,setSelectableTotal]=useState(0);
  const [dashboardKpis,setDashboardKpis]=useState<OrdersDashboardKpis|null>(null);
  const [dashboardFacets,setDashboardFacets]=useState<{countries:string[];carriers:string[]}|null>(null);
  const syncingRef=useRef(false);
  const [query,setQuery]=useState(pendingOnly?'':remembered.query),[channel,setChannel]=useState<'all'|OrderChannel>('all'),[trackingFilter,setTrackingFilter]=useState<TrackingFilter>(pendingOnly?'all':remembered.trackingFilter),[countryFilter,setCountryFilter]=useState(pendingOnly?'all':remembered.countryFilter),[carrierFilter,setCarrierFilter]=useState(pendingOnly?'all':remembered.carrierFilter);
  const [providerStates,setProviderStates]=useState<ProviderQuotes<ShippingOption>>({});
  const quoteGeneration=useRef(0),quoteStates=useRef<ProviderQuotes<ShippingOption>>({});
  useEffect(()=>{const reset=()=>{quoteGeneration.current++;setLabelOrder(null);setPreparingOrder(null)};window.addEventListener('zenvia:tenant-changed',reset);return()=>{quoteGeneration.current++;window.removeEventListener('zenvia:tenant-changed',reset)}},[]);
  const [selected,setSelected]=useState<FulfillmentOrder|null>(null),[labelOrder,setLabelOrder]=useState<FulfillmentOrder|null>(null),[options,setOptions]=useState<ShippingOption[]>([]),[optionsMessage,setOptionsMessage]=useState(''),[optionsLoading,setOptionsLoading]=useState(false),[preparingOrder,setPreparingOrder]=useState<string|null>(null),[busyOrder,setBusyOrder]=useState<string|null>(null);
  const [dateFilter,setDateFilter]=useState(remembered.dateFilter);
  const [manualOpen,setManualOpen]=useState(false),[manualSaving,setManualSaving]=useState(false);
  const [editOrder,setEditOrder]=useState<FulfillmentOrder|null>(null),[editSaving,setEditSaving]=useState(false);
  const bulkQuoteRevision=useRef(0);
  const [bulkGenerating,setBulkGenerating]=useState(false),[bulkProgress,setBulkProgress]=useState('');
  const [bulkPreview,setBulkPreview]=useState<null|{
    targets:FulfillmentOrder[];
    scope:'pendientes'|'seleccionadas';
    loading:boolean;
    optionsByOrder:Record<string,ShippingOption[]>;
    summaries:Array<{key:string;provider:string;providerName:string;carrierCode:string;carrierName:string;covered:number;priced:number;total:number}>;
    selectedKey:string;
  }>(null);
  const [invoiceOrder,setInvoiceOrder]=useState<FulfillmentOrder|null>(null);
  const [invoiceQueue,setInvoiceQueue]=useState<FulfillmentOrder[]>([]);
  const [invoiceCandidates,setInvoiceCandidates]=useState<FulfillmentOrder[]>([]);
  const [invoiceSelectionOpen,setInvoiceSelectionOpen]=useState(false);
  const [invoiceSelection,setInvoiceSelection]=useState<Set<string>>(()=>new Set());
  const [pickupReportFilter,setPickupReportFilter]=useState<'all'|'none'|'in'>(pendingOnly?'all':remembered.pickupReportFilter||'all');
  // Retained pages stay mounted: synchronize a newly accepted App navigation.
  useEffect(()=>{
    if(!active)return;
    const requested=parseOrdersTab(window.location.search);
    if(requested)setActiveTab(requested);
    else if(!pendingOnly)window.history.replaceState(window.history.state,'',ordersTabUrl(window.location.href,activeTab));
    if(pendingOnly){setActiveTab('pending');setQuery('');setChannel('all');setTrackingFilter('all');setCountryFilter('all');setCarrierFilter('all');setPickupReportFilter('all');}
  },[active,pendingOnly]);
  const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
  const checkedIdsRef=useRef(checkedIds);checkedIdsRef.current=checkedIds;
  const selectionCache=useRef(new Map<string,FulfillmentOrder>());
  const [selectionOpen,setSelectionOpen]=useState(false),[selectionRows,setSelectionRows]=useState<FulfillmentOrder[]>([]);
  useEffect(()=>{for(const id of selectionCache.current.keys())if(!checkedIds.has(id))selectionCache.current.delete(id)},[checkedIds]);
  const [pickupIds,setPickupIds]=useState<string[]|null>(null);
  const [pickupHistory,setPickupHistory]=useState<string|null>(null);
  useEffect(()=>{const open=(e:Event)=>setPickupHistory((e as CustomEvent<string>).detail);window.addEventListener('zenvia:pickup-history',open);return()=>window.removeEventListener('zenvia:pickup-history',open)},[]);
  const [selectionScope,setSelectionScope]=useState<'page'|'all'>('page');
  const [selectionBusy,setSelectionBusy]=useState(false),[selectionError,setSelectionError]=useState('');
  const selectionRevision=useRef(0);
  const [tariffs,setTariffs]=useState<TransportTariffDocument[]>([]);
  const [editValidationCarrier,setEditValidationCarrier]=useState('');
  const [amazonImages,setAmazonImages]=useState<Record<string,string>>({});
  useEffect(()=>{
    const value={query,state,trackingFilter,countryFilter,carrierFilter,pickupReportFilter,dateFilter};
    const timer=window.setTimeout(()=>{void persistRememberedFilter(preferences,patchPreferences,'orders.filters',value)},350);
    return()=>window.clearTimeout(timer);
  },[query,state,trackingFilter,countryFilter,carrierFilter,pickupReportFilter,dateFilter,preferences.rememberFilters]);
  const [shippingRules,setShippingRules]=useState<ShippingRule[]>(()=>defaultShippingRules());

  // A stable refresher prevents filter edits / realtime events from restarting
  // the Amazon/Shopify synchronization effect. Ignore out-of-order page results.
  const pageParamsRef=useRef<OrdersDashboardFilters>({
    from:ordersTabUsesPeriod(activeTab)?dateFilter.from:'',to:ordersTabUsesPeriod(activeTab)?dateFilter.to:'',state,channel,query,tracking:trackingFilter,workbench:true,trackingStaleDays:settings.orders.trackingStaleDays,
    country:countryFilter,carrier:carrierFilter,pickupReport:pickupReportFilter,page,pageSize:activeTab==='reports'?1:preferences.pageSize,
    overdueHours:settings.orders.overdueHours,sortKey:'orderDate',sortDirection:'desc',
  });
  const refreshRequest=useRef<{key:string;request:Promise<FulfillmentOrder[]>}|null>(null);
  const refreshRevision=useRef(0);
  const refresh=useCallback(()=>{
    const params={...pageParamsRef.current};
    const key=JSON.stringify(params);
    if(refreshRequest.current?.key===key)return refreshRequest.current.request;
    const revision=++refreshRevision.current;
    const request=(async()=>{
      try{
        const result=await fetchOrdersDashboardPage(params);
        if(revision===refreshRevision.current){
          setOrders(result.orders);
          setMatchingTotal(result.total);
          setSelectableTotal(result.selectableTotal);
          setDashboardKpis(result.kpis);
          setWorkbenchCounters(result.counters||{pending:result.kpis.pending,labelled:result.kpis.labelled,shipped:result.kpis.shipped,cancelled:result.kpis.cancelled});
          setDashboardFacets(result.facets);
          setError('');
        }
        return result.orders;
      }catch(e){
        if(revision===refreshRevision.current)setError(errorMessage(e,'No se pudieron cargar los pedidos.'));
        return [] as FulfillmentOrder[];
      }
    })();
    refreshRequest.current={key,request};
    void request.finally(()=>{if(refreshRequest.current?.request===request)refreshRequest.current=null}).catch(()=>{});
    return request;
  },[]);
  useEffect(()=>watchFulfillmentOrders(refresh,Math.max(60,settings.orders.refreshSeconds)*1000),[refresh,settings.orders.refreshSeconds]);
  const refreshStatus=useCallback(async()=>{try{setStatus(await getSendcloudStatus())}catch(e){setStatus({configured:false,integrations:[],message:errorMessage(e,'No se pudo comprobar Sendcloud.')})}},[]);
  const refreshEnviaStatus=useCallback(async()=>{try{const result=await getEnviaStatus();setEnviaStatus({configured:result.configured,accounts:result.accounts||[]})}catch{setEnviaStatus({configured:false,accounts:[]})}},[]);
  const refreshTariffs=useCallback(async()=>{try{setTariffs(await listTransportTariffs())}catch{/* El precio real seleccionado seguirá disponible aunque no haya tarifa estimada. */}},[]);
  useEffect(()=>{
    const onAgentRefresh=()=>{if(document.visibilityState==='visible')void Promise.all([refreshStatus(),refreshEnviaStatus(),refreshTariffs()]);};
    window.addEventListener('zenvia:orders-refresh',onAgentRefresh);
    return()=>window.removeEventListener('zenvia:orders-refresh',onAgentRefresh);
  },[refresh,refreshStatus,refreshEnviaStatus,refreshTariffs]);
  useEntityRefresh(['integrations','tariffs'],async()=>{quoteGeneration.current++;bulkQuoteRevision.current++;setBulkPreview(null);setLabelOrder(null);setPreparingOrder(null);await Promise.all([refreshStatus(),refreshEnviaStatus(),refreshTariffs()])});
  useEffect(()=>{void Promise.all([refreshStatus(),refreshEnviaStatus(),refreshTariffs()])},[refreshStatus,refreshEnviaStatus,refreshTariffs]);
  useEffect(()=>{let active=true;loadShippingRules({ensureDefaults:false}).then(rows=>{if(active)setShippingRules(rows.length?rows:defaultShippingRules())}).catch(()=>{if(active)setShippingRules(defaultShippingRules())});return()=>{active=false}},[]);
  useEffect(()=>{
    const asins=Array.from(new Set(orders
      .filter(order=>order.sourceChannel==='amazon')
      .flatMap(order=>order.items)
      .filter(item=>!text(item.image_url).trim())
      .map(item=>itemAsin(item))
      .filter(Boolean)));
    if(!asins.length)return;
    let cancelled=false;
    void loadAmazonProductImages(asins).then(images=>{
      if(!cancelled)setAmazonImages(current=>({...current,...images}));
    }).catch(()=>{});
    return()=>{cancelled=true};
  },[orders]);

  const sync=useCallback(async(silent=false,history=false,automatic=false)=>{
    if(syncingRef.current)return;
    const runShopify=Boolean(settings.integrations.shopifyEnabled);
    const runAmazon=Boolean(settings.integrations.amazonEnabled);
    if(!runShopify&&!runAmazon){
      await Promise.all([refresh(),settings.orders.retryTrackingConfirmation?retryAmazonTrackingConfirmations():Promise.resolve()]);
      if(!silent)showSuccess('Pedidos actualizados. Los canales directos y transportistas conectados no dependen de Sendcloud para refrescar esta vista.');
      return;
    }
    syncingRef.current=true;setSyncing(true);if(!silent)setError('');
    try{
      const [shopifyResult,amazonResult,recipientResult]=await Promise.allSettled([
        runShopify?syncShopifyOrders(history):Promise.resolve(null),
        runAmazon?(async()=>{if(!automatic)await requestAmazonSync(undefined,{waitForOrders:true});return reconcileAmazonOrders();})():Promise.resolve(null),
        runAmazon?completeAmazonRecipients():Promise.resolve(null),
      ]);
      const messages:string[]=[],failures:string[]=[];
      if(recipientResult.status==='fulfilled'&&recipientResult.value){if(recipientResult.value.enriched)messages.push('Destinatarios completados: '+recipientResult.value.enriched);failures.push(...recipientResult.value.failures.map(f=>f.error));}
      else if(recipientResult.status==='rejected')failures.push('Destinatarios: '+errorMessage(recipientResult.reason,'error al completar datos'));
      if(amazonResult.status==='fulfilled'&&amazonResult.value)messages.push('Amazon directo: '+amazonResult.value.processed+' pedidos comprobados');
      else if(amazonResult.status==='rejected')failures.push('Amazon: '+errorMessage(amazonResult.reason,'error de sincronización'));
      if(shopifyResult.status==='fulfilled'&&shopifyResult.value?.configured){
        messages.push('Shopify '+shopifyResult.value.synced);
      }else if(shopifyResult.status==='rejected')failures.push('Shopify: '+errorMessage(shopifyResult.reason,'error de sincronización'));
      await refresh();
      if(!silent){
        if(messages.length)showSuccess('Pedidos actualizados · '+messages.join(' · ')+'.');
        if(failures.length)showInfo(failures.join(' · '));
      }
    }finally{syncingRef.current=false;setSyncing(false)}
  },[refresh,settings.integrations.amazonEnabled,settings.integrations.sendcloudEnabled,settings.integrations.enviaEnabled,settings.integrations.shopifyEnabled,settings.orders.retryTrackingConfirmation,status?.configured,enviaStatus?.configured]);


  const dateFrom=ordersTabUsesPeriod(activeTab)?dateFilter.from:'',dateTo=ordersTabUsesPeriod(activeTab)?dateFilter.to:'';
  const selectedPeriod=periodLabel(dateFilter);
  const orderPeriodOrders=useMemo(()=>orders.filter(order=>inPeriod(orderDateKey(order),dateFrom,dateTo)),[orders,dateFrom,dateTo]);
  const shippedPeriodOrders=useMemo(()=>orders.filter(order=>isProcessedOrder(order)&&inPeriod(shippedDateKey(order),dateFrom,dateTo)),[orders,dateFrom,dateTo]);
  const countryOptions=useMemo(()=>(dashboardFacets?.countries||[...new Set(orders.map(order=>text(order.destinationCountryCode||order.shippingAddress.country_code).trim().toUpperCase()||'XX'))]).sort((a,b)=>countryName(a).localeCompare(countryName(b),'es')).map(code=>({value:code,label:code==='XX'?'País pendiente':`${countryName(code)} · ${code}`})),[orders,dashboardFacets]);
  const carrierOptions=useMemo(()=>(dashboardFacets?.carriers||[...new Set(orders.map(order=>carrierLabel(order)).filter(value=>value&&value!=='—'))]).sort((a,b)=>a.localeCompare(b,'es')).map(value=>({value:value.toLowerCase(),label:value})),[orders,dashboardFacets]);
  const orderContextOrders=useMemo(()=>orderPeriodOrders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[orderPeriodOrders,query,channel,trackingFilter,countryFilter,carrierFilter,pickupReportFilter]);
  const operationalContextOrders=useMemo(()=>orders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[orders,query,channel,trackingFilter,countryFilter,carrierFilter,pickupReportFilter]);
  const labelContextOrders=useMemo(()=>operationalContextOrders.filter(isLabelledOrder),[operationalContextOrders]);
  const shippedContextOrders=useMemo(()=>shippedPeriodOrders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[shippedPeriodOrders,query,channel,trackingFilter,countryFilter,carrierFilter,pickupReportFilter]);
  const pendingOrders=useMemo(()=>operationalContextOrders.filter(isPendingOrder),[operationalContextOrders]);
  const tariffPreviews=useMemo(()=>{const map:Record<string,ShippingPricePreview>={};for(const order of orders){const configuredCarrier=firstMatchingShippingRule(order,shippingRules)?.action.carrierContains||settings.orders.defaultCarrier||'';const preview=calculateDefaultShippingPreview(order,tariffs,configuredCarrier);if(preview)map[order.id]=preview}return map},[orders,tariffs,shippingRules,settings.orders.defaultCarrier]);
  const overduePending=dashboardKpis?.overduePending??pendingOrders.filter(order=>orderAgeHours(order)>=settings.orders.overdueHours).length;
  const pending=dashboardKpis?.pending??pendingOrders.length,
    amazon=dashboardKpis?.amazon??pendingOrders.filter(o=>o.sourceChannel==='amazon').length,
    shopify=dashboardKpis?.shopify??pendingOrders.filter(o=>o.sourceChannel==='shopify').length,
    manual=dashboardKpis?.manual??pendingOrders.filter(o=>o.sourceChannel==='other').length,
    labelled=dashboardKpis?.labelled??labelContextOrders.length,
    shipped=dashboardKpis?.shipped??shippedContextOrders.length,
    cancelled=dashboardKpis?.cancelled??orderContextOrders.filter(isCancelledOrder).length;
  // The paginated RPC owns row eligibility, date policy and search semantics.
  // Filtering again here can hide valid matches while retaining their server total.
  const filtered=orders;
  const sorting=useSortableTable('orders',filtered,{
    channel:order=>channelLabel(order),
    order:order=>order.orderNumber||order.orderId||order.sendcloudId||'',
    customer:order=>order.customerName||text(order.shippingAddress.name)||'',
    products:order=>productsText(order),
    destination:order=>`${text(order.shippingAddress.country_code)} ${text(order.shippingAddress.postal_code)}`,
    carrier:order=>carrierLabel(order),
    shipping:order=>shippingPriceForOrder(order,tariffPreviews[order.id])?.totalAmount??null,
    weight:order=>order.weightKg??null,
    units:order=>order.items.reduce((sum,item)=>sum+itemQty(item),0),
    total:order=>order.totalAmount??null,
    state:order=>orderState(order).label,
    tracking:order=>trackingState(order).label,
    orderDate:order=>order.orderCreatedAt||'',
    labelDate:order=>labelTimestamp(order)||'',
    printStatus:order=>labelPrintState(order).sort,
    pickupReport:order=>order.pickupReports?.[0]?.number||null,
  },{key:'orderDate',direction:'desc'});
  pageParamsRef.current={
    from:dateFrom,to:dateTo,state,channel,query,tracking:trackingFilter,workbench:true,trackingStaleDays:settings.orders.trackingStaleDays,
    country:countryFilter,carrier:carrierFilter,pickupReport:pickupReportFilter,page,pageSize:activeTab==='reports'?1:preferences.pageSize,
    overdueHours:settings.orders.overdueHours,
    sortKey:sorting.sort.key,sortDirection:sorting.sort.direction,
  };
  useEffect(()=>{setPage(0)},[query,state,channel,trackingFilter,countryFilter,carrierFilter,pickupReportFilter,dateFrom,dateTo,sorting.sort.key,sorting.sort.direction,preferences.pageSize]);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    const delay=window.setTimeout(()=>{
      void refresh().finally(()=>{if(active)setLoading(false)});
    },query.trim()?300:0);
    return()=>{active=false;window.clearTimeout(delay)};
  },[refresh,query,state,channel,trackingFilter,countryFilter,carrierFilter,pickupReportFilter,dateFrom,dateTo,sorting.sort.key,sorting.sort.direction,page,preferences.pageSize,settings.orders.overdueHours,settings.orders.trackingStaleDays,activeTab]);
  const totalPages=Math.max(1,Math.ceil(matchingTotal/preferences.pageSize));
  const pager=<div className="ordersPager" role="navigation" aria-label="Paginación de pedidos">
    <span>{matchingTotal} pedidos · Página {Math.min(page+1,totalPages)} de {totalPages}</span>
    <div className="ordersPagerActions">
      <button type="button" className="secondary" disabled={loading||selectionBusy||bulkGenerating||page===0} onClick={()=>setPage(current=>Math.max(0,current-1))}>Anterior</button>
      <button type="button" className="secondary" disabled={loading||selectionBusy||bulkGenerating||page+1>=totalPages} onClick={()=>setPage(current=>current+1)}>Siguiente</button>
    </div>
  </div>;
  const sortedOrders=filtered; // Preserve the global order returned by the server page.
  const selectableOrders=state==='pending'?filtered.filter(canPrepareOrder):filtered;
  const selectionTotal=state==='pending'?selectableTotal:matchingTotal;
  for(const item of orders)if(checkedIds.has(item.id))selectionCache.current.set(item.id,item);
  const labelSelectionAllowed=[...checkedIds].every(id=>{const item=orders.find(o=>o.id===id)||selectionCache.current.get(id);return !item||canPrepareOrder(item)});
  const selectedCount=checkedIds.size;
  const selectionFilterKey=JSON.stringify([dateFrom,dateTo,state,channel,query,trackingFilter,countryFilter,carrierFilter,pickupReportFilter,settings.orders.trackingStaleDays]);
  const currentSelectionFilterKey=useRef(selectionFilterKey);currentSelectionFilterKey.current=selectionFilterKey;
  const allSelectableSelected=selectableOrders.length>0&&selectableOrders.every(order=>checkedIds.has(order.id));
  const toggleOrder=(id:string,checked:boolean)=>{if(checked&&!checkedIds.has(id)&&checkedIds.size>=2000){setSelectionError('La selección completa supera 2.000 pedidos.');return}setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});};
  const visibleSelectedCount=selectableOrders.filter(o=>checkedIds.has(o.id)).length;
  const toggleAllOrders=(checked:boolean)=>{setCheckedIds(current=>{const next=new Set(current);for(const order of selectableOrders){if(checked)next.add(order.id);else next.delete(order.id)}if(next.size>2000){setSelectionError('La selección completa supera 2.000 pedidos. Quita pedidos antes de añadir más.');return current}return next});};
  const toggleVisiblePage=toggleAllOrders;
  const clearSelection=()=>{selectionRevision.current++;bulkQuoteRevision.current++;setCheckedIds(new Set());selectionCache.current.clear();setSelectionScope('page');setSelectionBusy(false);setSelectionError('');setBulkPreview(null);setSelectionOpen(false);setSelectionRows([])};
  const confirmSelectionScope=async(ids:string[],action:string)=>{
    const hidden=ids.filter(id=>!filtered.some(o=>o.id===id)).length;
    return !hidden||await confirmAction({title:'Incluir pedidos fuera de esta vista',message:`${ids.length} pedidos seleccionados: ${hidden} no están en la página o filtros actuales. Se usará la selección completa para ${action}.`,confirmLabel:`Continuar con los ${ids.length}`,tone:'warning'});
  };
  const openPickupSelection=async()=>{const ids=[...checkedIds],revision=selectionRevision.current;if(!ids.length||!await confirmSelectionScope(ids,'el informe de recogida')||revision!==selectionRevision.current)return;setPickupIds(ids)};
  const viewSelection=async()=>{setSelectionOpen(true);setSelectionBusy(true);setSelectionError('');const revision=++selectionRevision.current;try{const rows=await listSelectedOrdersForBulk(pageParamsRef.current,[...checkedIds]);if(revision===selectionRevision.current)setSelectionRows(rows)}catch(e){if(revision===selectionRevision.current)setSelectionError(errorMessage(e,'No se pudo releer la selección. Quita cualquier pedido que ya no esté disponible.'))}finally{if(revision===selectionRevision.current)setSelectionBusy(false)}};
  const selectAllMatching=async()=>{
    const revision=++selectionRevision.current,key=selectionFilterKey;
    setSelectionBusy(true);setSelectionError('');
    try{
      const ids=await fetchMatchingOrderIds({...pageParamsRef.current},state!=='pending');
      if(revision!==selectionRevision.current||key!==currentSelectionFilterKey.current)return;
      const combined=new Set([...checkedIdsRef.current,...ids]);if(combined.size>2000)throw new Error('La selección completa supera 2.000 pedidos. Quita pedidos antes de añadir más.');
      setCheckedIds(combined);setSelectionScope('all');
    }catch(e){if(revision===selectionRevision.current&&key===currentSelectionFilterKey.current)setSelectionError(errorMessage(e,'No se pudieron seleccionar todos los pedidos.'));}
    finally{if(revision===selectionRevision.current)setSelectionBusy(false);}
  };
  useEffect(()=>{selectionRevision.current++;bulkQuoteRevision.current++;setSelectionScope('page');setSelectionBusy(false);setSelectionError('');setBulkPreview(null);},[selectionFilterKey]);

  useEffect(()=>{const reset=()=>{selectionRevision.current++;bulkQuoteRevision.current++;selectionCache.current.clear();setSelectionOpen(false);setSelectionRows([]);setInvoiceSelectionOpen(false);setInvoiceCandidates([]);setInvoiceSelection(new Set());setInvoiceQueue([]);setInvoiceOrder(null);setPickupIds(null);setPickupHistory(null);setCheckedIds(new Set());setSelectionScope('page');setSelectionBusy(false);setSelectionError('');setBulkPreview(null);};window.addEventListener('zenvia:tenant-changed',reset);return()=>window.removeEventListener('zenvia:tenant-changed',reset);},[]);

  const labelFilenameOptions={strategy:settings.orders.labelFilenameStrategy,template:settings.orders.customLabelFilenameTemplate};
  const enabledShippingOptions=(available:ShippingOption[])=>{
    const enabled=settings.shipping.enabledCarriers.map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(!enabled.length)return available;
    return available.filter(option=>{
      const haystack=`${option.carrierCode||''} ${option.carrierName||''}`.toLowerCase();
      return enabled.some(value=>haystack.includes(value));
    });
  };
  const applyTariffPrices=(order:FulfillmentOrder,available:ShippingOption[])=>available.map(option=>{
    if(option.price!=null&&Number.isFinite(Number(option.price))&&Number(option.price)>0)return option;
    if(option.provider!=='mrw')return option;
    const tariff=estimateTransportTariffForOption(option.packageWeightKg?{...order,weightKg:option.packageWeightKg}:order,tariffs,option);
    if(!tariff?.totalAmount)return option;
    return {
      ...option,
      price:tariff.totalAmount,
      currency:tariff.currency||option.currency||'EUR',
      raw:{...(option.raw||{}),priceSource:'tariff_estimate',tariffDocumentId:tariff.documentId,tariffDocumentName:tariff.documentName,matchedServiceCode:tariff.matchedServiceCode},
    };
  });
  const automaticShippingOption=(order:FulfillmentOrder,available:ShippingOption[])=>{
    const allowed=enabledShippingOptions(available);
    if(settings.orders.shippingSelectionMode==='none')return null;
    if(settings.orders.shippingSelectionMode==='cheapest'){
      return allowed
        .filter(option=>option.price!=null&&Number(option.price)>0)
        .sort((a,b)=>Number(a.price)-Number(b.price))[0]||allowed[0]||null;
    }
    return selectShippingOptionWithDefault(order,allowed,shippingRules,settings.orders.defaultCarrier);
  };
  const validationCarrier=(order:FulfillmentOrder)=>firstMatchingShippingRule(order,shippingRules)?.action.carrierContains||settings.orders.defaultCarrier||'';

  const publishQuotes=(order:FulfillmentOrder,generation:number,states:ProviderQuotes<ShippingOption>)=>{
    if(generation!==quoteGeneration.current)return;
    const filtered=Object.fromEntries(Object.entries(states).map(([provider,result])=>{
      const options=applyTariffPrices(order,enabledShippingOptions(result.options));
      return [provider,{...result,options,...(result.state==='ready'&&!options.length?{state:'not_applicable' as const,message:'Servicios excluidos por Configuración > Envíos.'}:{})}];
    })) as ProviderQuotes<ShippingOption>;
    const weighted=Object.values(states).flatMap(result=>result.options).find(option=>option.packageWeightKg);
    if(weighted)setLabelOrder(current=>current?.id===order.id?{...current,weightKg:weighted.packageWeightKg!,weightEstimated:weighted.weightEstimated}:current);
    const next={...quoteStates.current,...filtered};quoteStates.current=next;
    setProviderStates(next);
    setOptions(applyTariffPrices(order,enabledShippingOptions(Object.values(next).flatMap(result=>result.options))));
    setOptionsLoading(Object.values(next).some(result=>result.state==='loading'));
  };
  const prepare=async(order:FulfillmentOrder)=>{
    if(busyOrder)return;
    if(!canPrepareOrder(order)){showError('Este pedido ya no admite una nueva etiqueta.');return}
    const generation=++quoteGeneration.current;quoteStates.current={};setProviderStates({});
    setPreparingOrder(order.id);
    setOptions([]);setOptionsMessage('');setOptionsLoading(true);setLabelOrder(order);
    try{await getShippingOptions(order.id,states=>publishQuotes(order,generation,states))}
    catch(e){if(generation===quoteGeneration.current)setOptionsMessage(errorMessage(e,'No se pudieron consultar los servicios y precios.'))}
    finally{if(generation===quoteGeneration.current){setOptionsLoading(false);setPreparingOrder(null)}}
  };
  const retryProvider=(provider:QuoteProvider)=>{
    if(!labelOrder)return;
    const order=labelOrder,generation=quoteGeneration.current;
    void getShippingOptions(order.id,states=>publishQuotes(order,generation,states),[provider]).catch(e=>{
      publishQuotes(order,generation,{[provider]:{state:'error',options:[],message:errorMessage(e,'No se pudo consultar el proveedor.')}});
    });
  };
  const handleBlob=async(blob:Blob,order:FulfillmentOrder,mode:'print'|'download')=>{
    const prepared=await prepareLabelPdf(blob,settings.shipping);
    if(mode==='download'){downloadLabel(prepared,labelPdfFilename(order,labelFilenameOptions));return}
    openLabelForPrint(prepared);
  };
  const createLabel=async(option:ShippingOption|null,explicitOrder:FulfillmentOrder|null=labelOrder)=>{if(!explicitOrder)return;const order=explicitOrder;
    const carrier=option?`${option.carrierCode||''} ${option.code||''} ${option.name||''}`:validationCarrier(order);
    const finalValidation=validateOrderForCarrier(order,carrier,settings.shipping);
    if(finalValidation.blocking){
      setLabelOrder(null);setEditValidationCarrier(carrier);setEditOrder(order);
      showError(`Revisa antes de generar la etiqueta: ${finalValidation.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' ')}`);
      return;
    }
    setBusyOrder(order.id);setLabelOrder(null);try{
    let downloaded=false;
    const result=await createOrderLabel(order.id,option,settings.orders.pushTrackingToMarketplace,async ready=>{
      if(ready.automation?.downloadPdf!==false&&settings.orders.downloadLabelAfterCreation&&settings.shipping.autoDownload){
        const prepared=await prepareLabelPdf(labelBlob(ready),settings.shipping);
        downloadLabel(prepared,labelPdfFilename(order,labelFilenameOptions));
        downloaded=true;
      }
    });
    // Record delivery after generation and marketplace confirmation; neither the
    // state update nor reloading the list delays offering the PDF to save.
    if(downloaded)await markOrderLabelPrinted(order.id);
    const freshOrders=await refresh();const fresh=freshOrders.find(item=>item.id===order.id)||order;setSelected(fresh);
    showSuccess(`Etiqueta creada${result.trackingNumber?` · ${result.trackingNumber}`:''}.`);
    if(result.confirmationError)showInfo(`Etiqueta creada; confirmación del envío pendiente: ${result.confirmationError}`);
  }catch(e){showError(errorMessage(e,'No se pudo crear la etiqueta.'))}finally{setBusyOrder(null)}};
  const existingLabel=async(order:FulfillmentOrder,mode:'print'|'download')=>{setBusyOrder(order.id);try{
    const result=await fetchOrderLabel(order.id);await handleBlob(labelBlob(result),order,mode);
    // Manual PDF delivery follows the same operational state as automatic download.
    {
      await markOrderLabelPrinted(order.id);
      const freshOrders=await refresh();setSelected(freshOrders.find(item=>item.id===order.id)||order);
    }
  }catch(e){showError(errorMessage(e,'No se pudo recuperar la etiqueta.'))}finally{setBusyOrder(null)}};
  const generateLabels=async(targets:FulfillmentOrder[],scope:'pendientes'|'seleccionadas',plan?:{provider:string;carrierCode:string;optionsByOrder:Record<string,ShippingOption[]>})=>{
    if(!targets.length){showSuccess(scope==='seleccionadas'?'No hay pedidos seleccionados que admitan etiqueta.':'No hay pedidos pendientes en el periodo seleccionado.');return;}
    const activity=startActivity({
      label:'Generando etiquetas de pedidos',
      detail:`Preparando 0 de ${targets.length}`,
      progress:0,
      current:0,
      total:targets.length,
      showAfterMs:150,
    });
    setBulkGenerating(true);setBulkProgress(`0/${targets.length}`);setError('');
    const zip=new JSZip(),usedNames=new Set<string>(),failed:string[]=[],generatedIds=new Set<string>();
    let processed=0,generated=0;
    try{
      for(const order of targets){
        activity.update({
          current:processed,
          progress:targets.length?processed/targets.length*90:90,
          detail:`Pedido ${order.orderNumber||order.orderId||processed+1} · ${processed} de ${targets.length}`,
        });
        try{
          const available=plan?.optionsByOrder?.[order.id]||((await getShippingOptions(order.id)).options);
          const planned=plan?available.filter(option=>option.provider===plan.provider&&String(option.carrierCode||'').toLowerCase()===plan.carrierCode.toLowerCase()):available;
          const option=plan
            ?planned.slice().sort((a,b)=>{
              const ap=a.price==null?Number.MAX_VALUE:Number(a.price),bp=b.price==null?Number.MAX_VALUE:Number(b.price);
              return ap-bp;
            })[0]||null
            :automaticShippingOption(order,available);
          if(!option)throw new Error(plan?'El transportista seleccionado no está disponible para este pedido.':'No se encontró un servicio válido según las reglas automáticas de envío.');
          // Validate only against the provider/service that will actually be used.
          const carrierValidation=validateOrderForCarrier(order,`${option.carrierCode||''} ${option.code||''} ${option.name||''}`,settings.shipping);
          if(carrierValidation.blocking)throw new Error(carrierValidation.issues[0]?.message||'El transportista rechazará los datos del pedido.');
          const result=await createOrderLabel(order.id,option,settings.orders.pushTrackingToMarketplace);
          if(result.confirmationError)showInfo(`Pedido ${order.orderNumber||order.id}: etiqueta creada; confirmación pendiente: ${result.confirmationError}`);
          const prepared=await prepareLabelPdf(labelBlob(result),settings.shipping);
          zip.file(uniqueLabelPdfFilename(order,usedNames,labelFilenameOptions),prepared);
          generated+=1;generatedIds.add(order.id);
        }catch(e){failed.push(`${order.orderNumber||order.orderId||order.id}: ${errorMessage(e,'Error al generar etiqueta')}`)}
        finally{
          processed+=1;
          setBulkProgress(`${processed}/${targets.length}`);
          activity.update({
            current:processed,
            progress:targets.length?processed/targets.length*90:90,
            detail:`Etiquetas procesadas · ${processed} de ${targets.length}`,
          });
        }
      }
      if(generated){
        activity.update({progress:90,current:processed,detail:'Comprimiendo etiquetas…'});
        const blob=await zip.generateAsync({type:'blob'},metadata=>{
          activity.update({progress:90+Math.min(100,Math.max(0,metadata.percent))*0.1,current:processed,detail:`Comprimiendo ZIP · ${Math.round(metadata.percent)}%`});
        });
        downloadBlob(blob,bulkLabelZipFilename(settings.orders.bulkZipFilenameTemplate,scope,iso(new Date())));
      }
      const freshOrders=await refresh();setCheckedIds(current=>new Set([...current].filter(id=>!generatedIds.has(id))));setSelected(current=>current?freshOrders.find(item=>item.id===current.id)||null:null);
      if(failed.length){const detail=failed.slice(0,3).join(' · ');showError(`${generated} etiquetas generadas. ${failed.length} no se pudieron generar${detail?`: ${detail}`:''}`)}
      else showSuccess(`${generated} etiquetas generadas y descargadas en un ZIP.`);
    }catch(e){showError(errorMessage(e,'Las etiquetas se generaron, pero no se pudo preparar el ZIP.'))}
    finally{setBulkGenerating(false);setBulkProgress('');activity.finish()}
  };
  const openBulkPreview=async(targets:FulfillmentOrder[],scope:'pendientes'|'seleccionadas')=>{
    if(!targets.length)return;
    if(bulkGenerating||bulkPreview?.loading)return;
    const previewRevision=++bulkQuoteRevision.current;
    setBulkPreview({targets,scope,loading:true,optionsByOrder:{},summaries:[],selectedKey:''});
    // Bound concurrent quotes (3 providers per order) to avoid traffic spikes.
    const settled: Array<PromiseSettledResult<{orderId:string;result:Awaited<ReturnType<typeof getShippingOptions>>}>>=[];
    for(let offset=0;offset<targets.length;offset+=3){
      if(previewRevision!==bulkQuoteRevision.current)return;
      const batch=await Promise.allSettled(targets.slice(offset,offset+3).map(async order=>({
        orderId:order.id,result:await getShippingOptions(order.id),
      })));
      settled.push(...batch);
    }
    if(previewRevision!==bulkQuoteRevision.current)return;
    const optionsByOrder:Record<string,ShippingOption[]>={};
    const aggregate=new Map<string,{key:string;provider:string;providerName:string;carrierCode:string;carrierName:string;orders:Set<string>;priced:number;total:number}>();
    for(const result of settled){
      if(result.status!=='fulfilled')continue;
      const {orderId,result:shipping}=result.value;
      const order=targets.find(item=>item.id===orderId);
      const allowed=order?applyTariffPrices(order,enabledShippingOptions(shipping.options)):enabledShippingOptions(shipping.options);
      optionsByOrder[orderId]=allowed;

      // Aggregate once per provider/carrier/order. A carrier can expose many
      // services (e.g. Correos Express Paq24, Punto Paq, Ecommerce...), but for
      // bulk comparison we only need the cheapest usable service for this order.
      const perOrder=new Map<string,{provider:string;providerName:string;carrierCode:string;carrierName:string;options:ShippingOption[]}>();
      for(const option of allowed){
        const carrierCode=String(option.carrierCode||option.carrierName||'').trim();
        if(!carrierCode)continue;
        const key=`${option.provider}|${carrierCode.toLowerCase()}`;
        const current=perOrder.get(key);
        if(current)current.options.push(option);
        else perOrder.set(key,{
          provider:option.provider,
          providerName:option.providerName,
          carrierCode,
          carrierName:option.carrierName||carrierCode,
          options:[option],
        });
      }

      for(const [key,group] of perOrder){
        let row=aggregate.get(key);
        if(!row){
          row={key,provider:group.provider,providerName:group.providerName,carrierCode:group.carrierCode,carrierName:group.carrierName,orders:new Set(),priced:0,total:0};
          aggregate.set(key,row);
        }
        row.orders.add(orderId);
        const pricedOptions=group.options.filter(item=>item.price!=null&&Number(item.price)>0);
        if(pricedOptions.length){
          const cheapest=Math.min(...pricedOptions.map(item=>Number(item.price)));
          row.priced+=1;
          row.total+=cheapest;
        }
      }
    }
    const summaries=[...aggregate.values()].map(row=>({key:row.key,provider:row.provider,providerName:row.providerName,carrierCode:row.carrierCode,carrierName:row.carrierName,covered:row.orders.size,priced:row.priced,total:row.total}))
      .sort((a,b)=>(b.covered-a.covered)||((a.priced===a.covered?a.total:Number.MAX_VALUE)-(b.priced===b.covered?b.total:Number.MAX_VALUE)));
    const preferred=summaries.find(row=>row.covered===targets.length)||summaries[0];
    setBulkPreview({targets,scope,loading:false,optionsByOrder,summaries,selectedKey:preferred?.key||''});
  };
  const confirmBulkPreview=async()=>{
    if(!bulkPreview||bulkPreview.loading)return;
    const selectedSummary=bulkPreview.summaries.find(row=>row.key===bulkPreview.selectedKey);
    if(!selectedSummary||selectedSummary.covered!==bulkPreview.targets.length){
      showError('El transportista seleccionado no está disponible para todos los pedidos.');
      return;
    }
    if(bulkPreview.scope==='pendientes'){
      const confirmed=await confirmAction({
        title:'Generar todas las etiquetas pendientes',
        message:`Se van a generar ${bulkPreview.targets.length} etiquetas con ${selectedSummary.carrierName} mediante ${selectedSummary.providerName}.`,
        confirmLabel:'Generar etiquetas',
        cancelLabel:'Cancelar',
        tone:'warning',
        details:['Esta acción crea las etiquetas en el transportista y puede informar el tracking al marketplace.','Se usará la opción con menor precio disponible de ese transportista para cada pedido.'],
      });
      if(!confirmed)return;
    }
    const snapshot=bulkPreview;
    setBulkPreview(null);
    await generateLabels(snapshot.targets,snapshot.scope,{provider:selectedSummary.provider,carrierCode:selectedSummary.carrierCode,optionsByOrder:snapshot.optionsByOrder});
  };
  const generateConfiguredLabels=async(forcePending=false)=>{
    if(!forcePending&&settings.orders.bulkScope==='selected')return generateSelectedLabels();
    try{
      // Deliberate user action: load every matching pending order lazily.
      // Never restrict "Generar etiquetas pendientes" to the current 25 rows.
      const targets=await listMatchingPendingOrdersForBulk(pageParamsRef.current);
      return openBulkPreview(targets.filter(canPrepareOrder),'pendientes');
    }catch(e){showError(errorMessage(e,'No se pudieron recuperar todos los pedidos pendientes.'))}
  };
  const generateSelectedLabels=async()=>{
    if(selectionBusy||bulkGenerating||bulkPreview?.loading||!checkedIds.size)return;
        const revision=++selectionRevision.current,key=selectionFilterKey,ids=[...checkedIds];
    setSelectionBusy(true);setSelectionError('');
    try{
      if(!await confirmSelectionScope(ids,'generar etiquetas')||revision!==selectionRevision.current)return;
      const targets=await listSelectedOrdersForBulk({...pageParamsRef.current},ids);
      if(revision!==selectionRevision.current||key!==currentSelectionFilterKey.current)return;
      if(targets.some(order=>!canPrepareOrder(order)))throw new Error('El conjunto de pedidos ha cambiado. Actualiza y vuelve a seleccionar.');
      await openBulkPreview(targets,'seleccionadas');
    }catch(e){if(revision===selectionRevision.current)setSelectionError(errorMessage(e,'No se pudieron recuperar los pedidos seleccionados.'));}
    finally{if(revision===selectionRevision.current)setSelectionBusy(false);}
  };
  const openShopifyInvoiceSelection=async()=>{
    try{
      // Invoicing is explicitly requested: fetch the complete filtered Shopify
      // scope on demand instead of silently using only the visible page.
      const ids=[...checkedIds],revision=selectionRevision.current;
      if(ids.length&&!await confirmSelectionScope(ids,'facturar pedidos'))return;
      const candidates=ids.length?await listSelectedOrdersForBulk(pageParamsRef.current,ids):await listMatchingOrdersForAction({...pageParamsRef.current,channel:'shopify'});
      if(revision!==selectionRevision.current)return;
      if(ids.length&&candidates.some(o=>o.sourceChannel!=='shopify'||isCancelledOrder(o)))throw new Error('La facturación admite pedidos Shopify no cancelados. Revisa la selección completa; no se omitirá ningún pedido.');
      setInvoiceCandidates(candidates.filter(order=>!isCancelledOrder(order)));
      setInvoiceSelection(new Set(ids));
      setInvoiceSelectionOpen(true);
    }catch(e){showError(errorMessage(e,'No se pudieron recuperar los pedidos Shopify para facturar.'))}
  };
  const changeLabelSize=async(value:ShippingSettings['labelSize'])=>{
    if(value===settings.shipping.labelSize)return;
    try{
      await updateSection('shipping',{...settings.shipping,labelSize:value});
      const label=value==='AUTO'?'Automático / original':value==='10x15'?'10 × 15 cm':value;
      showSuccess(`Formato de etiqueta: ${label}.`);
    }catch(e){showError(errorMessage(e,'No se pudo guardar el formato de etiqueta.'))}
  };
  const saveManual=async(value:any)=>{setManualSaving(true);try{const result=await createManualOrder(value);await refresh();setManualOpen(false);showSuccess(`Pedido ${result.orderNumber} creado en ZENVIA.`)}catch(e){showError(errorMessage(e,'No se pudo crear el pedido manual.'))}finally{setManualSaving(false)}};
  const saveEdit=async(value:OrderUpdateInput)=>{if(!editOrder)return;setEditSaving(true);try{await updateFulfillmentOrder(editOrder.id,value);const freshOrders=await refresh();const fresh=freshOrders.find(item=>item.id===editOrder.id)||editOrder;setSelected(fresh);setEditValidationCarrier('');setEditOrder(null);showSuccess('Pedido actualizado en ZENVIA.')}catch(e){showError(errorMessage(e,'No se pudo actualizar el pedido.'))}finally{setEditSaving(false)}};

  const openQuickTracking=async(order:FulfillmentOrder)=>{
    const popup=window.open('about:blank','_blank');
    if(popup)popup.opener=null;
    try{
      const result=await getOrderTrackingLink(order.id);
      const url=trackingUrlForOrder({...order,carrierTrackingUrl:result.url});
      if(!url)throw new Error('El transportista todavía no ha facilitado un enlace de seguimiento.');
      if(popup)popup.location.href=url;
      else showInfo('Permite las ventanas emergentes para abrir el seguimiento del transportista.');
    }catch(error){popup?.close();showError(errorMessage(error,'No se pudo abrir el seguimiento.'));}
  };
  const trackingFirst=activeTab==='issues'||activeTab==='shipped';
  const carrierCell=(order:FulfillmentOrder)=><><strong className="ordersCarrierText">{carrierLabel(order)}</strong>{order.shippingProvider&&<small className={"ordersShippingProvider "+order.shippingProvider}>{order.shippingProvider==='envia'?'Envia.com':order.shippingProvider==='mrw'?'MRW directo':'Sendcloud'}</small>}</>;
  const trackingCell=(order:FulfillmentOrder)=><><ShipmentTrackingStatus order={order} staleDays={settings.orders.trackingStaleDays} operational/>{trackingUrlForOrder(order)&&<a className="ordersQuickTracking" href={trackingUrlForOrder(order)!} target="_blank" rel="noreferrer" aria-label={`Abrir seguimiento de ${order.orderNumber||order.orderId} en ${carrierLabel(order)}`} onClick={event=>event.stopPropagation()}>Abrir seguimiento <ExternalLink size={14}/></a>}{!trackingUrlForOrder(order)&&order.trackingNumber&&!order.piiPurgedAt&&<button type="button" className="link ordersQuickTracking" onClick={event=>{event.stopPropagation();void openQuickTracking(order)}} aria-label={`Abrir seguimiento de ${order.orderNumber||order.orderId} en ${carrierLabel(order)}`}>Abrir seguimiento <ExternalLink size={14}/></button>}</>;
  const headerUtilities=<>
    <button type="button" className="secondary zenviaTransportTariffsButton" aria-label="Abrir tarifas de transporte" onClick={()=>setTariffsOpen(true)}><Truck size={16}/> Tarifas de transporte</button>
    <label className="ordersQuickLabelFormat"><span>Formato del PDF</span><SelectField value={settings.shipping.labelSize} onChange={value=>void changeLabelSize(value as ShippingSettings['labelSize'])} ariaLabel="Formato rápido de etiqueta" options={[{value:'AUTO',label:'Original'},{value:'A6',label:'A6'},{value:'10x15',label:'10 × 15'},{value:'A5',label:'A5'},{value:'A4',label:'A4'}]}/></label>
    <button className="secondary" onClick={()=>void openShopifyInvoiceSelection()} disabled={bulkGenerating||selectionBusy}><FileText size={16}/> Facturación manual de Shopify</button>
  </>;
  const changeWorkbenchFilter=(patch:Partial<OrdersWorkbenchFilterValues>)=>{
    if(patch.query!==undefined)setQuery(patch.query);
    if(patch.channel!==undefined)setChannel(patch.channel as 'all'|OrderChannel);
    if(patch.country!==undefined)setCountryFilter(patch.country);
    if(patch.carrier!==undefined)setCarrierFilter(patch.carrier);
    if(patch.pickupReport!==undefined)setPickupReportFilter(patch.pickupReport);
    if(patch.tracking!==undefined)setTrackingFilter(patch.tracking as TrackingFilter);
  };
  return <div className="page ordersPage designSystemPage ordersWorkbench">
    <PageHeader title="Pedidos" eyebrow="LOGÍSTICA" description="Tu bandeja de trabajo de pedidos y envíos." actions={<>
      <button className="secondary" onClick={()=>setManualOpen(true)}><Plus size={16}/> Nuevo pedido</button>
      <button className="primary" aria-label="Actualizar pedidos" onClick={()=>sync(false,false)} disabled={syncing||bulkGenerating}>{syncing?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} {compactHeader?'Actualizar':'Actualizar pedidos'}</button>
      <details className="ordersHeaderMore"><summary>Más acciones</summary><div className="ordersHeaderMenu">{headerUtilities}</div></details>
    </>}/>
    <PageTabs label="Bandejas de pedidos" value={activeTab==='all'?'pending':activeTab} onChange={changeTab} variant="workbench" panelId="orders-workbench-panel" items={ORDERS_TABS.map(tab=>({...tab,badge:tab.id==='reports'?undefined:<span className="ordersTabCount">{workbenchCounters?.[tab.id]==null?'—':workbenchCounters[tab.id]?.toLocaleString('es-ES')}</span>}))}/>
    <div id="orders-workbench-panel" role="tabpanel" aria-labelledby={'orders-workbench-panel-tab-'+(activeTab==='all'?'pending':activeTab)}>
    {activeTab==='all'&&<div className="ordersAllView"><strong>Todos los pedidos</strong><button className="link" onClick={()=>changeTab('pending')}>Volver a Pendientes</button></div>}

    {(status?.configured||enviaStatus?.configured)&&<section className="ordersConnection"><CheckCircle2 size={16}/><span>Logística conectada</span><small>{[status?.configured?'Sendcloud':null,enviaStatus?.configured?'Envia.com · '+(enviaStatus.accounts.map(account=>account.displayName).join(', ')||'conectado'):null].filter(Boolean).join(' · ')}</small></section>}
    {status&&!status.configured&&!enviaStatus?.configured&&<section className="card ordersSetup"><AlertCircle/><div><h3>Falta conectar un proveedor logístico</h3><p>Conecta Sendcloud o Envia.com para sincronizar envíos y generar etiquetas.</p></div></section>}{error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}

    {activeTab==='reports'?<PickupReportHistory embedded onClose={()=>changeTab('labelled')}/>:<>
    {ordersTabUsesPeriod(activeTab)&&<PeriodFilterPanel filter={dateFilter} onChange={setDateFilter} title={activeTab==='shipped'?'Fecha de expedición':'Fecha del pedido'} className="ordersPeriodPanel"/>}
    <OrdersWorkbenchFilters tab={activeTab} values={{query,channel,country:countryFilter,carrier:carrierFilter,pickupReport:pickupReportFilter,tracking:trackingFilter}} onChange={changeWorkbenchFilter} countries={countryOptions} carriers={carrierOptions} channelCounts={activeTab==='pending'&&dashboardKpis?{amazon:dashboardKpis.amazon,shopify:dashboardKpis.shopify,manual:dashboardKpis.manual}:undefined} onShowAll={()=>changeTab('all')}/>
    {activeTab==='pending'&&overduePending>0&&<p className="ordersQueueNotice">{overduePending} pendientes con más de {settings.orders.overdueHours} h</p>}
    <BulkSelectionToolbar alwaysVisible disabled={selectionBusy||bulkGenerating||loading||!selectableOrders.length} selectedCount={selectedCount} totalCount={selectableOrders.length} allSelected={allSelectableSelected} indeterminate={visibleSelectedCount>0&&!allSelectableSelected} onToggleAll={toggleAllOrders} scopeLabel="esta página" countLabel={`${selectedCount} seleccionados · ${visibleSelectedCount} de ${selectableOrders.length} en esta página`}>
      <button type="button" className="link" disabled={!selectedCount||selectionBusy||bulkGenerating} onClick={()=>void viewSelection()}>Ver selección</button>
      <button type="button" className="link" disabled={!selectedCount||bulkGenerating} onClick={clearSelection}>Quitar selección</button>
      {actionsForTab.labels&&<button className="primary" type="button" disabled={!selectedCount||!labelSelectionAllowed||bulkGenerating||selectionBusy||loading} onClick={()=>void generateSelectedLabels()}><Download size={15}/> {selectionBusy?'Recuperando selección…':bulkGenerating&&selectedCount?`Generando ${bulkProgress}`:`Generar etiquetas seleccionadas (${selectedCount})`}</button>}
      {activeTab==='pending'&&<button className="secondary" type="button" onClick={()=>void generateConfiguredLabels(true)} disabled={bulkGenerating||selectionBusy||loading||(dashboardKpis?.preparablePending??pendingOrders.filter(canPrepareOrder).length)===0}><Download size={15}/> Generar etiquetas pendientes ({pending})</button>}
      {actionsForTab.pickup&&<button className="secondary" type="button" disabled={!selectedCount||bulkGenerating||selectionBusy||loading} onClick={()=>void openPickupSelection()}><FileText size={15}/> Generar informe de recogida ({selectedCount})</button>}
    </BulkSelectionToolbar>
    {(selectedCount>0||selectionError||allSelectableSelected)&&<div className="ordersSelectionScope" role="note">
      <p className="muted">{selectionScope==='all'?`Seleccionados ${selectedCount} pedidos, incluyendo todos los resultados del último filtro.`:`Seleccionados ${selectedCount} pedidos. La selección se conserva al buscar, filtrar, cambiar de página o de pestaña.`}</p>
      {allSelectableSelected&&selectionTotal>selectableOrders.length&&<button type="button" className="link" disabled={selectionBusy||bulkGenerating||loading} onClick={()=>void selectAllMatching()}>{selectionBusy?'Seleccionando todos…':`Seleccionar los ${selectionTotal} pedidos que coinciden con los filtros`}</button>}
      {selectionScope==='all'&&<button type="button" className="link" disabled={selectionBusy||bulkGenerating} onClick={clearSelection}>Borrar selección completa</button>}
      {!labelSelectionAllowed&&<p className="muted">La selección contiene pedidos que ya no admiten una nueva etiqueta. Revisa «Ver selección» antes de generar etiquetas.</p>}
      {selectionError&&<p className="errorText" role="alert">{selectionError}</p>}
    </div>}


    <TableSortReset sorting={sorting}/>
    {pager}
    <section className="card tableCard ordersTableCard">{loading?<div className="emptyState large"><LoaderCircle className="spin"/> Cargando pedidos…</div>:filtered.length?<table className={`ordersTable ${trackingFirst?'ordersTrackingFirst':''}`}><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allSelectableSelected} indeterminate={visibleSelectedCount>0&&!allSelectableSelected} disabled={selectionBusy||bulkGenerating||!selectableOrders.length} onChange={toggleVisiblePage} label={allSelectableSelected?(state==='pending'?'Deseleccionar pedidos pendientes de esta página':'Deseleccionar pedidos de esta página'):(state==='pending'?'Seleccionar pedidos pendientes de esta página':'Seleccionar pedidos de esta página')}/></th>
      {!trackingFirst&&<SortableTableHeader label="Canal" sortKey="channel" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>}
      <SortableTableHeader label="Pedido" sortKey="order" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Cliente" sortKey="customer" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>{trackingFirst&&<><SortableTableHeader label="Transportista" sortKey="carrier" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/><SortableTableHeader label="Seguimiento" sortKey="tracking" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/><SortableTableHeader label="Canal" sortKey="channel" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/></>}
      <SortableTableHeader label="Productos" sortKey="products" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Destino" sortKey="destination" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      {!trackingFirst&&<SortableTableHeader label="Transportista" sortKey="carrier" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>}
      <SortableTableHeader label="Envío" sortKey="shipping" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Peso" sortKey="weight" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Unidades" sortKey="units" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort} className="right"/>
      <SortableTableHeader label="Total" sortKey="total" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort} className="right"/>
      <SortableTableHeader label="Estado" sortKey="state" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      {!trackingFirst&&<SortableTableHeader label="Seguimiento" sortKey="tracking" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>}
      <SortableTableHeader label="Fecha pedido" sortKey="orderDate" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Fecha etiqueta" sortKey="labelDate" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Impresión" sortKey="printStatus" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Informe de recogida" sortKey="pickupReport" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/><th></th></tr></thead><tbody>{sortedOrders.map(order=>{const stateInfo=orderState(order),tracking=trackingState(order),validation=canPrepareOrder(order)?validateOrderForCarrier(order,undefined,settings.shipping):{blocking:false,issues:[] as OrderValidationIssue[]},shipping=shippingPriceForOrder(order,tariffPreviews[order.id]),first=order.items[0];return <tr key={order.id} className={`clickableRow ${checkedIds.has(order.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(order)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(order.id)} disabled={selectionBusy||bulkGenerating||(state==='pending'&&!canPrepareOrder(order))} onChange={checked=>toggleOrder(order.id,checked)} label={state!=='pending'||canPrepareOrder(order)?`Seleccionar pedido ${order.orderNumber||order.orderId}`:'Este pedido ya no admite una nueva etiqueta'}/></td>{!trackingFirst&&<td><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span></td>}<td className="ordersOrderCell"><strong>{order.orderNumber||order.orderId||order.sendcloudId}</strong><small>{order.integrationName||''}</small></td><td>{customerWithCountry(order)}{validation.blocking&&<small className="ordersValidationWarn"><AlertCircle size={12}/> Revisar</small>}</td>{trackingFirst&&<><td>{carrierCell(order)}</td><td className="ordersPriorityTracking">{trackingCell(order)}</td><td><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span></td></>}<td className="ordersProductsCell" aria-label={productsText(order)}>{first?<div className="ordersProductIdentity">{(order.sourceChannel==='amazon'||order.sourceChannel==='shopify')&&(itemImageUrl(first,amazonImages)?<img className="ordersProductThumb" src={itemImageUrl(first,amazonImages)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="ordersProductThumb ordersProductThumbPlaceholder"><ImageOff size={16}/></span>)}<div><OrderProductLines lines={order.items.map(item=>({name:itemLabel(item),quantity:itemQty(item)}))}/></div></div>:'—'}</td><td>{text(order.shippingAddress.country_code)||'—'} · {text(order.shippingAddress.postal_code)||''}</td>{!trackingFirst&&<td>{carrierCell(order)}</td>}<td><strong className="ordersShippingPrice">{shipping?money(shipping.totalAmount,shipping.currency):'—'}</strong>{shipping&&shipping.source!=='recorded'&&<small>estimado</small>}</td><td><strong>{weightLabel(order,settings.shipping.weightUnit)}</strong></td><td className="right"><strong>{order.items.reduce((sum,item)=>sum+itemQty(item),0)}</strong></td><td className="right"><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></td><td><span className={`ordersState ${stateInfo.className}`}>{stateInfo.className==='ready'?<PackageCheck size={13}/>:stateInfo.className==='pending'?<Truck size={13}/>:<AlertCircle size={13}/>} {stateInfo.label}</span></td>{!trackingFirst&&<td><ShipmentTrackingStatus order={order} staleDays={settings.orders.trackingStaleDays}/></td>}<td>{dateLabel(order.orderCreatedAt,settings.general)}</td><td>{dateLabel(labelTimestamp(order),settings.general)}</td><td>{hasShippingLabel(order)&&(()=>{const print=labelPrintState(order);return <span className={`ordersPrintState ${print.className}`}>{print.label}</span>})()}</td><td onClick={e=>e.stopPropagation()}>{order.pickupReports?.length?order.pickupReports.map(r=><button type="button" className="link ordersPickupLink" key={r.id} aria-label={`Abrir informe ${r.number}`} onClick={()=>setPickupHistory(order.id)}>{r.number}</button>):<span className="muted">Sin informe</span>}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">No hay pedidos para estos filtros y fechas.</div>}</section>
    <div className="ordersMobileList">{sortedOrders.map(order=>{const stateInfo=orderState(order),tracking=trackingState(order),validation=canPrepareOrder(order)?validateOrderForCarrier(order,undefined,settings.shipping):{blocking:false,issues:[] as OrderValidationIssue[]},shipping=shippingPriceForOrder(order,tariffPreviews[order.id]);return <div className={`bulkMobileSelectableRow ${checkedIds.has(order.id)?'selected':''}`} key={order.id}><BulkSelectCheckbox checked={checkedIds.has(order.id)} disabled={selectionBusy||bulkGenerating||(state==='pending'&&!canPrepareOrder(order))} onChange={checked=>toggleOrder(order.id,checked)} label={state!=='pending'||canPrepareOrder(order)?`Seleccionar pedido ${order.orderNumber||order.orderId}`:'Este pedido ya no admite una nueva etiqueta'}/><button className="card ordersMobileRow" onClick={()=>setSelected(order)}><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><strong>{order.orderNumber||order.orderId}</strong><small className="ordersMobileCustomer"><CountryFlag code={order.shippingAddress.country_code}/>{order.customerName||'Cliente'} · {weightLabel(order,settings.shipping.weightUnit)} · {carrierLabel(order)} · Envío {shipping?money(shipping.totalAmount,shipping.currency):'—'}</small>{validation.blocking&&<small className="ordersValidationWarn"><AlertCircle size={12}/> Revisar pedido</small>}<small>Pedido {dateLabel(order.orderCreatedAt,settings.general)} · Etiqueta {dateLabel(labelTimestamp(order),settings.general)}{hasShippingLabel(order)?` · ${labelPrintState(order).label}`:''}</small>{order.items[0]&&<div className="ordersMobileProductRow">{(order.sourceChannel==='amazon'||order.sourceChannel==='shopify')&&(itemImageUrl(order.items[0],amazonImages)?<img className="ordersProductThumb" src={itemImageUrl(order.items[0],amazonImages)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="ordersProductThumb ordersProductThumbPlaceholder"><ImageOff size={15}/></span>)}<OrderProductLines lines={order.items.map(item=>({name:itemLabel(item),quantity:itemQty(item)}))}/></div>}</div><div><b>{money(order.totalAmount,order.currency||'EUR')}</b><span className={`ordersState ${stateInfo.className}`}>{stateInfo.label}</span>{!trackingFirst&&<ShipmentTrackingStatus order={order} staleDays={settings.orders.trackingStaleDays}/>}</div><ChevronRight size={18}/></button>{trackingFirst&&<div className="ordersMobileTracking">{trackingCell(order)}</div>}<div className="ordersMobilePickup">{order.pickupReports?.length?order.pickupReports.map(r=><button type="button" className="link ordersPickupLink" key={r.id} aria-label={`Abrir informe ${r.number}`} onClick={()=>setPickupHistory(order.id)}>{r.number}</button>):<span className="muted">Sin informe de recogida</span>}</div></div>})}</div>
    {pager}

    </>}
    </div>
    <TransportTariffsPanel open={tariffsOpen} onClose={()=>setTariffsOpen(false)}/>
    {bulkPreview&&<div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!bulkPreview.loading)setBulkPreview(null)}}><section className="modal ordersLabelModal">
      <div className="modalHead"><div><h3>Generar etiquetas en bloque</h3><p>Compara los transportistas disponibles para los {bulkPreview.targets.length} pedidos y elige con cuál generar todas las etiquetas.</p></div><button disabled={bulkPreview.loading||bulkGenerating} onClick={()=>setBulkPreview(null)}><X size={18}/></button></div>
      <div className="ordersLabelBody">
        {bulkPreview.loading?<div className="ordersOptionsLoading"><LoaderCircle className="spin"/><span>Consultando precios y disponibilidad para {bulkPreview.targets.length} pedidos…</span></div>:<>
          <section className="ordersComparison">
            <div className="ordersComparisonHead"><div><strong>Transportistas disponibles</strong><span>El total usa el servicio con menor precio disponible de cada transportista en cada pedido.</span></div></div>
            <div className="ordersComparisonList">{bulkPreview.summaries.map(row=>{
              const complete=row.covered===bulkPreview.targets.length;
              const fullyPriced=row.priced===bulkPreview.targets.length;
              return <button type="button" key={row.key} disabled={!complete} className={'ordersComparisonRow '+(bulkPreview.selectedKey===row.key?'selected':'')} onClick={()=>setBulkPreview(current=>current?{...current,selectedKey:row.key}:current)}>
                <div className="ordersComparisonIdentity"><span className={'ordersProviderBadge '+row.provider}>{row.providerName}</span><strong>{row.carrierName}</strong><small>{row.covered}/{bulkPreview.targets.length} pedidos disponibles</small></div>
                <div><span>Precio total</span><strong>{fullyPriced?money(row.total,'EUR'):'—'}</strong><small>{fullyPriced?'Suma de mejores servicios':row.priced+' pedidos con precio'}</small></div>
                <div><span>Cobertura</span><strong>{complete?'Todos':'Parcial'}</strong><small>{complete?'Apto para generación masiva':'No disponible en todos'}</small></div>
              </button>;
            })}</div>
          </section>
          {!bulkPreview.summaries.length&&<div className="ordersNoOption">No hay ningún transportista disponible para estos pedidos.</div>}
        </>}
      </div>
      <div className="modalActions"><button className="secondary" disabled={bulkPreview.loading||bulkGenerating} onClick={()=>setBulkPreview(null)}>Cancelar</button><button className="primary" disabled={bulkPreview.loading||bulkGenerating||!bulkPreview.selectedKey||bulkPreview.summaries.find(row=>row.key===bulkPreview.selectedKey)?.covered!==bulkPreview.targets.length} onClick={()=>void confirmBulkPreview()}>{bulkGenerating?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>} Generar todas</button></div>
    </section></div>}
    {invoiceSelectionOpen&&<div className="modalBackdrop"><div className="modal polishedModal"><div className="modalHead"><div><h3>Facturar pedidos Shopify</h3><p>Selecciona los pedidos. Revisarás cada factura antes de emitirla o enviarla.</p></div><button onClick={()=>setInvoiceSelectionOpen(false)} aria-label="Cerrar"><X/></button></div><div style={{maxHeight:'50vh',overflowY:'auto'}}>{invoiceCandidates.filter(o=>o.sourceChannel==='shopify'&&!isCancelledOrder(o)).map(o=><label key={o.id} style={{display:'flex',gap:12,padding:12}}><input type="checkbox" checked={invoiceSelection.has(o.id)} onChange={e=>{const checked=e.target.checked;setInvoiceSelection(ids=>{const next=new Set(ids);if(checked)next.add(o.id);else next.delete(o.id);return next})}}/>{o.orderNumber} · {o.customerName} · {money(o.totalAmount,o.currency||'EUR')}</label>)}</div><div className="modalActions"><button className="secondary" onClick={()=>setInvoiceSelectionOpen(false)}>Cancelar</button><button className="primary" disabled={!invoiceSelection.size} onClick={()=>{const targets=invoiceCandidates.filter(o=>invoiceSelection.has(o.id));setInvoiceOrder(targets[0]);setInvoiceQueue(targets.slice(1));setInvoiceSelectionOpen(false)}}>Revisar {invoiceSelection.size} pedidos</button></div></div></div>}
    {invoiceOrder&&<OrderInvoiceModal key={invoiceOrder.id} order={invoiceOrder} hasNext={invoiceQueue.length>0} onClose={()=>{setInvoiceOrder(invoiceQueue[0]||null);setInvoiceQueue(q=>q.slice(1))}} onSaved={()=>void refresh()}/> }
    {selected&&(()=>{const current=orders.find(item=>item.id===selected.id)||selected;const validation=canPrepareOrder(current)?validateOrderForCarrier(current,undefined,settings.shipping):{blocking:false,issues:[] as OrderValidationIssue[]};const shipping=shippingPriceForOrder(current,tariffPreviews[current.id]);return <OrderDrawer order={current} shippingPrice={shipping} validationIssues={validation.issues} productImages={amazonImages} onClose={()=>setSelected(null)} onEdit={()=>{setEditValidationCarrier(validationCarrier(current));setEditOrder(current)}} onPrepare={()=>prepare(current)} onPrint={()=>existingLabel(current,'print')} onDownload={()=>existingLabel(current,'download')} onInvoice={()=>{setSelected(null);setInvoiceOrder(current)}} onRegisterExternal={()=>{void loadIntegrationAccounts().then(accounts=>{setExternalAccounts(accounts);setExternalOrder(current)}).catch(e=>showError(errorMessage(e,'No se pudieron cargar las cuentas de transporte.')))}} onConfirmShipment={()=>{setBusyOrder(current.id);void confirmOrderTracking(current.id).then(async()=>{await refresh();showSuccess('Envío confirmado en Shopify.');}).catch(e=>showError(errorMessage(e,'No se pudo confirmar el envío en Shopify.'))).finally(()=>setBusyOrder(null))}} busy={busyOrder===selected.id||preparingOrder===selected.id}/>})()}
    {selectionOpen&&<div className="modalBackdrop"><section className="modal pickupModal" role="dialog" aria-modal="true" aria-label="Pedidos seleccionados"><header className="modalHead"><h2>{selectedCount} pedidos seleccionados</h2><button type="button" aria-label="Cerrar selección" onClick={()=>setSelectionOpen(false)}><X/></button></header><div className="pickupBody">{selectionBusy&&<p role="status">Releyendo selección…</p>}{selectionError&&<p className="errorText">{selectionError}</p>}{[...checkedIds].map(id=>{const row=selectionRows.find(o=>o.id===id)||selectionCache.current.get(id);return <div className="pickupRow" key={id}><span>{row?.orderNumber||id} · {row?.sourceChannel==='shopify'?'Shopify':row?.sourceChannel==='amazon'?'Amazon':'Pedido'}</span><button className="secondary" disabled={bulkGenerating} onClick={()=>toggleOrder(id,false)} aria-label={`Quitar pedido ${row?.orderNumber||id}`}>Quitar</button></div>})}</div><footer className="modalActions"><button className="secondary" onClick={()=>setSelectionOpen(false)}>Volver a pedidos</button></footer></section></div>}
    {pickupIds&&<PickupReportModal ids={pickupIds} onClose={()=>setPickupIds(null)} onCreated={()=>{clearSelection();void refresh()}}/>}
    {pickupHistory&&<PickupReportHistory orderId={pickupHistory==='all'?undefined:pickupHistory} onClose={()=>setPickupHistory(null)}/>}
    {labelOrder&&<LabelModal order={labelOrder} options={options} tariffs={tariffs} message={optionsMessage} loading={optionsLoading} providerStates={providerStates} onRetry={retryProvider} preferredOption={automaticShippingOption(labelOrder,options)} onClose={()=>{quoteGeneration.current++;setPreparingOrder(null);setLabelOrder(null)}} onCreate={createLabel}/>}
    {manualOpen&&<ManualOrderModal saving={manualSaving} defaultCountryCode={settings.orders.originCountryCode} fallbackWeightKg={settings.shipping.fallbackWeightKg} weightUnit={settings.shipping.weightUnit} onClose={()=>setManualOpen(false)} onSave={saveManual}/>}
    {externalOrder&&<ExternalShipmentModal key={externalOrder.id} order={externalOrder} accounts={externalAccounts} onClose={()=>setExternalOrder(null)} onSave={async(input,requestId)=>{
      await registerExternalShipment(externalOrder.id,input,requestId);
      let confirmationError='';
      if(input.notifySource){try{await confirmOrderTracking(externalOrder.id)}catch(e){confirmationError=errorMessage(e,'No se pudo confirmar el tracking en el canal.')}}
      setExternalOrder(null);setSelected(null);await refresh();
      if(confirmationError)showError('El envío externo está registrado. Confirmación del canal pendiente: '+confirmationError);
      else showSuccess(input.notifySource?'Envío externo registrado y tracking confirmado en el canal.':'Envío externo registrado.');
    }}/>}
    {editOrder&&<OrderEditModal order={editOrder} fallbackWeightKg={settings.shipping.fallbackWeightKg} saving={editSaving} validationCarrier={editValidationCarrier} onClose={()=>{setEditValidationCarrier('');setEditOrder(null)}} onSave={saveEdit}/>}
  </div>;
}
