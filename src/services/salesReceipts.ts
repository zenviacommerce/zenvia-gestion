import { supabase } from './supabase';
import { sanitizeDatabaseSingleLine, sanitizeDatabaseText } from './textSanitizer';

export type SalesReceiptLine={
  id?:string;
  productId?:string|null;
  position:number;
  description:string;
  quantity:number;
  unit:string;
  unitPrice:number;
  discountPercent:number;
  invoiceTaxRate:number;
  lineTotal?:number;
};

export type SalesReceiptPayment={
  id:string;
  paymentDate:string;
  amount:number;
  method?:string|null;
  reference?:string|null;
  notes?:string|null;
};

export type SalesReceipt={
  id:string;
  clientId:string;
  clientName:string;
  receiptNumber:string;
  receiptDate:string;
  currency:string;
  notes?:string|null;
  totalAmount:number;
  lines:SalesReceiptLine[];
  payments:SalesReceiptPayment[];
  paidAmount:number;
};

export type SalesReceiptInput={
  clientId:string;
  receiptDate:string;
  currency?:string;
  notes?:string;
  lines:SalesReceiptLine[];
};

const n=(value:unknown)=>Number(value??0)||0;
const nullable=(value?:string|null)=>{const cleaned=sanitizeDatabaseText(value).trim();return cleaned||null;};

function receiptRow(input:SalesReceiptInput){
  return {
    client_id:input.clientId,
    receipt_date:sanitizeDatabaseSingleLine(input.receiptDate),
    currency:sanitizeDatabaseSingleLine(input.currency||'EUR').toUpperCase().slice(0,3)||'EUR',
    notes:nullable(input.notes),
  };
}

function lineRows(receiptId:string,lines:SalesReceiptLine[]){
  return lines.map((line,index)=>({
    receipt_id:receiptId,
    product_id:line.productId||null,
    position:index+1,
    description:sanitizeDatabaseSingleLine(line.description),
    quantity:Number(line.quantity),
    unit:sanitizeDatabaseSingleLine(line.unit)||'ud',
    unit_price:Number(line.unitPrice),
    discount_percent:Number(line.discountPercent||0),
    invoice_tax_rate:Number(line.invoiceTaxRate||0),
  })).filter(row=>row.description);
}

export async function loadSalesReceipts():Promise<SalesReceipt[]>{
  const [receiptResult,lineResult,clientResult,paymentResult]=await Promise.all([
    supabase.from('sales_receipts').select('*').order('receipt_date',{ascending:false}).order('created_at',{ascending:false}),
    supabase.from('sales_receipt_lines').select('*').order('position'),
    supabase.from('clients').select('id,name'),
    supabase.from('sales_receipt_payments').select('*').order('payment_date').order('created_at'),
  ]);
  for(const result of [receiptResult,lineResult,clientResult,paymentResult])if(result.error)throw result.error;
  const clients=new Map((clientResult.data??[]).map((row:any)=>[row.id,row.name]));
  const lines=new Map<string,SalesReceiptLine[]>();
  for(const row of lineResult.data??[]){
    const bucket=lines.get(row.receipt_id)??[];
    bucket.push({
      id:row.id,productId:row.product_id,position:Number(row.position||1),description:row.description,
      quantity:n(row.quantity),unit:row.unit||'ud',unitPrice:n(row.unit_price),discountPercent:n(row.discount_percent),
      invoiceTaxRate:n(row.invoice_tax_rate),lineTotal:n(row.line_total),
    });
    lines.set(row.receipt_id,bucket);
  }
  const payments=new Map<string,SalesReceiptPayment[]>();
  for(const row of paymentResult.data??[]){
    const bucket=payments.get(row.receipt_id)??[];
    bucket.push({id:row.id,paymentDate:row.payment_date,amount:n(row.amount),method:row.method,reference:row.reference,notes:row.notes});
    payments.set(row.receipt_id,bucket);
  }
  return (receiptResult.data??[]).map((row:any)=>{
    const receiptPayments=payments.get(row.id)??[];
    return {
      id:row.id,clientId:row.client_id,clientName:clients.get(row.client_id)||'Cliente',receiptNumber:row.receipt_number,
      receiptDate:row.receipt_date,currency:row.currency||'EUR',notes:row.notes,totalAmount:n(row.total_amount),
      lines:lines.get(row.id)??[],payments:receiptPayments,paidAmount:receiptPayments.reduce((sum,payment)=>sum+payment.amount,0),
    };
  });
}

export async function createSalesReceipt(input:SalesReceiptInput){
  const {data:receipt,error}=await supabase.from('sales_receipts').insert(receiptRow(input)).select('id,receipt_number').single();
  if(error)throw error;
  const rows=lineRows(receipt.id,input.lines);
  if(!rows.length){await supabase.from('sales_receipts').delete().eq('id',receipt.id);throw new Error('Añade al menos una línea al recibo.');}
  const {error:lineError}=await supabase.from('sales_receipt_lines').insert(rows);
  if(lineError){await supabase.from('sales_receipts').delete().eq('id',receipt.id);throw lineError;}
  return {id:receipt.id as string,receiptNumber:receipt.receipt_number as string};
}

export async function updateSalesReceipt(id:string,input:SalesReceiptInput){
  const {error}=await supabase.from('sales_receipts').update(receiptRow(input)).eq('id',id);
  if(error)throw error;
  const rows=lineRows(id,input.lines);
  if(!rows.length)throw new Error('Añade al menos una línea al recibo.');
  const {error:deleteError}=await supabase.from('sales_receipt_lines').delete().eq('receipt_id',id);if(deleteError)throw deleteError;
  const {error:lineError}=await supabase.from('sales_receipt_lines').insert(rows);if(lineError)throw lineError;
}

export async function deleteSalesReceipt(id:string){
  const {error}=await supabase.from('sales_receipts').delete().eq('id',id);
  if(error)throw error;
}

export async function addSalesReceiptPayment(receiptId:string,input:{amount:number;paymentDate:string;method?:string;reference?:string;notes?:string}){
  const {error}=await supabase.from('sales_receipt_payments').insert({
    receipt_id:receiptId,
    amount:Number(input.amount),
    payment_date:sanitizeDatabaseSingleLine(input.paymentDate),
    method:nullable(input.method),
    reference:nullable(input.reference),
    notes:nullable(input.notes),
  });
  if(error)throw error;
}
