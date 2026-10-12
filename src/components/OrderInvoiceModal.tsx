import {useEffect,useState} from 'react';
import {X,Download,Mail,FileText} from 'lucide-react';
import type {FulfillmentOrder} from '../services/orders';
import {ensureSalesSeries,loadBusinessSettings,loadClients,type ClientInput,type SalesInvoice,type SalesInvoiceLine,type SalesInvoiceSeries,type BusinessSettings} from '../services/sales';
import {prepareOrderInvoice,saveOrderInvoice} from '../services/orderInvoices';
import {loadCompanyBranding,type CompanyBranding} from '../services/companyBranding';
import {downloadSalesInvoicePdf} from '../services/salesInvoicePdf';
import {SendInvoiceModal} from './SendInvoiceModal';
import {SelectField} from './forms/SelectField';
import {errorMessage} from '../services/toast';
import {useSettings} from '../context/SettingsContext';
export function OrderInvoiceModal({order,onClose,onSaved,hasNext=false}:{order:FulfillmentOrder;onClose:()=>void;onSaved:()=>void;hasNext?:boolean}){
  const {settings}=useSettings();
  const address=Object.keys(order.billingAddress).length&&order.billingAddress.address_line_1?order.billingAddress:order.shippingAddress;
  const [client,setClient]=useState<ClientInput>({name:String(address.company_name||address.name||order.customerName||''),taxId:String(address.tax_id||''),email:order.customerEmail||'',addressLine1:String(address.address_line_1||''),addressLine2:String(address.address_line_2||''),postalCode:String(address.postal_code||''),city:String(address.city||''),province:String(address.state_province_code||''),countryCode:String(address.country_code||''),paymentTermsDays:0});
  const [invoice,setInvoice]=useState<SalesInvoice|null>(null),[lines,setLines]=useState<SalesInvoiceLine[]>([]),[series,setSeries]=useState<SalesInvoiceSeries[]>([]),[seriesId,setSeriesId]=useState(''),[issueDate,setIssueDate]=useState(()=>new Date().toLocaleDateString('sv-SE'));
  const [business,setBusiness]=useState<BusinessSettings|null>(null),[branding,setBranding]=useState<CompanyBranding|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[sending,setSending]=useState(false);
  useEffect(()=>{let active=true;void Promise.all([prepareOrderInvoice(order),ensureSalesSeries(new Date().getFullYear()),loadBusinessSettings(),loadCompanyBranding(),loadClients()]).then(([prepared,allSeries,b,bg,clients])=>{if(!active)return;setBusiness(b);setBranding(bg);setSeries(allSeries.filter(s=>s.kind==='standard'));setSeriesId(prepared.invoice?.seriesId||allSeries.find(s=>s.kind==='standard')?.id||'');setInvoice(prepared.invoice);setLines(prepared.lines);if(prepared.invoice){setIssueDate(prepared.invoice.issueDate);const saved=clients.find(c=>c.id===prepared.invoice!.clientId);if(saved)setClient(saved);}}).catch(e=>{if(active)setError(errorMessage(e,'No se pudo preparar la factura.'))}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[order.id]);
  const issued=Boolean(invoice&&invoice.status!=='draft');
  const total=lines.reduce((sum,l)=>{const net=Math.round(l.quantity*l.unitPrice*(1-l.discountPercent/100)*100)/100;return sum+net+Math.round(net*l.taxRate)/100},0);
  const save=async(issue:boolean,send=false)=>{
    if(!client.name.trim()||!client.addressLine1?.trim()||!client.postalCode?.trim()||!client.city?.trim()||!/^[A-Z]{2}$/.test(client.countryCode)||!seriesId){setError('Completa nombre, dirección, código postal, ciudad, país y serie.');return;}
    setBusy(true);setError('');try{const result=await saveOrderInvoice(order.id,{client,seriesId,issueDate,lines},issue);setInvoice(result);onSaved();if(send)setSending(true);}catch(e){setError(errorMessage(e,'No se pudo guardar la factura.'))}finally{setBusy(false)};
  };
  const field=(key:keyof ClientInput,label:string)=><label key={key}>{label}<input disabled={issued||busy} value={String(client[key]??'')} onChange={e=>setClient(c=>({...c,[key]:key==='countryCode'?e.target.value.toUpperCase():e.target.value}))}/></label>;
  if(sending&&invoice&&business)return <SendInvoiceModal invoice={invoice} settings={business} branding={branding} onClose={()=>setSending(false)} onSent={async()=>{setInvoice(i=>i?{...i,sentAt:new Date().toISOString()}:i);onSaved();}}/>;
  return <div className="modalBackdrop"><div className="modal polishedModal salesClientModal">
    <div className="modalHead"><div><div className="eyebrow">FACTURACIÓN SHOPIFY · MANUAL</div><h3>{issued?invoice?.invoiceNumber:`Factura del pedido ${order.orderNumber}`}</h3><p>{issued?`Emitida${invoice?.sentAt?' · Enviada por email':''}`:'Revisa los datos. El número se asignará únicamente al emitir.'}</p></div><button disabled={busy} onClick={onClose} aria-label="Cerrar"><X/></button></div>
    {!issued&&<><div className="salesFormGrid">{field('name','Nombre / razón social')}{field('taxId','NIF / CIF / VAT')}{field('email','Email del cliente')}{field('addressLine1','Dirección')}{field('addressLine2','Dirección adicional')}{field('postalCode','Código postal')}{field('city','Ciudad')}{field('province','Provincia')}{field('countryCode','País (ISO)')}<label>Fecha<input type="date" disabled={busy} value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label><label>Serie<SelectField disabled={busy} value={seriesId} options={series.map(s=>({value:s.id,label:`${s.name} · ${s.prefix}`}))} onChange={setSeriesId}/></label></div><p>Emisor: {business?.legalName}. Los descuentos están incluidos en los precios netos.</p></>}
    <div className="ordersItems">{lines.map(l=><div key={l.position}><strong>{l.description}</strong><span>{l.quantity} × {l.unitPrice.toFixed(4)} · IVA {l.taxRate}%</span></div>)}</div><p><strong>Total: {total.toFixed(2)} {invoice?.currency||order.currency}</strong></p>
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions"><button className="secondary" disabled={busy} onClick={onClose}>{hasNext?'Siguiente pedido':'Cerrar'}</button>{issued?<><button className="secondary" disabled={!business} onClick={()=>business&&invoice&&downloadSalesInvoicePdf(invoice,business,branding,settings.sales,settings.general)}><Download size={16}/> Descargar PDF</button><button className="primary" disabled={busy} onClick={()=>setSending(true)}><Mail size={16}/> {invoice?.sentAt?'Reenviar':'Enviar por email'}</button></>:<><button className="secondary" disabled={busy||!lines.length} onClick={()=>void save(false)}>Guardar borrador</button><button className="primary" disabled={busy||!lines.length} onClick={()=>void save(true)}><FileText size={16}/> {busy?'Cargando…':'Generar factura'}</button><button className="primary" disabled={busy||!lines.length} onClick={()=>void save(true,true)}><Mail size={16}/> Generar y enviar</button></>}</div>
  </div></div>;
}
