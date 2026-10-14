import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { loadAmazonSummary, isAmazonConnectivityError, type AmazonAnalyticsFilters, type AmazonSummary } from '../../services/amazon';
import { amazonDashboardPeriods } from '../../services/amazonDashboard';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';

type Snapshot={data:AmazonSummary|null;error:boolean;loading:boolean};
const sameRange=(a:AmazonAnalyticsFilters,b:AmazonAnalyticsFilters)=>a.from===b.from&&a.to===b.to;
const dateLabel=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'});
export function AmazonPeriodCards({filters,summary,currency,refreshToken,onPeriodChange}:{filters:AmazonAnalyticsFilters;summary:AmazonSummary;currency:string;refreshToken:number;onPeriodChange?:(filters:AmazonAnalyticsFilters)=>void}){
  const periods=amazonDashboardPeriods(new Date(),filters.marketplaceIds);
  const periodKey=periods.map(p=>p.filters.from+p.filters.to).join('|');
  const [snapshots,setSnapshots]=useState<Record<string,Snapshot>>({});
  const [retry,setRetry]=useState(0);
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency});
  useEffect(()=>{
    let alive=true;
    const initial:Record<string,Snapshot>={};
    for(const period of periods){
      const data=sameRange(period.filters,filters)?summary:readViewCache<AmazonSummary>(stableCacheKey('amazon:summary',period.filters));
      initial[period.id]={data,error:false,loading:!data};
    }
    setSnapshots(initial);
    // Keep the selected period immediate; at most two extra summaries in flight.
    const pending=periods.filter(period=>!sameRange(period.filters,filters));
    let index=0;
    const worker=async()=>{
      while(alive&&index<pending.length){
        const period=pending[index++];
        try{
          const data=await loadAmazonSummary(period.filters);
          if(!alive)return;
          writeViewCache(stableCacheKey('amazon:summary',period.filters),data);
          setSnapshots(current=>({...current,[period.id]:{data,error:false,loading:false}}));
        }catch(error){
          if(!alive)return;
          setSnapshots(current=>({...current,[period.id]:{data:current[period.id]?.data||null,error:!isAmazonConnectivityError(error),loading:false}}));
        }
      }
    };
    void Promise.all([worker(),worker()]);
    return()=>{alive=false;};
  },[periodKey,filters.marketplaceIds.join(','),filters.from,filters.to,summary,refreshToken,retry]);
  return <section className="amazonPeriodSection" aria-label="Comparativa rápida por periodos">
    <div className="amazonDashboardSectionHead"><div><span className="amazonSectionLabel">VISTA RÁPIDA</span><h2>Tu negocio, de un vistazo</h2></div><span>Según los marketplaces seleccionados</span></div>
    <div className="amazonPeriodGrid">{periods.map(period=>{
      const snapshot=snapshots[period.id];
      const data=sameRange(period.filters,filters)?summary:snapshot?.data;
      const selected=sameRange(period.filters,filters);
      const metric=(value:number|null|undefined)=>value==null?'—':money.format(value);
      return <article className={`card amazonPeriodCard ${selected?'isSelected':''}`} key={period.id} aria-busy={snapshot?.loading||false}>
        <header><h3>{period.label}</h3><span>{period.filters.from===period.filters.to?dateLabel(period.filters.from):dateLabel(period.filters.from)+' – '+dateLabel(period.filters.to)}</span></header>
        <div className="amazonPeriodSales"><span>Ventas</span><strong>{metric(data?.grossSales)}</strong></div>
        <dl>
          <div className="amazonPeriodProfit"><dt>Ganancia neta</dt><dd className={data?.netProfit!=null&&data.netProfit<0?'isNegative':'isPositive'}>{metric(data?.netProfit)}</dd></div>
          <div><dt>Margen</dt><dd>{data?.marginPct==null?'—':data.marginPct.toLocaleString('es-ES',{maximumFractionDigits:1})+' %'}</dd></div>
          <div><dt>Pedidos / unidades</dt><dd>{data?data.orders.toLocaleString('es-ES')+' / '+data.units.toLocaleString('es-ES'):'—'}</dd></div>
          <div><dt>Publicidad</dt><dd>{data?.adsExcluded?'No disponible':metric(data?.adsCost)}</dd></div>
          <div><dt>Reembolsos</dt><dd>{metric(data?.refunds)}</dd></div>
        </dl>
        <footer><span className="amazonPeriodQuality">{snapshot?.error?'Error al actualizar':data?!data.profitComplete?'Provisional':'Datos completos':snapshot?.loading?'Cargando…':'Sin datos disponibles'}</span>
          {snapshot?.error?<button className="amazonPeriodAction" onClick={()=>setRetry(value=>value+1)} aria-label={`Reintentar ${period.label}`}><RefreshCw size={13}/></button>:onPeriodChange&&<button className="amazonPeriodAction" aria-pressed={selected} onClick={()=>onPeriodChange(period.filters)}>{selected?'Seleccionado':'Ver periodo'}<ArrowUpRight size={13}/></button>}
        </footer>
      </article>;
    })}</div>
  </section>;
}
