import type { AmazonAnalyticsFilters, AmazonSummary } from './amazon';

const dayMs=86_400_000;
const parse=(value:string)=>new Date(`${value}T12:00:00Z`);
const iso=(date:Date)=>date.toISOString().slice(0,10);
const shift=(date:Date,days:number)=>new Date(date.getTime()+days*dayMs);

export function amazonComparisonRange(filters:AmazonAnalyticsFilters):AmazonAnalyticsFilters{
  const start=parse(filters.from),end=parse(filters.to);
  if(filters.from!==filters.to&&start.getUTCDate()===1&&start.getUTCMonth()===end.getUTCMonth()&&start.getUTCFullYear()===end.getUTCFullYear()){
    const previousEnd=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),0,12));
    const currentEnd=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0,12));
    const lastDay=end.getUTCDate()===currentEnd.getUTCDate()?previousEnd.getUTCDate():Math.min(end.getUTCDate(),previousEnd.getUTCDate());
    return {...filters,from:iso(new Date(Date.UTC(previousEnd.getUTCFullYear(),previousEnd.getUTCMonth(),1,12))),to:iso(new Date(Date.UTC(previousEnd.getUTCFullYear(),previousEnd.getUTCMonth(),lastDay,12)))};
  }
  const days=Math.max(1,Math.round((end.getTime()-start.getTime())/dayMs)+1);
  return {...filters,from:iso(shift(start,-days)),to:iso(shift(start,-1))};
}

export function amazonDashboardPeriods(now:Date,marketplaceIds:string[]){
  const today=new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate(),12));
  const monthStart=new Date(Date.UTC(now.getFullYear(),now.getMonth(),1,12));
  const previousEnd=shift(monthStart,-1);
  return [
    {id:'today',label:'Hoy',from:today,to:today},
    {id:'yesterday',label:'Ayer',from:shift(today,-1),to:shift(today,-1)},
    {id:'current_month',label:'Mes actual',from:monthStart,to:today},
    {id:'forecast',label:'Mes actual (pronóstico)',from:monthStart,to:new Date(Date.UTC(now.getFullYear(),now.getMonth()+1,0,12))},
    {id:'previous_month',label:'Mes anterior',from:new Date(Date.UTC(previousEnd.getUTCFullYear(),previousEnd.getUTCMonth(),1,12)),to:previousEnd},
  ].map(period=>({id:period.id,label:period.label,filters:{from:iso(period.from),to:iso(period.to),marketplaceIds}}));
}

export function amazonMetricChange(current:number|null|undefined,previous:number|null|undefined){
  if(current==null||previous==null||!Number.isFinite(current)||!Number.isFinite(previous))return null;
  if(previous===0)return current===0?0:null;
  return (current-previous)/Math.abs(previous)*100;
}

export type AmazonProfitBridgeRow={key:string;label:string;amount:number|null;kind:'movement'|'subtotal'|'total'};
export function amazonProfitBridge(summary:Pick<AmazonSummary,'grossSales'|'salesVat'|'netSales'|'amazonFees'|'refunds'|'adsCost'|'amazonAdjustments'|'productCost'|'fbmShippingCost'|'netProfit'>):AmazonProfitBridgeRow[]{
  return [
    {key:'grossSales',label:'Ventas con IVA',amount:summary.grossSales,kind:'movement'},
    {key:'salesVat',label:'IVA de las ventas',amount:-summary.salesVat,kind:'movement'},
    {key:'netSales',label:'Ventas sin IVA',amount:summary.netSales,kind:'subtotal'},
    {key:'amazonFees',label:'Tarifas Amazon sin IVA',amount:-summary.amazonFees,kind:'movement'},
    {key:'productCost',label:'Coste producto',amount:-summary.productCost,kind:'movement'},
    {key:'fbmShippingCost',label:'Coste envíos FBM',amount:-summary.fbmShippingCost,kind:'movement'},
    {key:'adsCost',label:'Cargos publicitarios contabilizados',amount:-summary.adsCost,kind:'movement'},
    {key:'refunds',label:'Reembolsos sin IVA',amount:-summary.refunds,kind:'movement'},
    {key:'amazonAdjustments',label:'Ajustes Amazon',amount:summary.amazonAdjustments,kind:'movement'},
    {key:'netProfit',label:'Ganancia neta',amount:summary.netProfit,kind:'total'},
  ];
}

// Exclude the unfinished current day so refreshing at noon does not halve the forecast.
export function amazonMonthForecast(month:AmazonSummary,today:AmazonSummary,now:Date):AmazonSummary|null{
  const completed=now.getDate()-1;
  if(completed<1)return null;
  const factor=new Date(now.getFullYear(),now.getMonth()+1,0).getDate()/completed;
  const estimate={...month};
  const moneyKeys=['grossSales','salesVat','netSales','amazonFees','amazonFeeVat','refunds','adsCost','amazonAdjustments','productCost','fbmShippingCost','netProfit'] as const;
  for(const key of moneyKeys){const value=month[key],daily=today[key];if(key==='netProfit')estimate.netProfit=value==null||daily==null?null:(value-daily)*factor;else estimate[key]=(value!-daily!)*factor;}
  for(const key of ['orders','businessOrders','units'] as const)estimate[key]=Math.round(Math.max(0,month[key]-today[key])*factor);
  estimate.marginPct=estimate.netSales&&estimate.netProfit!=null?estimate.netProfit/estimate.netSales*100:null;
  return estimate;
}
