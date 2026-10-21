import {BankAccountSelect,BankAccountSnapshotView,documentPaymentMethodId,MISSING_BANK_ACCOUNT,useBankAccountChoice} from './BankAccountSelect';
import {orderProvinceName} from '../services/orderProvince';
import {useEffect,useState} from 'react';
import {X,Download,Mail,FileText} from 'lucide-react';
import type {FulfillmentOrder} from '../services/orders';
import {ensureSalesSeries,loadBusinessSettings,loadClients,type ClientInput,type SalesInvoice,type SalesInvoiceLine,type SalesInvoiceSeries,type BusinessSettings} from '../services/sales';
import {loadTaxRegistrations,type TaxRegistration} from '../services/salesConfig';
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
  const [client,setClient]=useState<ClientInput>({name:String(address.company_name||address.name||order.customerName||''),taxId:String(address.tax_id||''),email:order.customerEmail||'',addressLine1:String(address.address_line_1||''),addressLine2:String(address.address_line_2||''),postalCode:String(address.postal_code||''),city:String(address.city||''),province:orderProvinceName(address),countryCode:String(address.country_code||''),paymentTermsDays:0});
  const [invoice,setInvoice]=useState<SalesInvoice|null>(null),[lines,setLines]=useState<SalesInvoiceLine[]>([]),[series,setSeries]=useState<SalesInvoiceSeries[]>([]),[seriesId,setSeriesId]=useState(''),[issueDate,setIssueDate]=useState(()=>new Date().toLocaleDateString('sv-SE'));
  const [paymentMethodId,setPaymentMethodId]=useState(settings.sales.paymentMethods.find(item=>item.active&&item.id===settings.sales.defaultPaymentMethod)?.id||settings.sales.paymentMethods.find(item=>item.active)?.id||'');
  const bankFrozen=Boolean(invoice?.bankSnapshotSource||invoice?.bankSnapshotAt||invoice?.bankAccountSnapshot);
  const bank=useBankAccountChoice({active:!bankFrozen&&(!invoice||invoice.status==='draft'),documentKey:order.id,persistedId:invoice?.bankAccountId,seriesDefaultId:series.find(item=>item.id===seriesId)?.defaultBankAccountId});
  const [taxRegistrations,setTaxRegistrations]=useState<TaxRegistration[]>([]),[taxRegistrationId,setTaxRegistrationId]=useState('');
  const [business,setBusiness]=useState<BusinessSettings|null>(null),[branding,setBranding]=useState<CompanyBranding|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[sending,setSending]=useState(false);
  useEffect(()=>{let active=true;void Promise.allSettled([prepareOrderInvoice(order),ensureSalesSeries(new Date().getFullYear()),loadBusinessSettings(),loadCompanyBranding(),loadClients(),loadTaxRegistrations()]).then(([preparedResult,seriesResult,businessResult,brandingResult,clientsResult,taxesResult])=>{
    if(!active)return;
    const prepared=preparedResult.status==='fulfilled'?preparedResult.value:null;
    const allSeries=seriesResult.status==='fulfilled'?seriesResult.value:[];
    const taxes=taxesResult.status==='fulfilled'?taxesResult.value:[];
    if(businessResult.status==='fulfilled')setBusiness(businessResult.value);
    if(brandingResult.status==='fulfilled')setBranding(brandingResult.value);
    setSeries(allSeries.filter(s=>s.kind==='standard'));
    setSeriesId(prepared?.invoice?.seriesId||allSeries.find(s=>s.kind==='standard'&&s.id===settings.sales.defaultSeriesId)?.id||allSeries.find(s=>s.kind==='standard')?.id||'');
    setTaxRegistrations(taxes.filter(t=>t.active));
    setTaxRegistrationId(prepared?.invoice?.taxRegistrationId||taxes.find(t=>t.active&&t.id===settings.sales.defaultTaxRegistrationId)?.id||taxes.find(t=>t.active&&t.isDefault)?.id||'');
    if(prepared){setInvoice(prepared.invoice);setLines(prepared.lines);if(prepared.invoice){setPaymentMethodId(documentPaymentMethodId(settings.sales,prepared.invoice.paymentMethod,prepared.invoice.paymentMethodId)||'');setIssueDate(prepared.invoice.issueDate);const saved=clientsResult.status==='fulfilled'?clientsResult.value.find(c=>c.id===prepared.invoice!.clientId):null;if(saved)setClient(saved);}}
    const failed=[preparedResult,seriesResult,businessResult,brandingResult,clientsResult,taxesResult].find(r=>r.status==='rejected');
    if(failed?.status==='rejected')setError(errorMessage(failed.reason,'No se pudo preparar la factura.'));
    setLoadFailed(Boolean(failed));
  }).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[order.id]);
  const [loadFailed,setLoadFailed]=useState(false);
  const issued=Boolean(invoice&&invoice.status!=='draft');
  const total=lines.reduce((sum,l)=>{const net=Math.round(l.quantity*l.unitPrice*(1-l.discountPercent/100)*100)/100;return sum+(l.lineTotal??net+Math.round(net*l.taxRate)/100)},0);
  const save=async(issue:boolean,send=false)=>{
    if(loadFailed||!business)return;
    if(!client.name.trim()||!client.addressLine1?.trim()||!client.postalCode?.trim()||!client.city?.trim()||!/^[A-Z]{2}$/.test(client.countryCode)||!seriesId){setError('Completa nombre, dirección, código postal, ciudad, país y serie.');return;}
    if(!bankFrozen&&(bank.loading||bank.error||bank.selectionError)){setError(bank.error||bank.selectionError||'Espera a que se carguen las cuentas bancarias.');return;}
    if(issue&&!bankFrozen&&paymentMethodId==='bank_transfer'&&!bank.value){setError(MISSING_BANK_ACCOUNT);return;}
    setBusy(true);setError('');try{const result=await saveOrderInvoice(order.id,{client,seriesId,issueDate,lines,taxRegistrationId,paymentMethodId:paymentMethodId||null,paymentMethod:settings.sales.paymentMethods.find(item=>item.id===paymentMethodId)?.label||invoice?.paymentMethod||null,...(!bankFrozen?{bankAccountId:bank.value||null}:{})},issue);setInvoice(result);onSaved();if(send)setSending(true);}catch(e){setError(errorMessage(e,'No se pudo guardar la factura.'))}finally{setBusy(false)};
  };
  const field=(key:keyof ClientInput,label:string)=><label key={key}>{label}<input disabled={issued||busy} value={String(client[key]??'')} onChange={e=>setClient(c=>({...c,[key]:key==='countryCode'?e.target.value.toUpperCase():e.target.value}))}/></label>;
  if(sending&&invoice&&business)return <SendInvoiceModal invoice={invoice} settings={business} branding={branding} onClose={()=>setSending(false)} onSent={async()=>{setInvoice(i=>i?{...i,sentAt:new Date().toISOString()}:i);onSaved();}}/>;
  return <div className="modalBackdrop"><div className="modal polishedModal salesClientModal">
    <div className="modalHead"><div><div className="eyebrow">FACTURACIÓN SHOPIFY · MANUAL</div><h3>{issued?invoice?.invoiceNumber:`Factura del pedido ${order.orderNumber}`}</h3><p>{issued?`Emitida${invoice?.sentAt?' · Enviada por email':''}`:'Revisa los datos. El número se asignará únicamente al emitir.'}</p></div><button disabled={busy} onClick={onClose} aria-label="Cerrar"><X/></button></div>
    {!issued&&<><div className="salesFormGrid">{field('name','Nombre / razón social')}{field('taxId','NIF / CIF / VAT')}{field('email','Email del cliente')}{field('addressLine1','Dirección')}{field('addressLine2','Dirección adicional')}{field('postalCode','Código postal')}{field('city','Ciudad')}{field('province','Provincia')}{field('countryCode','País (ISO)')}<label>Fecha<input type="date" disabled={busy} value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label><label>Serie<SelectField ariaLabel="Serie" disabled={busy} value={seriesId} options={series.map(s=>({value:s.id,label:`${s.name} · ${s.prefix}`}))} onChange={setSeriesId}/></label><label>Registro IVA del emisor<SelectField ariaLabel="Registro IVA del emisor" disabled={busy} value={taxRegistrationId} options={taxRegistrations.map(t=>({value:t.id,label:`${t.label} · ${t.vatNumber}`}))} onChange={setTaxRegistrationId} allowEmpty emptyLabel="Registro por defecto"/></label></div><p>Emisor: {business?.legalName}. Los descuentos están incluidos en los precios netos.</p></>}
    {!issued&&!bankFrozen&&<section className="salesFormSection"><label>Forma de pago<SelectField ariaLabel="Forma de pago Shopify" value={paymentMethodId} onChange={setPaymentMethodId} disabled={busy} options={settings.sales.paymentMethods.filter(item=>item.active).map(item=>({value:item.id,label:item.label}))}/></label><BankAccountSelect accounts={bank.accounts} value={bank.value} onChange={bank.choose} required={paymentMethodId==='bank_transfer'} disabled={busy} loading={bank.loading} error={bank.error} onRetry={()=>void bank.reload()}/></section>}
    {(issued||bankFrozen)&&invoice&&<BankAccountSnapshotView snapshot={invoice.bankAccountSnapshot} source={invoice.bankSnapshotSource} capturedAt={invoice.bankSnapshotAt}/>}
    {issued&&invoice&&<section className="salesFormSection"><div className="salesSectionTitle"><Mail size={18}/><div><strong>Datos del cliente</strong><span>La factura ya está emitida. Cancelar el correo no modifica la factura.</span></div></div><dl><dt>Nombre / razón social</dt><dd>{invoice.clientName||client.name}</dd><dt>NIF / CIF / VAT</dt><dd>{invoice.clientTaxId||client.taxId||'—'}</dd><dt>Email</dt><dd>{invoice.clientEmail||client.email||'Sin email'}</dd><dt>Dirección</dt><dd>{invoice.clientAddress||[client.addressLine1,client.addressLine2,client.postalCode,client.city,client.countryCode].filter(Boolean).join(', ')}</dd><dt>Número de factura</dt><dd>{invoice.invoiceNumber}</dd></dl></section>}
    <div className="ordersItems">{lines.map(l=><div key={l.position}><strong>{l.description}</strong><span>{l.quantity} × {l.unitPrice.toFixed(4)} · IVA {l.taxRate}%</span></div>)}</div><p><strong>Total: {total.toFixed(2)} {invoice?.currency||order.currency}</strong></p>
    {error&&<div className="errorBox">{error}</div>}
    <div className="modalActions"><button className="secondary" disabled={busy} onClick={onClose}>{hasNext?'Siguiente pedido':'Cerrar'}</button>{issued?<><button className="secondary" disabled={!business} onClick={()=>business&&invoice&&downloadSalesInvoicePdf(invoice,business,branding,settings.sales,settings.general)}><Download size={16}/> Descargar PDF</button><button className="primary" disabled={busy} onClick={()=>setSending(true)}><Mail size={16}/> {invoice?.sentAt?'Reenviar':'Enviar por email'}</button></>:<><button className="secondary" disabled={busy||loadFailed||!business||!lines.length} onClick={()=>void save(false)}>Guardar borrador</button><button className="primary" disabled={busy||loadFailed||!business||!lines.length} onClick={()=>void save(true)}><FileText size={16}/> {busy?'Cargando…':'Generar factura'}</button><button className="primary" disabled={busy||loadFailed||!business||!lines.length} onClick={()=>void save(true,true)}><Mail size={16}/> Generar y enviar</button></>}</div>
  </div></div>;
}
