export type ShopifyFilters={from:string;to:string;storeIds:string[]};
export type ShopifySummary={grossSales:number|null;salesVat:number|null;netSales:number|null;orders:number;units:number;refunds:number|null;refundGross:number|null;refundCount:number;discounts:number|null;shippingCharged:number|null;productCost:number|null;shippingCost:number|null;paymentFees:number|null;adsCost:number|null;netProfit:number|null;profitBeforeAds:number|null;marginPct:number|null;knownMarginPct?:number|null;unmappedSkuCount:number;missingCostCount:number;missingFxCount:number;profitComplete:boolean;currency:'EUR';availableFrom:string|null};
export function advanceShopifyToday(filters:ShopifyFilters,previous:string,next:string):ShopifyFilters{return filters.from===previous&&filters.to===previous?{...filters,from:next,to:next}:filters;}
export function shopifyMonthForecast(month:ShopifySummary,today:ShopifySummary,now:Date):ShopifySummary|null{
 const completed=now.getDate()-1;if(completed<1)return null;
 const factor=new Date(now.getFullYear(),now.getMonth()+1,0).getDate()/completed;
 const estimate={...month,profitComplete:month.profitComplete&&today.profitComplete};
 for(const key of ['grossSales','salesVat','netSales','refunds','refundGross','discounts','shippingCharged','productCost','shippingCost','paymentFees','adsCost','netProfit','profitBeforeAds'] as const)estimate[key]=month[key]==null||today[key]==null?null:(month[key]!-today[key]!)*factor;
 for(const key of ['orders','units','refundCount'] as const)estimate[key]=Math.round(Math.max(0,month[key]-today[key])*factor);
 estimate.marginPct=estimate.netProfit!=null&&estimate.netSales?estimate.netProfit/estimate.netSales*100:null;
 estimate.knownMarginPct=estimate.netSales!=null&&estimate.netSales>0&&estimate.refunds!=null
  ?(estimate.netSales-estimate.refunds-(estimate.productCost??0)-(estimate.shippingCost??0))/estimate.netSales*100:null;
 return estimate;
}
export type ShopifyCreateDraft={storeId:string;sku:string;name:string;internalSku:string;baseUnit:string;cost:string;costFrom:string;factor:string};
export function shopifyCreateParams(draft:ShopifyCreateDraft){
 const cost=draft.cost.trim()===''?null:Number(draft.cost.replace(',','.')),factor=Number(draft.factor);
 if(!draft.storeId||!draft.sku||!draft.name.trim()||!draft.internalSku.trim())throw new Error('Indica tienda, nombre y SKU.');
 if(cost!=null&&(!Number.isFinite(cost)||cost<0))throw new Error('El coste debe ser igual o superior a cero.');
 if(!Number.isFinite(factor)||factor<=0)throw new Error('El factor debe ser mayor que cero.');
 if(cost!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(draft.costFrom))throw new Error('Indica desde qué fecha se aplica el coste.');
 return {integration_account_id:draft.storeId,seller_sku:draft.sku,product_name:draft.name.trim(),internal_sku:draft.internalSku.trim(),base_unit:draft.baseUnit.trim()||'ud',unit_cost:cost,cost_from:cost==null?null:draft.costFrom,consumption_factor:factor};
}
