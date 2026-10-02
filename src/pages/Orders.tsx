import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertCircle, Calculator, CheckCircle2, ChevronRight, Download, Euro,
  ExternalLink, ImageOff, LoaderCircle, MapPin, PackageCheck, Percent, Pencil, Plus, Printer, RefreshCw,
  Search, Settings2, ShoppingBag, Store, Trash2, Truck, X,
} from 'lucide-react';
import { OrderEditModal } from '../components/OrderEditModal';
import { SelectField } from '../components/forms/SelectField';
import { SearchableSelect } from '../components/forms/SearchableSelect';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { defaultDateFilter, periodLabel } from '../services/filters';
import {
  createManualOrder, createOrderLabel, fetchOrderLabel,
  getEnviaStatus, getSendcloudStatus, getShippingOptions, labelBlob, listFulfillmentOrders, listLocalPrinters, markOrderLabelPrinted,
  markEnviaHistorySyncDone, markHistorySyncDone, openLabelForPrint, printLabelWithClient,
  shouldRunEnviaHistorySync, shouldRunHistorySync, syncEnviaShipments, syncSendcloudOrders, retryAmazonTrackingConfirmations, updateFulfillmentOrder,
  type FulfillmentOrder, type LocalPrinter, type ManualOrderItem, type OrderChannel, type OrderUpdateInput,
  type SendcloudStatus, type ShippingOption,
} from '../services/orders';
import { bulkLabelZipFilename, labelPdfFilename, uniqueLabelPdfFilename } from '../services/orderLabelFiles';
import { firstMatchingShippingRule, selectShippingOptionByRules } from '../services/shippingRuleCore';
import { defaultShippingRules, loadShippingRules, type ShippingRule } from '../services/shippingRules';
import { prepareLabelPdf } from '../services/labelPdf';
import { useSettings } from '../context/SettingsContext';
import { loadAmazonProductImages } from '../services/amazon';
import { listTransportTariffs, type TransportTariffDocument } from '../services/transportTariffs';
import {
  calculateDefaultShippingPreview, estimateTransportTariffForOption, previewFromShippingOption, shippingPriceForOrder, validateOrderForCarrier,
  type OrderValidationIssue, type ShippingPricePreview,
} from '../services/orderShipping';
import { errorMessage, showError, showInfo, showSuccess } from '../services/toast';
import { persistRememberedFilter, rememberedFilter } from '../services/uiPreferences';
import { formatAppDateTime } from '../services/formatting';
import { startActivity } from '../services/activity';
import { confirmAction } from '../services/actionDialog';
import type { GeneralSettings, ShippingSettings } from '../services/settingsSchema';
import { SortableTableHeader, useSortableTable } from '../components/SortableTableHeader';

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

type OrderFilter='pending'|'labelled'|'shipped'|'cancelled'|'all';
type TrackingFilter='all'|'none'|'ready'|'transit'|'route'|'pickup'|'delivered'|'issue'|'cancelled';

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
function weightLabel(order:FulfillmentOrder,unit:ShippingSettings['weightUnit']){return weightValueLabel(order.weightKg,unit);}
function orderAgeHours(order:FulfillmentOrder){if(!order.orderCreatedAt)return 0;const created=new Date(order.orderCreatedAt).getTime();return Number.isFinite(created)?Math.max(0,(Date.now()-created)/3600000):0;}
function orderStatusCode(order:FulfillmentOrder){return String(order.sourceStatus||'').trim().toLowerCase();}
function isCancelledOrder(order:FulfillmentOrder){return orderStatusCode(order).includes('cancel');}
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
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  // Once a logistics label exists, the physical carrier status is authoritative.
  // Marketplaces such as Amazon can report "Shipped" as soon as tracking is
  // confirmed, before the carrier has actually collected the parcel.
  if(hasShippingLabel(order)){
    if(
      raw.includes('created')||
      raw.includes('ready to send')||
      raw.includes('ready for shipment')||
      raw.includes('announced')||
      raw.includes('being announced')||
      raw.includes('pending')||
      raw.includes('no label')||
      raw.includes('announcement failed')||
      raw.includes('error collecting')
    )return false;
    if(
      raw.includes('picked up')||
      raw.includes('shipment picked up')||
      raw.includes('in transit')||
      raw.includes('parcel en route')||
      raw.includes('sorting centre')||
      raw.includes('sorting center')||
      raw.includes('being sorted')||
      raw.includes('driver en route')||
      raw.includes('out for delivery')||
      raw.includes('awaiting customer pickup')||
      raw.includes('delivery attempt failed')||
      raw.includes('unable to deliver')||
      raw.includes('address invalid')||
      raw.includes('refused')||
      raw.includes('returned to sender')||
      raw.includes('delivery delayed')||
      raw.includes('delivered')||
      raw.includes('shipment collected by customer')
    )return true;
    // If the carrier has not given us a movement event yet, keep it in
    // Etiquetados even if the marketplace source status already says Shipped.
    return false;
  }
  const status=orderStatusCode(order);
  return status==='fulfilled'||status==='shipped'||status==='delivered';
}
function isLabelledOrder(order:FulfillmentOrder){return hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function isPendingOrder(order:FulfillmentOrder){return !hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);}
function canPrepareOrder(order:FulfillmentOrder){return isPendingOrder(order);}
function orderState(order:FulfillmentOrder){
  if(isCancelledOrder(order))return {label:'Cancelado',className:'cancelled'};
  if(isLabelledOrder(order))return {label:'Etiquetado',className:'ready'};
  if(isProcessedOrder(order))return {label:'Enviado',className:'closed'};
  return {label:'Pendiente',className:'pending'};
}
function trackingState(order:FulfillmentOrder){
  if(!hasShippingLabel(order))return {label:'Sin etiqueta',className:'none'};
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  if(raw.includes('delivered')||raw.includes('shipment collected by customer'))return {label:'Entregado',className:'delivered'};
  if(raw.includes('driver en route')||raw.includes('out for delivery'))return {label:'En reparto',className:'route'};
  if(raw.includes('awaiting customer pickup'))return {label:'En punto de recogida',className:'pickup'};
  if(raw.includes('sorting centre')||raw.includes('sorting center')||raw.includes('being sorted')||raw.includes(' sorted'))return {label:'En centro de distribución',className:'transit'};
  if(raw.includes('parcel en route')||raw.includes('en route to sorting')||raw.includes('picked up by driver')||raw.includes('shipment picked up')||raw.includes('in transit'))return {label:'En tránsito',className:'transit'};
  if(raw.includes('address invalid')||raw.includes('attempt failed')||raw.includes('announcement failed')||raw.includes('unable to deliver')||raw.includes('exception')||raw.includes('error collecting')||raw.includes('refused')||raw.includes('returned to sender')||raw.includes('delivery delayed'))return {label:'Incidencia',className:'issue'};
  if(raw.includes('cancel'))return {label:'Cancelado',className:'cancelled'};
  if(raw.includes('created')||raw.includes('ready to send')||raw.includes('ready for shipment')||raw.includes('announced')||raw.includes('being announced')||raw.includes('no label'))return {label:'Preparado',className:'ready'};
  if(order.trackingStatusMessage)return {label:order.trackingStatusMessage,className:'none'};
  return {label:'Pendiente de seguimiento',className:'none'};
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
  if(tracking.className==='ready')return 'ready';
  if(tracking.className==='transit')return 'transit';
  return 'none';
}
function matchesOrderContext(order:FulfillmentOrder,query:string,channel:'all'|OrderChannel,trackingFilter:TrackingFilter,countryFilter:string,carrierFilter:string){
  if(channel!=='all'&&order.sourceChannel!==channel)return false;
  if(trackingFilter!=='all'&&trackingFilterCode(order)!==trackingFilter)return false;
  const country=text(order.shippingAddress.country_code).trim().toUpperCase()||'XX';
  if(countryFilter!=='all'&&country!==countryFilter)return false;
  const carrier=carrierLabel(order).trim().toLowerCase();
  if(carrierFilter!=='all'&&carrier!==carrierFilter)return false;
  const q=query.trim().toLowerCase();
  const haystack=[order.orderNumber||'',order.orderId||'',order.customerName||'',order.trackingNumber||'',order.trackingStatusMessage||'',carrierLabel(order),productsText(order),country].join(' ').toLowerCase();
  return !q||haystack.includes(q);
}
function countryFlag(code:unknown){
  const value=text(code).trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(value))return '';
  return String.fromCodePoint(...[...value].map(char=>127397+char.charCodeAt(0)));
}
function customerWithCountry(order:FulfillmentOrder,fallback='—'){
  const name=order.customerName||text(order.shippingAddress.name)||fallback;
  const flag=countryFlag(order.shippingAddress.country_code);
  return <span className="ordersCustomerCountry">{flag&&<span className="ordersCountryFlag" aria-label={text(order.shippingAddress.country_code)}>{flag}</span>}<span>{name}</span></span>;
}
function carrierLabel(order:FulfillmentOrder){
  if(order.carrierName)return order.carrierName;
  const raw=(order.carrierCode||order.shippingOptionCode?.split(':')[0]||'').toLowerCase();
  if(raw.includes('correos'))return 'Correos'; if(raw.includes('mrw'))return 'MRW';
  return raw?raw.toUpperCase():'—';
}

const VAT_RATES:Record<string,number>={ES:21,PT:23,FR:20,DE:19,IT:22,NL:21,BE:21,AT:20,IE:23,PL:23,CZ:21,GR:24,HU:27,RO:21,FI:25.5,SE:25,DK:25,HR:25,SI:22,SK:23,LT:21,LV:21,EE:24,BG:20,CY:19,MT:18,LU:17,GB:20};
function taxParts(order:FulfillmentOrder){
  const gross=order.totalAmount||0,rate=VAT_RATES[text(order.shippingAddress.country_code).trim().toUpperCase()]||0;
  if(!rate)return {gross,net:gross,vat:0}; const net=gross/(1+rate/100); return {gross,net,vat:gross-net};
}
function preferredCarrier(option:ShippingOption){const h=`${option.carrierCode} ${option.carrierName} ${option.name} ${option.code}`.toLowerCase();if(h.includes('mrw'))return 'mrw';if(h.includes('correos'))return 'correos';return '';}

function OrderDrawer({order,shippingPrice,validationIssues,productImages,onClose,onPrepare,onEdit,onPrint,onDownload,busy}:{order:FulfillmentOrder;shippingPrice:ShippingPricePreview|null;validationIssues:OrderValidationIssue[];productImages:Record<string,string>;onClose:()=>void;onPrepare:()=>void;onEdit:()=>void;onPrint:()=>void;onDownload:()=>void;busy:boolean}){
  const {settings}=useSettings();
  const labelled=hasShippingLabel(order),state=orderState(order),tracking=trackingState(order),canPrepare=canPrepareOrder(order);
  return <div className="ordersDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="ordersDrawer">
    <div className="ordersDrawerHead"><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><h2>Pedido {order.orderNumber||order.orderId||order.sendcloudId}</h2><p>{dateLabel(order.orderCreatedAt,settings.general)} · {order.integrationName||'Sendcloud'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
    <div className="ordersDrawerKpis"><div><span>Estado</span><strong>{state.label}</strong></div><div><span>Total</span><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></div><div><span>Peso</span><strong>{weightLabel(order,settings.shipping.weightUnit)}</strong></div><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div><div><span>Envío</span><strong>{shippingPrice?money(shippingPrice.totalAmount,shippingPrice.currency):'—'}</strong></div></div>
    {validationIssues.length>0&&<section className="ordersDrawerSection"><div className="errorBox ordersValidationBox"><AlertCircle size={17}/><div><strong>Revisar antes de generar la etiqueta</strong>{validationIssues.map((issue,index)=><span key={`${issue.field}-${index}`}>{issue.message}</span>)}</div></div></section>}
    <section className="ordersDrawerSection"><h3>Entrega</h3><div className="ordersAddress"><MapPin size={17}/><div><strong>{customerWithCountry(order,'Cliente')}</strong>{text(order.shippingAddress.company_name)&&<small>{text(order.shippingAddress.company_name)}</small>}<span>{addressLine(order.shippingAddress)}</span>{order.customerPhone&&<small>{order.customerPhone}</small>}{order.customerEmail&&<small>{order.customerEmail}</small>}</div></div></section>
    <section className="ordersDrawerSection"><div className="ordersSectionHead"><h3>Contenido</h3><span>{order.items.length} línea{order.items.length===1?'':'s'}</span></div>{order.items.length?<div className="ordersItems">{order.items.map((item,index)=>{const image=itemImageUrl(item,productImages);return <div key={`${itemLabel(item)}-${index}`}><div className="ordersItemMain">{image?<img className="ordersDrawerProductThumb" src={image} alt="" loading="lazy" referrerPolicy="no-referrer"/>:order.sourceChannel==='amazon'?<span className="ordersDrawerProductThumb ordersProductThumbPlaceholder"><ImageOff size={17}/></span>:null}<div className="ordersItemText"><strong>{itemLabel(item)}</strong><span>{text(item.sku)||text(item.product_id)||''}</span></div></div><b>x{itemQty(item)}</b></div>})}</div>:<div className="masterEmptyMini">Sin líneas de producto.</div>}</section>
    {shippingPrice&&<section className="ordersDrawerSection"><h3>Coste de envío</h3><div className="ordersShipmentInfo"><div><span>Total</span><strong>{money(shippingPrice.totalAmount,shippingPrice.currency)}</strong></div><div><span>Base</span><strong>{shippingPrice.netAmount==null?'—':money(shippingPrice.netAmount,shippingPrice.currency)}</strong></div><div><span>IVA</span><strong>{shippingPrice.taxAmount==null?'—':money(shippingPrice.taxAmount,shippingPrice.currency)}</strong></div><div><span>Origen</span><strong>{shippingPrice.source==='recorded'?'Coste seleccionado':shippingPrice.source==='tariff_estimate'?'Tarifa estimada':shippingPrice.note||'Cotización logística'}</strong></div>{shippingPrice.note&&<div><span>Nota</span><strong>{shippingPrice.note}</strong></div>}</div></section>}
    {(labelled||isProcessedOrder(order))&&<section className="ordersDrawerSection"><h3>Expedición</h3>{tracking.className==='issue'&&(()=>{const detail=trackingDetail(order);return <div className="ordersTrackingIssueDetail"><AlertCircle size={17}/><div><strong>Detalle de la incidencia</strong><span>{detail.title}</span>{detail.raw&&<small>{detail.raw}</small>}{detail.code&&<small>Código: {detail.code}</small>}</div></div>})()}<div className="ordersShipmentInfo"><div><span>Transportista</span><strong>{carrierLabel(order)}</strong></div><div><span>Servicio</span><strong>{order.shippingServiceName||order.shippingOptionCode||'—'}</strong></div><div><span>Fecha pedido</span><strong>{dateLabel(order.orderCreatedAt,settings.general)}</strong></div><div><span>Fecha etiqueta</span><strong>{dateLabel(labelTimestamp(order),settings.general)}</strong></div><div><span>Seguimiento</span><strong><span className={`ordersTracking ${tracking.className}`} title={order.trackingStatusMessage||tracking.label} aria-label={order.trackingStatusMessage||tracking.label}>{tracking.label}</span></strong></div>{order.trackingUpdatedAt&&<div><span>Última actualización</span><strong>{dateLabel(order.trackingUpdatedAt,settings.general)}</strong></div>}<div><span>Tracking</span><strong>{order.trackingNumber||'—'}</strong></div><div><span>Impresión</span><strong>{order.labelPrintedAt?`Impreso · ${order.labelPrintCount||1} vez${(order.labelPrintCount||1)===1?'':'es'}`:order.labelPrintStateKnown?'No impreso':'Sin información histórica'}</strong></div>{order.trackingUrl&&<a href={order.trackingUrl} target="_blank" rel="noreferrer">Abrir seguimiento <ExternalLink size={14}/></a>}</div></section>}
    <div className="ordersDrawerActions">{labelled?<><button className="secondary" disabled={busy} onClick={onDownload}><Download size={16}/> Descargar</button><button className="primary" disabled={busy} onClick={onPrint}><Printer size={16}/> Imprimir</button></>:canPrepare?<><button className="secondary" disabled={busy} onClick={onEdit}><Pencil size={16}/> Editar pedido</button><button className="primary" disabled={busy} onClick={onPrepare}>{busy?<><LoaderCircle className="spin" size={16}/> Preparando…</>:<><Truck size={16}/> Preparar etiqueta</>}</button></>:<div className={`ordersNoAction ${state.className}`}><AlertCircle size={16}/><span>{isCancelledOrder(order)?'Pedido cancelado. No se puede generar etiqueta.':'Este pedido ya está procesado.'}</span></div>}</div>
  </aside></div>;
}

function shippingOptionKey(option:ShippingOption|null|undefined){
  if(!option)return '';
  return [option.provider,option.integrationAccountId||'',option.carrierCode||'',option.code||'',option.contractId??''].join('|');
}

function LabelModal({order,options,tariffs,message,loading,preferredOption,onClose,onCreate}:{order:FulfillmentOrder;options:ShippingOption[];tariffs:TransportTariffDocument[];message:string;loading:boolean;preferredOption:ShippingOption|null;onClose:()=>void;onCreate:(option:ShippingOption|null)=>void}){
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
    if(preferredKey&&available.has(preferredKey)){setSelectedKey(preferredKey);return}
    setSelectedKey(current=>available.has(current)?current:shippingOptionKey(firstUsable));
  },[order.id,preferredKey,options.length]);

  const selected=options.find(option=>shippingOptionKey(option)===selectedKey)||null;
  const comparison=options.map(option=>({option,tariff:estimateTransportTariffForOption(order,tariffs,option)}));
  const selectOption=(option:ShippingOption)=>setSelectedKey(shippingOptionKey(option));

  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersLabelModal">
    <div className="modalHead"><div><h3>Crear etiqueta · {order.orderNumber||order.orderId}</h3><p>Compara los servicios disponibles de tus proveedores logísticos, selecciona uno y confirma la creación de la etiqueta.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersLabelBody">
      <div className="ordersLabelContext"><div><span>Peso del paquete</span><strong>{weightLabel(order,settings.shipping.weightUnit)}</strong></div><div><span>Destino</span><strong>{text(order.shippingAddress.postal_code)||'—'} · {text(order.shippingAddress.city)||text(order.shippingAddress.country_code)||'—'}</strong></div></div>
      {loading?<div className="ordersOptionsLoading"><LoaderCircle className="spin"/><span>Consultando proveedores, servicios y precios…</span></div>:<>
        {message&&<div className="ordersQuoteMessage"><AlertCircle size={15}/><span>{message}</span></div>}
        {options.length>0&&<section className="ordersComparison">
          <div className="ordersComparisonHead"><div><strong>Opciones de envío</strong><span>Ordenadas por precio final para que puedas elegir directamente la opción más conveniente.</span></div><small>{priced.length?priced.length+' opciones con precio':'Sin precios disponibles'}</small></div>
          {priced.length>0&&<div className="ordersBestOptions">
            <div className="ordersBestOptionsTitle"><strong>Mejores opciones</strong><span>Las {settings.shipping.topOptionsCount} tarifas más económicas disponibles ahora mismo.</span></div>
            <div className="ordersBestOptionsGrid">{priced.slice(0,settings.shipping.topOptionsCount).map((option,index)=>{
              const isSelected=shippingOptionKey(option)===selectedKey;
              const tariff=estimateTransportTariffForOption(order,tariffs,option);
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
                <div className="ordersCarrierGroupHead"><strong>{group.name}</strong><small>{group.options.length} servicio{group.options.length===1?'':'s'}</small></div>
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
      </>}
    </div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={loading||!selected} onClick={()=>selected&&onCreate(selected)}>{selected?'Crear etiqueta':'Selecciona un servicio'}</button></div>
  </section></div>;
}
function ManualOrderModal({status,saving,defaultCountryCode,fallbackWeightKg,weightUnit,onClose,onSave}:{status:SendcloudStatus;saving:boolean;defaultCountryCode:string;fallbackWeightKg:number;weightUnit:ShippingSettings['weightUnit'];onClose:()=>void;onSave:(value:any)=>void}){
  const apiIntegrations=status.integrations.filter(item=>item.channel==='other');
  const suggested=apiIntegrations.find(item=>item.isApi)||apiIntegrations[0];
  const integrationKey=(item:(typeof apiIntegrations)[number])=>`${item.sendcloudAccountId||'legacy'}::${item.id}`;
  const [selectedIntegrationKey,setSelectedIntegrationKey]=useState(suggested?integrationKey(suggested):'');
  const selectedIntegration=apiIntegrations.find(item=>integrationKey(item)===selectedIntegrationKey)||null;
  const [orderNumber,setOrderNumber]=useState(`MAN-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(Date.now()).slice(-5)}`);
  const [customerName,setCustomerName]=useState(''); const [companyName,setCompanyName]=useState(''); const [email,setEmail]=useState(''); const [phone,setPhone]=useState('');
  const [address,setAddress]=useState(''); const [houseNumber,setHouseNumber]=useState(''); const [postalCode,setPostalCode]=useState(''); const [city,setCity]=useState(''); const [countryCode,setCountryCode]=useState(defaultCountryCode||'ES');
  const [weightValue,setWeightValue]=useState(weightUnit==='g'?(fallbackWeightKg||1)*1000:(fallbackWeightKg||1)); const [items,setItems]=useState<ManualOrderItem[]>([{name:'',sku:'',quantity:1,unitPrice:0}]);
  const updateItem=(index:number,key:keyof ManualOrderItem,value:string|number)=>setItems(prev=>prev.map((item,i)=>i===index?{...item,[key]:value}:item));
  return <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal ordersManualModal">
    <div className="modalHead"><div><h3>Nuevo pedido manual</h3><p>Se creará también en Sendcloud para que puedas generar la etiqueta desde aquí.</p></div><button onClick={onClose}><X size={18}/></button></div>
    <div className="ordersManualBody">
      {!apiIntegrations.length&&<div className="errorBox"><AlertCircle size={16}/> No encuentro una integración API de Sendcloud. La integración de Amazon/Shopify no debe usarse para pedidos manuales.</div>}
      <div className="ordersManualGrid"><label><span>N.º pedido</span><input value={orderNumber} onChange={e=>setOrderNumber(e.target.value)}/></label><label><span>Integración Sendcloud</span><SearchableSelect value={selectedIntegrationKey} options={apiIntegrations.map(item=>({value:integrationKey(item),label:`${item.sendcloudAccountName?item.sendcloudAccountName+' · ':''}${item.shopName} · ${item.type||'API'}`,searchText:`${item.sendcloudAccountName||''} ${item.shopName} ${item.type||''}`}))} onChange={setSelectedIntegrationKey} allowEmpty emptyLabel="Seleccionar…" searchPlaceholder="Buscar cuenta o integración…" ariaLabel="Integración Sendcloud"/></label><label><span>Cliente *</span><input value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label><label><span>Nombre de la empresa (opcional)</span><input value={companyName} onChange={e=>setCompanyName(e.target.value)}/></label><label><span>Teléfono</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className="wide"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="wide"><span>Dirección *</span><input value={address} onChange={e=>setAddress(e.target.value)}/></label><label><span>Número</span><input value={houseNumber} onChange={e=>setHouseNumber(e.target.value)}/></label><label><span>Código postal *</span><input value={postalCode} onChange={e=>setPostalCode(e.target.value)}/></label><label><span>Ciudad *</span><input value={city} onChange={e=>setCity(e.target.value)}/></label><label><span>País *</span><input maxLength={2} value={countryCode} onChange={e=>setCountryCode(e.target.value.toUpperCase())}/></label><label><span>Peso total ({weightUnit})</span><input type="number" min={weightUnit==='g'?'1':'0.01'} step={weightUnit==='g'?'1':'0.01'} value={weightValue} onChange={e=>setWeightValue(Number(e.target.value)||0)}/></label></div>
      <div className="ordersManualItems"><div className="ordersSectionHead"><h3>Productos</h3><button className="link" onClick={()=>setItems(prev=>[...prev,{name:'',sku:'',quantity:1,unitPrice:0}])}><Plus size={14}/> Añadir línea</button></div>{items.map((item,index)=><div className="ordersManualItem" key={index}><input placeholder="Producto" value={item.name} onChange={e=>updateItem(index,'name',e.target.value)}/><input placeholder="SKU" value={item.sku||''} onChange={e=>updateItem(index,'sku',e.target.value)}/><input type="number" min="1" placeholder="Uds" value={item.quantity} onChange={e=>updateItem(index,'quantity',Math.max(1,Number(e.target.value)||1))}/><input type="number" min="0" step="0.01" placeholder="€/ud" value={item.unitPrice} onChange={e=>updateItem(index,'unitPrice',Math.max(0,Number(e.target.value)||0))}/><button className="iconBtn dangerText" disabled={items.length===1} onClick={()=>setItems(prev=>prev.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>)}</div>
    </div>
    <div className="modalActions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving||!apiIntegrations.length||!selectedIntegration} onClick={()=>onSave({integrationId:selectedIntegration?.id||0,shippingIntegrationAccountId:selectedIntegration?.sendcloudAccountId||null,orderNumber,customerName,companyName,email,phone,address,houseNumber,postalCode,city,countryCode,weightKg:weightUnit==='g'?weightValue/1000:weightValue,items})}>{saving?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear pedido</button></div>
  </section></div>;
}

export function Orders({pendingOnly=false}:{pendingOnly?:boolean}={}){
  const {settings,preferences,patchPreferences,updateSection}=useSettings();
  const remembered=rememberedFilter<{
    query:string;state:OrderFilter;trackingFilter:TrackingFilter;countryFilter:string;carrierFilter:string;dateFilter:ReturnType<typeof defaultDateFilter>;
  }>(preferences,'orders.filters',{query:'',state:'pending',trackingFilter:'all',countryFilter:'all',carrierFilter:'all',dateFilter:defaultDateFilter(preferences.defaultPeriod)});
  const [orders,setOrders]=useState<FulfillmentOrder[]>([]),[status,setStatus]=useState<SendcloudStatus|null>(null),[enviaStatus,setEnviaStatus]=useState<{configured:boolean;accounts:Array<{id:string;displayName:string;environment:string;isDefault:boolean}>}|null>(null);
  const [loading,setLoading]=useState(true),[syncing,setSyncing]=useState(false),[error,setError]=useState('');
  const syncingRef=useRef(false);
  const [query,setQuery]=useState(pendingOnly?'':remembered.query),[channel,setChannel]=useState<'all'|OrderChannel>('all'),[state,setState]=useState<OrderFilter>(pendingOnly?'pending':remembered.state),[trackingFilter,setTrackingFilter]=useState<TrackingFilter>(pendingOnly?'all':remembered.trackingFilter),[countryFilter,setCountryFilter]=useState(pendingOnly?'all':remembered.countryFilter),[carrierFilter,setCarrierFilter]=useState(pendingOnly?'all':remembered.carrierFilter);
  const [selected,setSelected]=useState<FulfillmentOrder|null>(null),[labelOrder,setLabelOrder]=useState<FulfillmentOrder|null>(null),[options,setOptions]=useState<ShippingOption[]>([]),[optionsMessage,setOptionsMessage]=useState(''),[optionsLoading,setOptionsLoading]=useState(false),[preparingOrder,setPreparingOrder]=useState<string|null>(null),[busyOrder,setBusyOrder]=useState<string|null>(null);
  const [printers,setPrinters]=useState<LocalPrinter[]>([]),[printer,setPrinter]=useState(preferences.labelPrinterId||''),[printerChecking,setPrinterChecking]=useState(false);
  const [dateFilter,setDateFilter]=useState(remembered.dateFilter);
  const [manualOpen,setManualOpen]=useState(false),[manualSaving,setManualSaving]=useState(false);
  const [editOrder,setEditOrder]=useState<FulfillmentOrder|null>(null),[editSaving,setEditSaving]=useState(false);
  const [bulkGenerating,setBulkGenerating]=useState(false),[bulkProgress,setBulkProgress]=useState('');
  const [bulkPreview,setBulkPreview]=useState<null|{
    targets:FulfillmentOrder[];
    scope:'pendientes'|'seleccionadas';
    loading:boolean;
    optionsByOrder:Record<string,ShippingOption[]>;
    summaries:Array<{key:string;provider:string;providerName:string;carrierCode:string;carrierName:string;covered:number;priced:number;total:number}>;
    selectedKey:string;
  }>(null);
  const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
  const [tariffs,setTariffs]=useState<TransportTariffDocument[]>([]),[shippingPreviews,setShippingPreviews]=useState<Record<string,ShippingPricePreview>>({});
  const [editValidationIssues,setEditValidationIssues]=useState<OrderValidationIssue[]>([]);
  const [amazonImages,setAmazonImages]=useState<Record<string,string>>({});
  useEffect(()=>{setPrinter(preferences.labelPrinterId||'')},[preferences.labelPrinterId]);
  useEffect(()=>{
    const value={query,state,trackingFilter,countryFilter,carrierFilter,dateFilter};
    const timer=window.setTimeout(()=>{void persistRememberedFilter(preferences,patchPreferences,'orders.filters',value)},350);
    return()=>window.clearTimeout(timer);
  },[query,state,trackingFilter,countryFilter,carrierFilter,dateFilter,preferences.rememberFilters]);
  const [shippingRules,setShippingRules]=useState<ShippingRule[]>(()=>defaultShippingRules());

  const refresh=useCallback(async()=>{try{setOrders(await listFulfillmentOrders())}catch(e){setError(errorMessage(e,'No se pudieron cargar los pedidos.'))}},[]);
  const refreshStatus=useCallback(async()=>{try{setStatus(await getSendcloudStatus())}catch(e){setStatus({configured:false,integrations:[],message:errorMessage(e,'No se pudo comprobar Sendcloud.')})}},[]);
  const refreshEnviaStatus=useCallback(async()=>{try{const result=await getEnviaStatus();setEnviaStatus({configured:result.configured,accounts:result.accounts||[]})}catch{setEnviaStatus({configured:false,accounts:[]})}},[]);
  const refreshTariffs=useCallback(async()=>{try{setTariffs(await listTransportTariffs())}catch{/* El precio real seleccionado seguirá disponible aunque no haya tarifa estimada. */}},[]);
  useEffect(()=>{
    const onAgentRefresh=()=>{void Promise.all([refresh(),refreshStatus(),refreshEnviaStatus(),refreshTariffs()]);};
    window.addEventListener('zenvia:orders-refresh',onAgentRefresh);
    return()=>window.removeEventListener('zenvia:orders-refresh',onAgentRefresh);
  },[refresh,refreshStatus,refreshEnviaStatus,refreshTariffs]);
  useEffect(()=>{(async()=>{setLoading(true);await Promise.all([refresh(),refreshStatus(),refreshEnviaStatus(),refreshTariffs()]);setLoading(false)})()},[refresh,refreshStatus,refreshEnviaStatus,refreshTariffs]);
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

  const sync=useCallback(async(silent=false,history=false,automatic=false,enviaHistory=shouldRunEnviaHistorySync())=>{
    if(syncingRef.current)return;
    const runSendcloud=Boolean(settings.integrations.sendcloudEnabled&&status?.configured);
    const runEnvia=Boolean(settings.integrations.enviaEnabled&&enviaStatus?.configured);
    if(!runSendcloud&&!runEnvia){
      await Promise.all([refresh(),settings.orders.retryTrackingConfirmation?retryAmazonTrackingConfirmations():Promise.resolve()]);
      if(!silent)showSuccess('Pedidos actualizados. Amazon y los transportistas directos no dependen de Sendcloud para refrescar esta vista.');
      return;
    }
    syncingRef.current=true;setSyncing(true);if(!silent)setError('');
    try{
      const [sendcloudResult,enviaResult]=await Promise.allSettled([
        runSendcloud?syncSendcloudOrders(history,settings.orders.retryTrackingConfirmation,automatic):Promise.resolve(null),
        runEnvia?syncEnviaShipments(enviaHistory?12:2):Promise.resolve(null),
      ]);
      const messages:string[]=[],failures:string[]=[];
      if(sendcloudResult.status==='fulfilled'&&sendcloudResult.value){
        setStatus({configured:true,integrations:sendcloudResult.value.integrations});
        messages.push('Sendcloud '+sendcloudResult.value.synced);
        if(history)markHistorySyncDone();
      }else if(sendcloudResult.status==='rejected')failures.push('Sendcloud: '+errorMessage(sendcloudResult.reason,'error de sincronización'));
      if(enviaResult.status==='fulfilled'&&enviaResult.value){
        messages.push('Envia.com '+enviaResult.value.synced);
        if(enviaHistory)markEnviaHistorySyncDone();
      }else if(enviaResult.status==='rejected')failures.push('Envia.com: '+errorMessage(enviaResult.reason,'error de sincronización'));
      await refresh();
      if(!silent){
        if(messages.length)showSuccess('Pedidos actualizados · '+messages.join(' · ')+'.');
        if(failures.length)showInfo(failures.join(' · '));
      }
    }finally{syncingRef.current=false;setSyncing(false)}
  },[refresh,settings.integrations.sendcloudEnabled,settings.integrations.enviaEnabled,settings.orders.retryTrackingConfirmation,status?.configured,enviaStatus?.configured]);
  useEffect(()=>{
    const enabled=Boolean((settings.integrations.sendcloudEnabled&&status?.configured)||(settings.integrations.enviaEnabled&&enviaStatus?.configured));
    const tick=()=>enabled
      ?sync(true,false,true)
      :Promise.all([refresh(),settings.orders.retryTrackingConfirmation?retryAmazonTrackingConfirmations():Promise.resolve()]);
    if(enabled)void sync(true,shouldRunHistorySync(),true,shouldRunEnviaHistorySync());
    else void tick();
    const timer=window.setInterval(()=>void tick(),Math.max(30,settings.orders.refreshSeconds)*1000);
    return()=>window.clearInterval(timer);
  },[status?.configured,enviaStatus?.configured,sync,refresh,settings.orders.refreshSeconds,settings.orders.retryTrackingConfirmation,settings.integrations.sendcloudEnabled,settings.integrations.enviaEnabled]);

  const dateFrom=dateFilter.from,dateTo=dateFilter.to;
  const selectedPeriod=periodLabel(dateFilter);
  const orderPeriodOrders=useMemo(()=>orders.filter(order=>inPeriod(orderDateKey(order),dateFrom,dateTo)),[orders,dateFrom,dateTo]);
  const shippedPeriodOrders=useMemo(()=>orders.filter(order=>isProcessedOrder(order)&&inPeriod(shippedDateKey(order),dateFrom,dateTo)),[orders,dateFrom,dateTo]);
  const countryOptions=useMemo(()=>[...new Set(orders.map(order=>text(order.shippingAddress.country_code).trim().toUpperCase()||'XX'))].sort((a,b)=>countryName(a).localeCompare(countryName(b),'es')).map(code=>({value:code,label:code==='XX'?'País pendiente':`${countryName(code)} · ${code}`})),[orders]);
  const carrierOptions=useMemo(()=>[...new Set(orders.map(order=>carrierLabel(order)).filter(value=>value&&value!=='—'))].sort((a,b)=>a.localeCompare(b,'es')).map(value=>({value:value.toLowerCase(),label:value})),[orders]);
  const orderContextOrders=useMemo(()=>orderPeriodOrders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[orderPeriodOrders,query,channel,trackingFilter,countryFilter,carrierFilter]);
  const operationalContextOrders=useMemo(()=>orders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[orders,query,channel,trackingFilter,countryFilter,carrierFilter]);
  const labelContextOrders=useMemo(()=>operationalContextOrders.filter(isLabelledOrder),[operationalContextOrders]);
  const shippedContextOrders=useMemo(()=>shippedPeriodOrders.filter(order=>matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter)),[shippedPeriodOrders,query,channel,trackingFilter,countryFilter,carrierFilter]);
  const pendingOrders=useMemo(()=>operationalContextOrders.filter(isPendingOrder),[operationalContextOrders]);
  const tariffPreviews=useMemo(()=>{const map:Record<string,ShippingPricePreview>={};for(const order of orders){const configuredCarrier=firstMatchingShippingRule(order,shippingRules)?.action.carrierContains||settings.orders.defaultCarrier||'';const preview=calculateDefaultShippingPreview(order,tariffs,configuredCarrier);if(preview)map[order.id]=preview}return map},[orders,tariffs,shippingRules,settings.orders.defaultCarrier]);
  const transportKpis=useMemo(()=>{
    let total=0,net=0,tax=0,valued=0,missing=0,mrw=0,correos=0,other=0;
    const shipments=orders.filter(order=>hasShippingLabel(order)&&inPeriod(timestampDateKey(order.shippingCostRecordedAt||order.fulfilledAt||order.labelCreatedAt||order.trackingUpdatedAt||order.orderCreatedAt),dateFrom,dateTo)&&matchesOrderContext(order,query,channel,trackingFilter,countryFilter,carrierFilter));
    for(const order of shipments){
      const shipping=shippingPriceForOrder(order,tariffPreviews[order.id]||shippingPreviews[order.id]);
      if(!shipping||shipping.totalAmount==null||!Number.isFinite(shipping.totalAmount)||shipping.currency.toUpperCase()!=='EUR'){missing+=1;continue}
      total+=shipping.totalAmount;net+=shipping.netAmount??shipping.totalAmount;tax+=shipping.taxAmount??0;valued+=1;
      const carrier=carrierLabel(order).toLowerCase();
      if(carrier.includes('mrw'))mrw+=shipping.totalAmount;else if(carrier.includes('correos'))correos+=shipping.totalAmount;else other+=shipping.totalAmount;
    }
    return {total,net,tax,valued,missing,mrw,correos,other,shipments:shipments.length};
  },[orders,dateFrom,dateTo,query,channel,trackingFilter,countryFilter,carrierFilter,tariffPreviews,shippingPreviews]);
  useEffect(()=>{let cancelled=false;const targets=orders.filter(order=>isPendingOrder(order)&&!order.shippingCostAmount);if(!targets.length)return;void(async()=>{const next:Record<string,ShippingPricePreview>={};const enabled=settings.shipping.enabledCarriers.map(value=>value.toLowerCase()).filter(Boolean);for(const order of targets.slice(0,30)){try{const result=await getShippingOptions(order.id);const allowed=enabled.length?result.options.filter(option=>enabled.some(value=>`${option.carrierCode||''} ${option.carrierName||''}`.toLowerCase().includes(value))):result.options;let option=selectShippingOptionByRules(order,allowed,shippingRules);if(!option&&settings.orders.defaultCarrier){const carrier=settings.orders.defaultCarrier.toLowerCase();option=allowed.find(item=>`${item.carrierCode||''} ${item.carrierName||''}`.toLowerCase().includes(carrier))||null}const preview=previewFromShippingOption(option);if(preview)next[order.id]=preview}catch{/* La cotización se mostrará cuando el usuario prepare la etiqueta. */}}if(!cancelled&&Object.keys(next).length)setShippingPreviews(current=>({...current,...next}))})();return()=>{cancelled=true}},[orders,shippingRules,settings.shipping.enabledCarriers,settings.orders.defaultCarrier]);
  const salesKpis=useMemo(()=>{const sales=orderContextOrders.filter(order=>!isCancelledOrder(order)&&order.totalAmount!=null&&(order.currency==null||order.currency==='EUR'));let gross=0,net=0,vat=0;for(const order of sales){const parts=taxParts(order);gross+=parts.gross;net+=parts.net;vat+=parts.vat}return {gross,net,vat,count:sales.length,average:sales.length?gross/sales.length:0}},[orderContextOrders]);
  const overduePending=pendingOrders.filter(order=>orderAgeHours(order)>=settings.orders.overdueHours).length;
  const pending=pendingOrders.length,amazon=pendingOrders.filter(o=>o.sourceChannel==='amazon').length,shopify=pendingOrders.filter(o=>o.sourceChannel==='shopify').length,manual=pendingOrders.filter(o=>o.sourceChannel==='other').length,labelled=labelContextOrders.length,shipped=shippedContextOrders.length,cancelled=orderContextOrders.filter(isCancelledOrder).length;
  const filtered=useMemo(()=>{const base=state==='pending'?pendingOrders:state==='labelled'?labelContextOrders:state==='shipped'?shippedContextOrders:orderContextOrders;return base.filter(order=>{if(state==='pending'&&!isPendingOrder(order))return false;if(state==='labelled'&&!isLabelledOrder(order))return false;if(state==='shipped'&&!isProcessedOrder(order))return false;if(state==='cancelled'&&!isCancelledOrder(order))return false;return true})},[orderContextOrders,pendingOrders,labelContextOrders,shippedContextOrders,state]);
  const sorting=useSortableTable('orders',filtered,{
    channel:order=>channelLabel(order),
    order:order=>order.orderNumber||order.orderId||order.sendcloudId||'',
    customer:order=>order.customerName||text(order.shippingAddress.name)||'',
    products:order=>productsText(order),
    destination:order=>`${text(order.shippingAddress.country_code)} ${text(order.shippingAddress.postal_code)}`,
    carrier:order=>carrierLabel(order),
    shipping:order=>shippingPriceForOrder(order,shippingPreviews[order.id]||tariffPreviews[order.id])?.totalAmount??null,
    weight:order=>order.weightKg??null,
    units:order=>order.items.reduce((sum,item)=>sum+itemQty(item),0),
    total:order=>order.totalAmount??null,
    state:order=>orderState(order).label,
    tracking:order=>trackingState(order).label,
    orderDate:order=>order.orderCreatedAt||'',
    labelDate:order=>labelTimestamp(order)||'',
    printStatus:order=>labelPrintState(order).sort,
  },{key:'orderDate',direction:'desc'});
  const sortedOrders=sorting.rows;
  const selectableOrders=filtered.filter(canPrepareOrder);
  const selectedOrders=selectableOrders.filter(order=>checkedIds.has(order.id));
  const allSelectableSelected=selectableOrders.length>0&&selectableOrders.every(order=>checkedIds.has(order.id));
  const toggleOrder=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
  const toggleAllOrders=(checked:boolean)=>setCheckedIds(checked?new Set(selectableOrders.map(order=>order.id)):new Set());
  useEffect(()=>{setCheckedIds(new Set())},[query,channel,state,trackingFilter,countryFilter,carrierFilter,dateFrom,dateTo]);

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
    const tariff=estimateTransportTariffForOption(order,tariffs,option);
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
    return selectShippingOptionByRules(order,allowed,shippingRules);
  };
  const validationCarrier=(order:FulfillmentOrder)=>firstMatchingShippingRule(order,shippingRules)?.action.carrierContains||settings.orders.defaultCarrier||'';

  const prepare=async(order:FulfillmentOrder)=>{
    if(preparingOrder||busyOrder)return;
    if(!canPrepareOrder(order)){showError('Este pedido ya no admite una nueva etiqueta.');return}
    setPreparingOrder(order.id);
    setOptions([]);setOptionsMessage('');setOptionsLoading(true);setLabelOrder(order);
    try{
      const result=await getShippingOptions(order.id);
      const allowed=applyTariffPrices(order,enabledShippingOptions(result.options));
      setOptionsMessage(result.message||'');
      if(!allowed.length){setLabelOrder(null);showError('No hay servicios disponibles entre los transportistas habilitados.');return}
      setOptions(allowed);
    }catch(e){
      setLabelOrder(null);
      showError(errorMessage(e,'No se pudieron consultar los servicios y precios.'));
    }finally{setOptionsLoading(false);setPreparingOrder(null)}
  };
  const handleBlob=async(blob:Blob,order:FulfillmentOrder,mode:'print'|'download')=>{
    const prepared=await prepareLabelPdf(blob,settings.shipping);
    if(mode==='download'){downloadLabel(prepared,labelPdfFilename(order,labelFilenameOptions));return}
    if(preferences.labelPrinterId){try{await printLabelWithClient(prepared,preferences.labelPrinterId,settings.shipping.labelSize);showSuccess('Etiqueta enviada a la impresora.');return}catch{/* PDF */}}
    openLabelForPrint(prepared);
  };
  const createLabel=async(option:ShippingOption|null,explicitOrder:FulfillmentOrder|null=labelOrder)=>{if(!explicitOrder)return;const order=explicitOrder;
    const finalValidation=validateOrderForCarrier(order,option?`${option.carrierCode||''} ${option.code||''} ${option.name||''}`:validationCarrier(order));
    if(finalValidation.blocking){
      setLabelOrder(null);setEditValidationIssues(finalValidation.issues);setEditOrder(order);
      showError('Hay datos de envío que el transportista rechazará. Corrígelos antes de generar la etiqueta.');
      return;
    }
    setBusyOrder(order.id);setLabelOrder(null);try{
    const result=await createOrderLabel(order.id,option,settings.orders.pushTrackingToMarketplace),blob=labelBlob(result);
    const freshOrders=await listFulfillmentOrders();const fresh=freshOrders.find(item=>item.id===order.id)||order;setOrders(freshOrders);setSelected(fresh);
    if(result.automation?.downloadPdf!==false&&settings.orders.downloadLabelAfterCreation&&settings.shipping.autoDownload){
      const prepared=await prepareLabelPdf(blob,settings.shipping);
      downloadLabel(prepared,labelPdfFilename(fresh,labelFilenameOptions));
    }
    showSuccess(`Etiqueta creada${result.trackingNumber?` · ${result.trackingNumber}`:''}.`);
  }catch(e){showError(errorMessage(e,'No se pudo crear la etiqueta.'))}finally{setBusyOrder(null)}};
  const existingLabel=async(order:FulfillmentOrder,mode:'print'|'download')=>{setBusyOrder(order.id);try{
    const result=await fetchOrderLabel(order.id);await handleBlob(labelBlob(result),order,mode);
    if(mode==='print'){
      await markOrderLabelPrinted(order.id);
      const freshOrders=await listFulfillmentOrders();setOrders(freshOrders);setSelected(freshOrders.find(item=>item.id===order.id)||order);
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
    const zip=new JSZip(),usedNames=new Set<string>(),failed:string[]=[];
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
          const carrierValidation=validateOrderForCarrier(order,`${option.carrierCode||''} ${option.code||''} ${option.name||''}`);
          if(carrierValidation.blocking)throw new Error(carrierValidation.issues[0]?.message||'El transportista rechazará los datos del pedido.');
          const result=await createOrderLabel(order.id,option,settings.orders.pushTrackingToMarketplace);
          const prepared=await prepareLabelPdf(labelBlob(result),settings.shipping);
          zip.file(uniqueLabelPdfFilename(order,usedNames,labelFilenameOptions),prepared);
          generated+=1;
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
      const freshOrders=await listFulfillmentOrders();setOrders(freshOrders);setCheckedIds(new Set());setSelected(current=>current?freshOrders.find(item=>item.id===current.id)||null:null);
      if(failed.length){const detail=failed.slice(0,3).join(' · ');showError(`${generated} etiquetas generadas. ${failed.length} no se pudieron generar${detail?`: ${detail}`:''}`)}
      else showSuccess(`${generated} etiquetas generadas y descargadas en un ZIP.`);
    }catch(e){showError(errorMessage(e,'Las etiquetas se generaron, pero no se pudo preparar el ZIP.'))}
    finally{setBulkGenerating(false);setBulkProgress('');activity.finish()}
  };
  const configuredBulkTargets=settings.orders.bulkScope==='selected'?selectedOrders:pendingOrders;
  const openBulkPreview=async(targets:FulfillmentOrder[],scope:'pendientes'|'seleccionadas')=>{
    if(!targets.length)return;
    if(bulkGenerating||bulkPreview?.loading)return;
    setBulkPreview({targets,scope,loading:true,optionsByOrder:{},summaries:[],selectedKey:''});
    const settled=await Promise.allSettled(targets.map(async order=>({orderId:order.id,result:await getShippingOptions(order.id)})));
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
  const generateConfiguredLabels=()=>openBulkPreview(configuredBulkTargets,settings.orders.bulkScope==='selected'?'seleccionadas':'pendientes');
  const generateSelectedLabels=()=>openBulkPreview(selectedOrders,'seleccionadas');
  const detectPrinters=async()=>{setPrinterChecking(true);try{const found=await listLocalPrinters();setPrinters(found);const chosen=preferences.labelPrinterId||found.find(item=>item.default)?.id||found[0]?.id||'';setPrinter(chosen);if(chosen)await patchPreferences({labelPrinterId:chosen});showSuccess(found.length?`${found.length} impresora${found.length===1?'':'s'} detectada${found.length===1?'':'s'} para impresión directa.`:'El agente de impresión está disponible, pero no ha devuelto ninguna impresora.')}catch{setPrinters([]);setPrinter('');await patchPreferences({labelPrinterId:null}).catch(()=>undefined);showInfo('La impresión directa requiere ZENVIA Print Agent instalado y abierto. Durante la transición también se admite el Print Client de Sendcloud. No afecta a la generación de etiquetas: puedes descargarlas e imprimirlas como PDF con normalidad.')}finally{setPrinterChecking(false)}};
  const changeLabelSize=async(value:ShippingSettings['labelSize'])=>{
    if(value===settings.shipping.labelSize)return;
    try{
      await updateSection('shipping',{...settings.shipping,labelSize:value});
      const label=value==='AUTO'?'Automático / original':value==='10x15'?'10 × 15 cm':value;
      showSuccess(`Formato de etiqueta: ${label}.`);
    }catch(e){showError(errorMessage(e,'No se pudo guardar el formato de etiqueta.'))}
  };
  const saveManual=async(value:any)=>{setManualSaving(true);try{const result=await createManualOrder(value);await refresh();setManualOpen(false);showSuccess(`Pedido ${result.orderNumber} creado en ZENVIA y Sendcloud.`)}catch(e){showError(errorMessage(e,'No se pudo crear el pedido manual.'))}finally{setManualSaving(false)}};
  const saveEdit=async(value:OrderUpdateInput)=>{if(!editOrder)return;setEditSaving(true);try{await updateFulfillmentOrder(editOrder.id,value);const freshOrders=await listFulfillmentOrders();setOrders(freshOrders);const fresh=freshOrders.find(item=>item.id===editOrder.id)||editOrder;setSelected(fresh);setEditValidationIssues([]);setEditOrder(null);showSuccess('Pedido actualizado en ZENVIA y Sendcloud.')}catch(e){showError(errorMessage(e,'No se pudo actualizar el pedido.'))}finally{setEditSaving(false)}};

  return <div className="page ordersPage">
    <div className="pageHead"><div><div className="eyebrow">LOGÍSTICA</div><h1>Pedidos</h1><p>Amazon, Shopify y pedidos manuales, etiquetas y seguimiento desde un único sitio.</p></div><div className="actions"><button className="secondary" onClick={detectPrinters} disabled={printerChecking} title="Opcional: usa ZENVIA Print Agent para imprimir directamente en una impresora instalada en este equipo. No es necesario para generar ni descargar etiquetas.">{printerChecking?<LoaderCircle className="spin" size={16}/>:<Printer size={16}/>} Impresión directa</button><label className="ordersQuickLabelFormat"><span>Formato</span><SelectField value={settings.shipping.labelSize} onChange={value=>void changeLabelSize(value as ShippingSettings['labelSize'])} ariaLabel="Formato rápido de etiqueta" options={[{value:'AUTO',label:'Original'},{value:'A6',label:'A6'},{value:'10x15',label:'10 × 15'},{value:'A5',label:'A5'},{value:'A4',label:'A4'}]}/></label><button className="secondary" onClick={()=>setManualOpen(true)} disabled={!status?.configured}><Plus size={16}/> Nuevo pedido</button><button className="secondary" onClick={()=>void generateConfiguredLabels()} disabled={bulkGenerating||configuredBulkTargets.length===0}>{bulkGenerating?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>} {bulkGenerating?`Generando ${bulkProgress}`:settings.orders.bulkScope==='selected'?`Generar etiquetas seleccionadas (${selectedOrders.length})`:`Generar etiquetas pendientes (${pending})`}</button><button className="primary" onClick={()=>sync(false,false)} disabled={syncing||bulkGenerating||!(status?.configured||enviaStatus?.configured)}>{syncing?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} Actualizar pedidos</button></div></div>
    {(status?.configured||enviaStatus?.configured)&&<section className="ordersConnection"><CheckCircle2 size={16}/><span>Logística conectada</span><small>{[status?.configured?'Sendcloud':null,enviaStatus?.configured?'Envia.com · '+(enviaStatus.accounts.map(account=>account.displayName).join(', ')||'conectado'):null].filter(Boolean).join(' · ')}</small></section>}
    {status&&!status.configured&&!enviaStatus?.configured&&<section className="card ordersSetup"><AlertCircle/><div><h3>Falta conectar un proveedor logístico</h3><p>Conecta Sendcloud o Envia.com para sincronizar envíos y generar etiquetas.</p></div></section>}{error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}

    <PeriodFilterPanel filter={dateFilter} onChange={setDateFilter} title="Periodo global" className="ordersPeriodPanel" note="Ventas, enviados, cancelados y costes respetan el periodo. Pendientes y etiquetados son colas operativas reales y no desaparecen al cambiar de mes o trimestre."/>

    <div className="stats ordersSalesStats"><div className="stat"><div className="statIcon"><Euro/></div><div><span>Total vendido</span><strong>{money(salesKpis.gross)}</strong><small>{salesKpis.count} pedidos · {selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Percent/></div><div><span>IVA estimado</span><strong>{money(salesKpis.vat)}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Calculator/></div><div><span>Neto sin IVA</span><strong>{money(salesKpis.net)}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Ticket medio</span><strong>{money(salesKpis.average)}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Truck/></div><div><span>Coste transportistas (IVA incl.)</span><strong>{money(transportKpis.total)}</strong><small>MRW {money(transportKpis.mrw)} · Correos {money(transportKpis.correos)}</small><small>{transportKpis.valued}/{transportKpis.shipments} envíos con coste{transportKpis.missing?` · ${transportKpis.missing} sin valorar`:``}</small></div></div></div>
    <div className="stats ordersStats"><div className={overduePending>0?'stat dashboardPendingOrders':'stat'}><div className="statIcon"><ShoppingBag/></div><div><span>Pendientes</span><strong>{pending}</strong><small>{overduePending>0?`${overduePending} con más de ${settings.orders.overdueHours} h`:selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><Store/></div><div><span>Amazon pendientes</span><strong>{amazon}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Shopify pendientes</span><strong>{shopify}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><ShoppingBag/></div><div><span>Manual / API pendientes</span><strong>{manual}</strong><small>{selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><PackageCheck/></div><div><span>Etiquetados</span><strong>{labelled}</strong><small>Etiquetas listas · sin limitar por periodo</small></div></div><div className="stat"><div className="statIcon"><Truck/></div><div><span>Enviados</span><strong>{shipped}</strong><small>Fecha expedición · {selectedPeriod}</small></div></div><div className="stat"><div className="statIcon"><AlertCircle/></div><div><span>Cancelados</span><strong>{cancelled}</strong><small>{selectedPeriod}</small></div></div></div>

    <div className="ordersToolbar businessFilterBar">
      <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pedido, cliente, producto, tracking o transportista…"/></div>
      <div className="ordersFilterGroup"><button className={state==='pending'?'active':''} onClick={()=>setState('pending')}>Pendientes</button><button className={state==='labelled'?'active':''} onClick={()=>setState('labelled')}>Etiquetados</button><button className={state==='shipped'?'active':''} onClick={()=>setState('shipped')}>Enviados</button><button className={state==='cancelled'?'active':''} onClick={()=>setState('cancelled')}>Cancelados</button><button className={state==='all'?'active':''} onClick={()=>setState('all')}>Todos</button></div>
      <div className="businessFilterFields">
        <label className="filterField"><span>Canal</span><SelectField value={channel} onChange={value=>setChannel(value as 'all'|OrderChannel)} ariaLabel="Filtrar por canal" options={[{value:'all',label:'Todos los canales'},{value:'amazon',label:'Amazon'},{value:'shopify',label:'Shopify'},{value:'other',label:'Manual / API'}]}/></label>
        <label className="filterField"><span>Destino</span><SelectField value={countryFilter} onChange={setCountryFilter} ariaLabel="Filtrar por país de destino" options={[{value:'all',label:'Todos los países'},...countryOptions]}/></label>
        <label className="filterField"><span>Transportista</span><SelectField value={carrierFilter} onChange={setCarrierFilter} ariaLabel="Filtrar por transportista" options={[{value:'all',label:'Todos los transportistas'},...carrierOptions]}/></label>
        <label className="filterField"><span>Seguimiento</span><SelectField value={trackingFilter} onChange={value=>setTrackingFilter(value as TrackingFilter)} ariaLabel="Filtrar por seguimiento" options={[{value:'all',label:'Todos'},{value:'none',label:'Sin etiqueta / pendiente'},{value:'ready',label:'Preparado'},{value:'transit',label:'En tránsito'},{value:'route',label:'En reparto'},{value:'pickup',label:'Punto de recogida'},{value:'delivered',label:'Entregado'},{value:'issue',label:'Incidencia'},{value:'cancelled',label:'Cancelado'}]}/></label>
      </div>
    </div>
    {selectableOrders.length>0&&<BulkSelectionToolbar selectedCount={selectedOrders.length} totalCount={selectableOrders.length} allSelected={allSelectableSelected} onToggleAll={toggleAllOrders} label="pedidos con etiqueta pendiente">
      <button className="primary" type="button" disabled={!selectedOrders.length||bulkGenerating} onClick={()=>void generateSelectedLabels()}><Download size={15}/> {bulkGenerating&&selectedOrders.length?`Generando ${bulkProgress}`:`Generar etiquetas seleccionadas (${selectedOrders.length})`}</button>
    </BulkSelectionToolbar>}
    {printer&&<div className="ordersPrinterBar"><Printer size={15}/><span>Impresora directa:</span>{printers.length?<SearchableSelect value={printer} options={printers.map(item=>({value:item.id,label:`${item.name}${item.default?' · predeterminada':''}`,searchText:item.name}))} onChange={value=>{setPrinter(value);void patchPreferences({labelPrinterId:value})}} searchPlaceholder="Buscar impresora…" ariaLabel="Impresora directa"/>:<strong>{printer}</strong>}<button className="link" onClick={()=>{setPrinter('');void patchPreferences({labelPrinterId:null})}}>Usar PDF</button></div>}

    <section className="card tableCard ordersTableCard">{loading?<div className="emptyState large"><LoaderCircle className="spin"/> Cargando pedidos…</div>:filtered.length?<table className="ordersTable"><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allSelectableSelected} disabled={!selectableOrders.length} onChange={toggleAllOrders} label={allSelectableSelected?'Deseleccionar pedidos pendientes':'Seleccionar pedidos pendientes'}/></th>
      <SortableTableHeader label="Canal" sortKey="channel" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Pedido" sortKey="order" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Cliente" sortKey="customer" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Productos" sortKey="products" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Destino" sortKey="destination" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Transportista" sortKey="carrier" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Envío" sortKey="shipping" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Peso" sortKey="weight" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Unidades" sortKey="units" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort} className="right"/>
      <SortableTableHeader label="Total" sortKey="total" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort} className="right"/>
      <SortableTableHeader label="Estado" sortKey="state" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Seguimiento" sortKey="tracking" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Fecha pedido" sortKey="orderDate" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Fecha etiqueta" sortKey="labelDate" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <SortableTableHeader label="Impresión" sortKey="printStatus" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
      <th></th></tr></thead><tbody>{sortedOrders.map(order=>{const stateInfo=orderState(order),tracking=trackingState(order),validation=canPrepareOrder(order)?validateOrderForCarrier(order):{blocking:false,issues:[] as OrderValidationIssue[]},shipping=shippingPriceForOrder(order,shippingPreviews[order.id]||tariffPreviews[order.id]),first=order.items[0],rest=order.items.slice(1,3);return <tr key={order.id} className={`clickableRow ${checkedIds.has(order.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(order)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(order.id)} disabled={!canPrepareOrder(order)} onChange={checked=>toggleOrder(order.id,checked)} label={canPrepareOrder(order)?`Seleccionar pedido ${order.orderNumber||order.orderId}`:'Este pedido ya no admite una nueva etiqueta'}/></td><td><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span></td><td className="ordersOrderCell"><strong>{order.orderNumber||order.orderId||order.sendcloudId}</strong><small>{order.integrationName||''}</small></td><td>{customerWithCountry(order)}{validation.blocking&&<small className="ordersValidationWarn"><AlertCircle size={12}/> Revisar</small>}</td><td className="ordersProductsCell" aria-label={productsText(order)}>{first?<div className="ordersProductIdentity">{order.sourceChannel==='amazon'&&(itemImageUrl(first,amazonImages)?<img className="ordersProductThumb" src={itemImageUrl(first,amazonImages)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="ordersProductThumb ordersProductThumbPlaceholder"><ImageOff size={16}/></span>)}<div><strong>{itemLabel(first)}{itemQty(first)>1?` ×${itemQty(first)}`:''}</strong>{rest.length>0&&<small>{rest.map(item=>`${itemLabel(item)}${itemQty(item)>1?` ×${itemQty(item)}`:''}`).join(' · ')}{order.items.length>3?` · +${order.items.length-3} más`:''}</small>}</div></div>:'—'}</td><td>{text(order.shippingAddress.country_code)||'—'} · {text(order.shippingAddress.postal_code)||''}</td><td><strong className="ordersCarrierText">{carrierLabel(order)}</strong>{order.shippingProvider&&<small className={"ordersShippingProvider "+order.shippingProvider}>{order.shippingProvider==='envia'?'Envia.com':order.shippingProvider==='mrw'?'MRW directo':'Sendcloud'}</small>}</td><td><strong className="ordersShippingPrice">{shipping?money(shipping.totalAmount,shipping.currency):'—'}</strong>{shipping&&shipping.source!=='recorded'&&<small>estimado</small>}</td><td><strong>{weightLabel(order,settings.shipping.weightUnit)}</strong></td><td className="right"><strong>{order.items.reduce((sum,item)=>sum+itemQty(item),0)}</strong></td><td className="right"><strong>{money(order.totalAmount,order.currency||'EUR')}</strong></td><td><span className={`ordersState ${stateInfo.className}`}>{stateInfo.className==='ready'?<PackageCheck size={13}/>:stateInfo.className==='pending'?<Truck size={13}/>:<AlertCircle size={13}/>} {stateInfo.label}</span></td><td><span className={`ordersTracking ${tracking.className}`} title={tracking.className==='issue'?trackingDetail(order).title:(order.trackingStatusMessage||tracking.label)} aria-label={order.trackingStatusMessage||tracking.label}>{tracking.label}</span></td><td>{dateLabel(order.orderCreatedAt,settings.general)}</td><td>{dateLabel(labelTimestamp(order),settings.general)}</td><td>{hasShippingLabel(order)&&(()=>{const print=labelPrintState(order);return <span className={`ordersPrintState ${print.className}`}>{print.label}</span>})()}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">No hay pedidos para estos filtros y fechas.</div>}</section>
    <div className="ordersMobileList">{sortedOrders.map(order=>{const stateInfo=orderState(order),tracking=trackingState(order),validation=canPrepareOrder(order)?validateOrderForCarrier(order):{blocking:false,issues:[] as OrderValidationIssue[]},shipping=shippingPriceForOrder(order,shippingPreviews[order.id]||tariffPreviews[order.id]);return <div className={`bulkMobileSelectableRow ${checkedIds.has(order.id)?'selected':''}`} key={order.id}><BulkSelectCheckbox checked={checkedIds.has(order.id)} disabled={!canPrepareOrder(order)} onChange={checked=>toggleOrder(order.id,checked)} label={canPrepareOrder(order)?`Seleccionar pedido ${order.orderNumber||order.orderId}`:'Este pedido ya no admite una nueva etiqueta'}/><button className="card ordersMobileRow" onClick={()=>setSelected(order)}><div><span className={`ordersChannel ${order.sourceChannel}`}>{channelLabel(order)}</span><strong>{order.orderNumber||order.orderId}</strong><small className="ordersMobileCustomer">{countryFlag(order.shippingAddress.country_code)&&<span className="ordersCountryFlag" aria-label={text(order.shippingAddress.country_code)}>{countryFlag(order.shippingAddress.country_code)}</span>}{order.customerName||'Cliente'} · {weightLabel(order,settings.shipping.weightUnit)} · {carrierLabel(order)} · Envío {shipping?money(shipping.totalAmount,shipping.currency):'—'}</small>{validation.blocking&&<small className="ordersValidationWarn"><AlertCircle size={12}/> Revisar pedido</small>}<small>Pedido {dateLabel(order.orderCreatedAt,settings.general)} · Etiqueta {dateLabel(labelTimestamp(order),settings.general)}{hasShippingLabel(order)?` · ${labelPrintState(order).label}`:''}</small>{order.items[0]&&<div className="ordersMobileProductRow">{order.sourceChannel==='amazon'&&(itemImageUrl(order.items[0],amazonImages)?<img className="ordersProductThumb" src={itemImageUrl(order.items[0],amazonImages)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="ordersProductThumb ordersProductThumbPlaceholder"><ImageOff size={15}/></span>)}<small className="ordersMobileProduct">{itemLabel(order.items[0])}{order.items.length>1?` · +${order.items.length-1} producto${order.items.length-1===1?'':'s'}`:''}</small></div>}</div><div><b>{money(order.totalAmount,order.currency||'EUR')}</b><span className={`ordersState ${stateInfo.className}`}>{stateInfo.label}</span><span className={`ordersTracking ${tracking.className}`} title={tracking.className==='issue'?trackingDetail(order).title:(order.trackingStatusMessage||tracking.label)}>{tracking.label}</span></div><ChevronRight size={18}/></button></div>})}</div>

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
    {selected&&(()=>{const current=orders.find(item=>item.id===selected.id)||selected;const validation=canPrepareOrder(current)?validateOrderForCarrier(current):{blocking:false,issues:[] as OrderValidationIssue[]};const shipping=shippingPriceForOrder(current,shippingPreviews[current.id]||tariffPreviews[current.id]);return <OrderDrawer order={current} shippingPrice={shipping} validationIssues={validation.issues} productImages={amazonImages} onClose={()=>setSelected(null)} onEdit={()=>{setEditValidationIssues(validation.issues);setEditOrder(current)}} onPrepare={()=>prepare(current)} onPrint={()=>existingLabel(current,'print')} onDownload={()=>existingLabel(current,'download')} busy={busyOrder===selected.id||preparingOrder===selected.id}/>})()} 
    {labelOrder&&<LabelModal order={labelOrder} options={options} tariffs={tariffs} message={optionsMessage} loading={optionsLoading} preferredOption={automaticShippingOption(labelOrder,options)} onClose={()=>setLabelOrder(null)} onCreate={createLabel}/>}  
    {manualOpen&&status&&<ManualOrderModal status={status} saving={manualSaving} defaultCountryCode={settings.orders.originCountryCode} fallbackWeightKg={settings.shipping.fallbackWeightKg} weightUnit={settings.shipping.weightUnit} onClose={()=>setManualOpen(false)} onSave={saveManual}/>} 
    {editOrder&&<OrderEditModal order={editOrder} fallbackWeightKg={settings.shipping.fallbackWeightKg} saving={editSaving} validationIssues={editValidationIssues} onClose={()=>{setEditValidationIssues([]);setEditOrder(null)}} onSave={saveEdit}/>} 
  </div>;
}
