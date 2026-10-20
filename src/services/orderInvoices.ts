import {notifyEntityChanged} from './entityChanges';
import {supabase} from './supabase';
import {loadSalesInvoices,type SalesInvoiceLine,type ClientInput} from './sales';
import type {FulfillmentOrder} from './orders';
import {shopifyInvoiceLines} from './shopifyInvoiceCore';
export function orderInvoiceKey(order:Pick<FulfillmentOrder,'sourceIntegrationAccountId'|'orderId'>){
  if(!order.sourceIntegrationAccountId||!order.orderId)throw new Error('Este pedido no está vinculado a una cuenta directa de Shopify.');
  return `shopify:${order.sourceIntegrationAccountId}:${order.orderId}`;
}
export async function loadOrderInvoice(order:FulfillmentOrder){
  const {data,error}=await supabase.from('sales_invoices').select('id').eq('source_order_key',orderInvoiceKey(order)).maybeSingle();
  if(error)throw error;
  if(!data)return null;
  return (await loadSalesInvoices()).find(i=>i.id===data.id)||null;
}
export async function prepareOrderInvoice(order:FulfillmentOrder){
  const existing=await loadOrderInvoice(order);
  if(existing)return {invoice:existing,lines:existing.lines};
  const {data,error}=await supabase.from('fulfillment_orders').select('raw_payload').eq('id',order.id).single();
  if(error)throw error;
  return {invoice:null,lines:shopifyInvoiceLines(data.raw_payload)};
}
export async function saveOrderInvoice(orderId:string,input:{client:ClientInput;taxRegistrationId?:string;seriesId:string;issueDate:string;lines:SalesInvoiceLine[]},issue:boolean){
  const {data,error}=await supabase.rpc('save_shopify_order_invoice',{p_order_id:orderId,p_client:{...input.client,taxRegistrationId:input.taxRegistrationId||null},p_series_id:input.seriesId,p_issue_date:input.issueDate,p_lines:input.lines,p_issue:issue});
  if(error)throw error;
  notifyEntityChanged('clients');
  const invoice=(await loadSalesInvoices()).find(i=>i.id===data);
  if(!invoice)throw new Error('La factura se ha guardado, pero no se pudo recargar. Abre Facturas de venta.');
  return invoice;
}
