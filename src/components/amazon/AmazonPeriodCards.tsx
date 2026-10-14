import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { loadAmazonSummary, isAmazonConnectivityError, type AmazonAnalyticsFilters, type AmazonSummary, type AmazonKpiKey } from '../../services/amazon';
import { amazonDashboardPeriods } from '../../services/amazonDashboard';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';

type Snapshot={data:AmazonSummary|null;error:boolean;loading:boolean;stale?:boolean};
const sameRange=(a:AmazonAnalyticsFilters,b:AmazonAnalyticsFilters)=>a.from===b.from&&a.to===b.to;
const dateLabel=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});
const accents=['#2563eb','#0e7490','#7c3aed','#c2410c','#475569'];
export function AmazonPeriodCards({filters,summary,currency,refreshToken,onPeriodChange,comparisonNote,visibleKpis}:{filters:AmazonAnalyticsFilters;summary:AmazonSummary;currency:string;refreshToken:number;onPeriodChange?:(filters:AmazonAnalyticsFilters)=>void;comparisonNote?:string;visibleKpis?:AmazonKpiKey[]}){
  const periods=amazonDashboardPeriods(new Date(),filters.marketplaceIds);
  // A custom filter gets a tile too, so the active list always has an explicit period.
  if(!periods.some(period=>sameRange(period.filters,filters)))periods.push({id:'selected',label:'Periodo seleccionado',filters});
  const periodKey=periods.map(p=>p.filters.from+p.filters.to).join('|');
  const rail=useRef<HTMLDivElement>(null);
  const [snapshots,setSnapshots]=useState<Record<string,Snapshot>>({});
  const [expanded,setExpanded]=useState<string[]>([]);
  const [retry,setRetry]=useState(0);
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency});
  useEffect(()=>{
    let alive=true;
    const initial:Record<string,Snapshot>={};
    for(const period of periods){
      const selected=sameRange(period.filters,filters);
      const data=selected?summary:readViewCache<AmazonSummary>(stableCacheKey('amazon:summary',period.filters));
      initial[period.id]={data,error:false,loading:!selected};
    }
    setSnapshots(initial);
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
          setSnapshots(current=>({...current,[period.id]:{data:current[period.id]?.data||null,error:!isAmazonConnectivityError(error),loading:false,stale:true}}));
        }
      }
    };
    void Promise.all([worker(),worker()]);
    return()=>{alive=false;};
  },[periodKey,filters.marketplaceIds.join(','),filters.from,filters.to,summary,refreshToken,retry]);
  const show=(key:AmazonKpiKey)=>!visibleKpis?.length||visibleKpis.includes(key);
  const move=(direction:number)=>rail.current?.scrollBy({left:direction*340,behavior:'smooth'});
  return <section className="amazonPeriodSection" aria-label="Comparativa rápida por periodos">
    <div className="amazonDashboardSectionHead"><div><span className="amazonSectionLabel">TABLERO</span><h2>Rentabilidad por periodo</h2></div><div className="amazonCarouselControls"><span>Desliza para ver más periodos</span><button onClick={()=>move(-1)} aria-label="Desplazar tarjetas a la izquierda"><ChevronLeft size={18}/></button><button onClick={()=>move(1)} aria-label="Desplazar tarjetas a la derecha"><ChevronRight size={18}/></button></div></div>
    <div className="amazonPeriodCarousel" ref={rail}>{periods.map((period,index)=>{
      const snapshot=snapshots[period.id];
      const selected=sameRange(period.filters,filters);
      const data=selected?summary:snapshot?.data;
      const more=expanded.includes(period.id);
      const metric=(value:number|null|undefined)=>value==null?'—':money.format(value);
      return <article className={`card amazonPeriodCard ${selected?'isSelected':''}`} style={{'--period-accent':accents[index%accents.length]} as CSSProperties} key={period.id} aria-busy={snapshot?.loading||false}>
        {onPeriodChange&&<button type="button" className="amazonPeriodSelect" aria-label={`Mostrar productos de ${period.label}`} aria-pressed={selected} aria-controls="amazon-period-products" onClick={()=>onPeriodChange(period.filters)}/>}
        <header><h3>{period.label}</h3><span>{period.filters.from===period.filters.to?dateLabel(period.filters.from):dateLabel(period.filters.from)+' – '+dateLabel(period.filters.to)}</span></header>
        <div className="amazonPeriodBody">
          {show('grossSales')&&<div className="amazonPeriodSales"><span>Ventas</span><strong>{metric(data?.grossSales)}</strong></div>}
          <dl className="amazonPeriodMetrics">
            {(show('orders')||show('units'))&&<div><dt>{show('orders')&&show('units')?'Pedidos / unidades':show('orders')?'Pedidos':'Unidades'}</dt><dd>{data?[...(show('orders')?[data.orders.toLocaleString('es-ES')]:[]),...(show('units')?[data.units.toLocaleString('es-ES')]:[])].join(' / '):'—'}</dd></div>}
            {show('refunds')&&<div><dt>Reembolsos</dt><dd data-metric="refunds">{metric(data?.refunds)}</dd></div>}
            {show('adsCost')&&<div className="amazonPeriodMetricSeparator"><dt>Publicidad</dt><dd>{data?.adsExcluded?'No disponible':metric(data?.adsCost==null?null:-data.adsCost)}</dd></div>}
            {show('productCost')&&<div className="amazonPeriodMetricSeparator"><dt>Coste producto</dt><dd data-metric="productCost">{metric(data?.productCost==null?null:-data.productCost)}</dd></div>}
            {show('netProfit')&&<div className="amazonPeriodProfit"><dt>Ganancia neta</dt><dd data-metric="netProfit" className={data?.netProfit!=null&&data.netProfit<0?'isNegative':'isPositive'}>{metric(data?.netProfit)}</dd></div>}
            {show('marginPct')&&<div><dt>Margen neto</dt><dd>{data?.marginPct==null?'—':data.marginPct.toLocaleString('es-ES',{maximumFractionDigits:1})+' %'}</dd></div>}
          </dl>
          <span className="amazonPeriodQuality">{snapshot?.stale?'Últimos datos guardados':snapshot?.loading&&data?'Actualizando…':snapshot?.error?'Error al actualizar':data?!data.profitComplete?'Provisional':'Datos completos':snapshot?.loading?'Cargando…':'Sin datos disponibles'}{data&&!data.profitComplete&&(snapshot?.stale||snapshot?.loading)&&' · Provisional'}</span>
          {selected&&show('netProfit')&&comparisonNote&&<p className="amazonTileComparison">{comparisonNote}</p>}
          {more&&<dl className="amazonPeriodExtra" id={`amazon-period-extra-${period.id}`}>
            <div><dt>Ventas sin IVA</dt><dd>{metric(data?.netSales)}</dd></div>
            <div><dt>IVA ventas</dt><dd>{metric(data?.salesVat)}</dd></div>
            <div><dt>Tarifas Amazon sin IVA</dt><dd>{metric(data?.amazonFees==null?null:-data.amazonFees)}</dd></div>
            <div><dt>Coste envíos FBM</dt><dd>{metric(data?.fbmShippingCost==null?null:-data.fbmShippingCost)}</dd></div>
            <div><dt>Ajustes Amazon</dt><dd>{metric(data?.amazonAdjustments)}</dd></div>
            <div><dt>IVA recuperable de tarifas</dt><dd>{metric(data?.amazonFeeVat)}</dd></div>
            <div><dt>Pedidos B2B</dt><dd>{data?(data.businessOrders||0).toLocaleString('es-ES'):'—'}</dd></div>
          </dl>}
        </div>
        <footer><button type="button" className="amazonPeriodMore" aria-expanded={more} aria-controls={`amazon-period-extra-${period.id}`} onClick={()=>setExpanded(current=>more?current.filter(id=>id!==period.id):[...current,period.id])}>{more?'Menos':'Más'}<ChevronRight size={14}/></button>{snapshot?.error&&<button type="button" className="amazonPeriodAction" onClick={()=>setRetry(value=>value+1)} aria-label={`Reintentar ${period.label}`}><RefreshCw size={14}/></button>}</footer>
      </article>;
    })}</div>
  </section>;
}
