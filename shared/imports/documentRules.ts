import {invoiceAmountsConsistent} from '../../src/services/invoiceFiscalReconciler.ts';
import {validateInvoiceRecipient} from '../../src/services/invoiceRecipientRules.ts';
import {isPlausibleSupplierName} from '../../src/services/supplierIdentity.ts';
import type {ImportKind} from './contracts.ts';
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
export function validImportDate(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value&&d.getTime()<Date.now()+2*86400000;}
export function validateDocumentCandidate(value:unknown,kind:ImportKind,reviewed=false,threshold=.8){
 const c=(value&&typeof value==='object'&&!Array.isArray(value)?value:{}) as Record<string,any>;const reasons:string[]=[];
 if(kind==='transport_tariff'){
  if(!reviewed)reasons.push('La tarifa requiere revisión antes de activarla.');
  if(!String(c.carrierCode||'').trim()||!String(c.carrierName||'').trim())reasons.push('Falta el transportista.');
  if(!/^[A-Z]{3}$/.test(String(c.currencyCode||'')))reasons.push('Revisa la divisa.');
  if(!Array.isArray(c.services)||!c.services.length)reasons.push('No se han detectado servicios ni tramos.');
  for(const service of c.services||[]){
   if(!service.serviceName||!service.canonicalServiceKey||!Array.isArray(service.bands)||!service.bands.length)reasons.push('Servicio incompleto.');
   for(const b of service.bands||[]){if(!/^[A-Z]{2}$/.test(b.countryCode||'')||!b.zoneCode||!b.zoneName||!finite(b.minWeightKg)||b.minWeightKg<0||(b.maxWeightKg!=null&&(!finite(b.maxWeightKg)||b.maxWeightKg<=b.minWeightKg))||!finite(b.basePrice)||b.basePrice<0||(b.extraKgPrice!=null&&(!finite(b.extraKgPrice)||b.extraKgPrice<0)))reasons.push('Revisa los pesos, zonas y precios de la tarifa.');}
  }
 }else if(kind==='expense_document'||kind==='sales_document'){
  const sales=kind==='sales_document',number=String(c.invoiceNumber||''),date=sales?c.issueDate:c.invoiceDate;
  if(c.documentKind==='credit_note')reasons.push('El abono requiere un tratamiento contable específico; no se puede registrar como una factura ordinaria.');
  if(c.documentKind==='not_invoice'||c.documentKind==='unknown')reasons.push('El documento no se ha identificado como factura.');
  if(!number.trim()||number.length>60||!/[0-9]/.test(number)||/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(number))reasons.push('Revisa el número de factura.');
  if(!validImportDate(date))reasons.push('Revisa la fecha de factura.');
  if(!/^[A-Z]{3}$/.test(String(c.currency||'')))reasons.push('Revisa la divisa.');
  const amounts={subtotal:c.subtotal,vat:sales?c.taxAmount:c.vat,total:sales?c.totalAmount:c.total,withholding:c.withholding||0,equivalenceSurcharge:c.equivalenceSurcharge||0};
  if(!finite(amounts.subtotal)||!finite(amounts.vat)||!finite(amounts.total)||amounts.total<=0||!invoiceAmountsConsistent(amounts))reasons.push('Base, impuestos y total no cuadran.');
  if(!sales){if(!isPlausibleSupplierName(String(c.supplierName||'')))reasons.push('Revisa el proveedor.');const recipient=validateInvoiceRecipient(String(c.text||''),String(date||''));if(!recipient.accepted)reasons.push(recipient.reason||'Revisa el destinatario.');}
  else{if(!c.clientId&&!String(c.proposedClient?.name||'').trim())reasons.push('Revisa el cliente.');if(!c.seriesId)reasons.push('Selecciona una serie.');if(!Array.isArray(c.lines)||!c.lines.length)reasons.push('Añade las líneas de factura.');}
  if(sales&&Array.isArray(c.lines)){
   const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
   let net=0,tax=0;
   for(const line of c.lines){const discount=line.discountPercent??0;
    if(!finite(line.unitPrice)||line.unitPrice<0||!finite(line.taxRate)||line.taxRate<0||line.taxRate>100||!finite(discount)||discount<0||discount>100){reasons.push('Revisa precios, IVA y descuentos de las líneas.');continue;}
    const base=round(line.quantity*line.unitPrice*(1-discount/100));net+=base;tax+=round(base*line.taxRate/100);
   }
   if(Math.abs(round(net)-c.subtotal)>.08||Math.abs(round(tax)-c.taxAmount)>.08||Math.abs(round(net+tax)-c.totalAmount)>.08)reasons.push('Las líneas no cuadran con los totales de la factura.');
   if(c.dueDate&&(!validImportDate(c.dueDate)&&!/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate)))reasons.push('Revisa el vencimiento.');
  }
  if(Array.isArray(c.lines)&&c.lines.some((l:any)=>!String(l.description||'').trim()||!finite(l.quantity)||l.quantity<=0||!finite(l.unitPrice)||!finite(l.taxRate)||l.taxRate<0||l.taxRate>100))reasons.push('Hay líneas incompletas.');
  if(!reviewed&&(!finite(c.confidence)||c.confidence<threshold||c.reviewReason))reasons.push(c.reviewReason||'La extracción requiere revisión.');
 }else reasons.push('Esta entrada no admite revisión documental.');
 return {safe:reasons.length===0,reasons:[...new Set(reasons)]};
}
