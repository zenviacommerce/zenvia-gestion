import type {SalesInvoice} from './sales';

type FiscalInvoice=Pick<SalesInvoice,'status'|'invoiceType'|'subtotal'|'taxAmount'|'totalAmount'|'rectificationMode'|'rectificationOriginalBase'|'rectificationOriginalTax'|'fiscalStatus'|'cancelledAt'>;
export type SalesFiscalAmounts={subtotal:number;taxAmount:number;totalAmount:number};
const cents=(value:number)=>{const rounded=Math.round(value*100)/100;return rounded===0?0:rounded;};

/** Economic movement for fiscal summaries; document/PDF face values stay intact. */
export function salesFiscalAmounts(invoice:FiscalInvoice):SalesFiscalAmounts{
  if(invoice.status==='draft'||invoice.status==='cancelled'||invoice.fiscalStatus==='cancelled'||invoice.cancelledAt)return {subtotal:0,taxAmount:0,totalAmount:0};
  if(invoice.invoiceType==='rectifying'&&invoice.rectificationMode==='S'){
    if(invoice.rectificationOriginalBase==null||invoice.rectificationOriginalTax==null)throw new Error('Falta el desglose original de la rectificativa por sustitución.');
    return {
      subtotal:cents(invoice.subtotal-invoice.rectificationOriginalBase),
      taxAmount:cents(invoice.taxAmount-invoice.rectificationOriginalTax),
      totalAmount:cents(invoice.totalAmount-invoice.rectificationOriginalBase-invoice.rectificationOriginalTax),
    };
  }
  // Legacy unclassified rectifiers retain their stored signed differences.
  return {subtotal:invoice.subtotal,taxAmount:invoice.taxAmount,totalAmount:invoice.totalAmount};
}
