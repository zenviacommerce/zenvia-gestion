import type { SalesInvoiceLine } from './sales';
const round=(n:number,places=2)=>Math.round((n+Number.EPSILON)*10**places)/10**places;
const amount=(value:any)=>Number(value?.shopMoney?.amount);
/** Use Shopify's allocated discounts, never estimated VAT by destination. */
export function shopifyInvoiceLines(order:any):SalesInvoiceLine[]{
  if(typeof order?.taxesIncluded!=='boolean')throw new Error('Pulsa Actualizar pedidos para obtener el desglose fiscal de Shopify.');
  if(order.cancelledAt||/REFUNDED|VOIDED/.test(order.displayFinancialStatus||''))throw new Error('Este pedido tiene cancelaciones o reembolsos. Revisa su facturación desde Facturas de venta.');
  if(order.lineItems?.pageInfo?.hasNextPage||order.shippingLines?.pageInfo?.hasNextPage)throw new Error('El pedido tiene más líneas de las importadas. No se puede emitir una factura parcial.');
  const lines:SalesInvoiceLine[]=[];
  function add(description:string,quantity:number,price:number,taxes:any[]){
    if(!description||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<0)throw new Error('Hay una línea de Shopify con datos inválidos.');
    if(!Array.isArray(taxes))throw new Error('Actualizar pedidos: falta el desglose de impuestos.');
    const rates=taxes.map(t=>Number(t.rate)*100);
    if(rates.some(r=>!Number.isFinite(r)||r<0)||rates.filter(r=>r>0).length>1)throw new Error('La línea tiene varios impuestos. Revisa su facturación desde Facturas de venta.');
    const taxRate=round(rates.reduce((a,b)=>a+b,0),4);
    const net=order.taxesIncluded?price/(1+taxRate/100):price;
    const unitPrice=round(net/quantity,4);
    const lineNet=round(quantity*unitPrice);
    // Match Shopify's included-tax rounding and the scoped database trigger.
    const taxAmount=round((order.taxesIncluded?quantity*unitPrice:lineNet)*taxRate/100);
    lines.push({position:lines.length+1,description,quantity,unit:'ud',unitPrice,discountPercent:0,taxRate,lineNet,taxAmount,lineTotal:round(lineNet+taxAmount)});
  }
  for(const item of order.lineItems?.nodes||[]){
    if(!Array.isArray(item.discountAllocations))throw new Error('Actualizar pedidos: faltan los descuentos de Shopify.');
    const discounts=item.discountAllocations.reduce((sum:number,d:any)=>sum+amount(d.allocatedAmountSet),0);
    add(item.name,Number(item.quantity),round(amount(item.originalUnitPriceSet)*Number(item.quantity)-discounts),item.taxLines);
  }
  for(const shipping of order.shippingLines?.nodes||[])add(shipping.title||'Transporte',1,amount(shipping.discountedPriceSet),shipping.taxLines);
  if(!lines.length)throw new Error('El pedido no tiene líneas facturables.');
  const total=lines.reduce((sum,line)=>sum+line.lineTotal!,0);
  const expected=amount(order.totalPriceSet);
  if(!Number.isFinite(expected)||Math.abs(round(total)-round(expected))>.001)throw new Error('El total de la factura no cuadra con Shopify. Revisa descuentos, impuestos y otros cargos antes de emitir.');
  return lines;
}
