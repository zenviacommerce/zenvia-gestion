/** Pure financial normalization. Original totals are deliberately used, never current totals. */
export function shopifyAnalyticsCallerAllowed(caller:any):boolean {
 return Boolean(caller?.active && (caller.role==='admin'||Array.isArray(caller.permissions)&&caller.permissions.includes('shopify')));
}
function amount(value:any):number { const n=Number(value?.shopMoney?.amount??0); if(!Number.isFinite(n))throw new Error('Shopify devolvió un importe no válido.');return n; }
function nodes(value:any):any[]{return value?.nodes||value?.edges?.map((e:any)=>e.node)||[];}
function sku(line:any):string{return String(line.sku||line.variant?.id||line.id);}
export function normalizeShopifyAnalyticsOrder(o:any,owner:string,store:string){
 const currency=String(o.totalPriceSet?.shopMoney?.currencyCode||'').toUpperCase();
 if(!/^[A-Z]{3}$/.test(currency))throw new Error('Shopify no devolvió una moneda válida.');
 const common={owner_id:owner,integration_account_id:store,order_id:String(o.legacyResourceId||o.id),currency};
 const order={...common,event_at:o.processedAt||o.createdAt,updated_at:o.updatedAt,gross_sales:amount(o.totalPriceSet),sales_vat:amount(o.totalTaxSet),discounts:amount(o.totalDiscountsSet),shipping_charged:amount(o.totalShippingPriceSet),cancelled:Boolean(o.cancelledAt),test:Boolean(o.test),financial_status:String(o.displayFinancialStatus||''),requires_shipping:nodes(o.lineItems).some((l:any)=>l.requiresShipping!==false)};
 const items=nodes(o.lineItems).map((l:any)=>{
  const vat=(l.taxLines||[]).reduce((sum:number,t:any)=>sum+amount(t.priceSet),0);
  const allocated=(l.discountAllocations||[]).reduce((sum:number,d:any)=>sum+amount(d.allocatedAmountSet),0);
  const discounted=l.originalTotalSet?amount(l.originalTotalSet)-allocated:amount(l.discountedTotalSet);
  const net=o.taxesIncluded?discounted-vat:discounted;
  return {...common,line_id:String(l.id),seller_sku:sku(l),variant_id:l.variant?.id||null,name:String(l.name||l.title||'Producto Shopify'),image_url:l.image?.url||null,quantity:Number(l.quantity),gross_sales:net+vat,net_sales:net,sales_vat:vat};
 });
 const refunds:any[]=[];const refundItems:any[]=[];
 for(const r of o.refunds||[]){
  if(!nodes(r.transactions).some((t:any)=>t.status==='SUCCESS'&&t.kind==='REFUND'))continue;
  const refundCommon={...common,refund_id:String(r.id),event_at:r.createdAt};
  let tax=0;
  for(const l of nodes(r.refundLineItems)){
   const vat=amount(l.totalTaxSet);tax+=vat;
   refundItems.push({...refundCommon,line_id:String(l.lineItem?.id),seller_sku:sku(l.lineItem||{}),quantity:Number(l.quantity),net_amount:amount(l.subtotalSet),tax_amount:vat});
  }
  for(const l of nodes(r.refundShippingLines))tax+=amount(l.taxAmountSet);
  // Shopify order adjustments carry signed tax changes; refunded tax is their absolute debit.
  for(const l of nodes(r.orderAdjustments))tax+=Math.abs(amount(l.taxAmountSet));
  const gross=amount(r.totalRefundedSet);
  refunds.push({...refundCommon,gross_amount:gross,tax_amount:tax,net_amount:gross-tax});
 }
 return {order,items,refunds,refundItems};
}
