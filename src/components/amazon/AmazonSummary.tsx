import { AmazonLoading } from './AmazonLoading';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, X } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { isAmazonConnectivityError, loadAmazonDetail, loadAmazonSeries, loadAmazonSummary, type AmazonAnalyticsFilters, type AmazonDetail, type AmazonKpiKey, type AmazonSeriesPoint, type AmazonSummary as AmazonSummaryData } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { AmazonPeriodCards } from './AmazonPeriodCards';
import { amazonComparisonRange, amazonMetricChange, amazonProfitBridge } from '../../services/amazonDashboard';
import { AmazonCompleteness } from './AmazonCompleteness';
import { AmazonProducts } from './AmazonProducts';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';
import { useSettings } from '../../context/SettingsContext';

const chartOptions=[
  {key:'netSales',label:'Ventas sin IVA',color:'#2563eb'},
  {key:'netProfit',label:'Ganancia neta',color:'#16a34a'},
  {key:'adsCost',label:'Cargos publicitarios',color:'#a855f7'},
  {key:'refunds',label:'Reembolsos',color:'#ea580c'},
];
const integer=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
function spanDays(filters:AmazonAnalyticsFilters){return Math.max(1,Math.round((new Date(`${filters.to}T00:00:00`).getTime()-new Date(`${filters.from}T00:00:00`).getTime())/86400000)+1);}
function dateRangeLabel(filters:AmazonAnalyticsFilters){const fmt=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-ES');return fmt(filters.from)+' – '+fmt(filters.to);}
function chartPeriodDate(value:unknown){
  const raw=String(value||'').slice(0,10);
  const parsed=new Date(`${raw}T12:00:00`);
  return Number.isNaN(parsed.getTime())?null:parsed;
}
function chartTickLabel(value:unknown,grain:'day'|'month'){
  const date=chartPeriodDate(value);
  if(!date)return String(value||'');
  if(grain==='month')return date.toLocaleDateString('es-ES',{month:'short',year:'2-digit'}).replace('.','');
  return date.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}).replace('.','');
}
function chartTooltipLabel(value:unknown,grain:'day'|'month'){
  const date=chartPeriodDate(value);
  if(!date)return String(value||'');
  return grain==='month'
    ?date.toLocaleDateString('es-ES',{month:'long',year:'numeric'})
    :date.toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'long',year:'numeric'});
}
function chartMoneyTick(value:unknown,currency:string){
  const amount=Number(value);
  if(!Number.isFinite(amount))return '';
  return new Intl.NumberFormat('es-ES',{
    style:'currency',
    currency,
    maximumFractionDigits:0,
    minimumFractionDigits:0,
  }).format(amount);
}
function DetailRow({label,value,note}:{label:string;value:string;note?:string}){return <div className="amazonDetailsRow"><div><span>{label}</span>{note&&<small>{note}</small>}</div><strong>{value}</strong></div>;}

export function AmazonSummary({filters,onLoaded,refreshToken=0,visibleKpis,onPeriodChange,calendarDay}:{filters:AmazonAnalyticsFilters;onLoaded?:(summary:AmazonSummaryData)=>void;refreshToken?:number;visibleKpis?:AmazonKpiKey[];onPeriodChange?:(filters:AmazonAnalyticsFilters)=>void;calendarDay?:string}){
  const {settings}=useSettings();
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:settings.amazon.consolidatedCurrency});
  const summaryCacheKey=stableCacheKey('amazon:summary',filters);
  const detailCacheKey=stableCacheKey('amazon:detail',filters);
  const seriesCacheKey=stableCacheKey('amazon:series',{...filters,grain:spanDays(filters)>93?'month':'day'});
  const [summary,setSummary]=useState<AmazonSummaryData|null>(()=>readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [detail,setDetail]=useState<AmazonDetail|null>(()=>readViewCache<AmazonDetail>(detailCacheKey));
  const [series,setSeries]=useState<AmazonSeriesPoint[]>(()=>readViewCache<AmazonSeriesPoint[]>(seriesCacheKey)||[]);
  const [periodOverrides,setPeriodOverrides]=useState<Record<string,{from:string;to:string}>>({});
  const comparisonFilters=amazonComparisonRange(filters);
  const [previous,setPrevious]=useState<AmazonSummaryData|null>(()=>readViewCache<AmazonSummaryData>(stableCacheKey('amazon:summary',comparisonFilters)));
  const [chartMetrics,setChartMetrics]=useState<string[]>(['netSales','netProfit']);
  const [comparisonLoading,setComparisonLoading]=useState(false);
  const [seriesLoading,setSeriesLoading]=useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [graphOpen,setGraphOpen]=useState(false);
  const [loading,setLoading]=useState(()=>!readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [error,setError]=useState('');
  const [retryToken,setRetryToken]=useState(0);
  const primaryRequest=useRef<Promise<AmazonSummaryData>|null>(null);
  const grain=spanDays(filters)>93?'month':'day';

  useEffect(()=>{
    let alive=true;
    const currentSummaryKey=stableCacheKey('amazon:summary',filters);
    const cachedSummary=readViewCache<AmazonSummaryData>(currentSummaryKey);
    setSummary(cachedSummary);if(cachedSummary)onLoaded?.(cachedSummary);
    setLoading(true);setError('');
    const request=loadAmazonSummary(filters);primaryRequest.current=request;
    void request.then(nextSummary=>{
      if(!alive)return;
      setSummary(nextSummary);writeViewCache(currentSummaryKey,nextSummary);onLoaded?.(nextSummary);
    }).catch(reason=>{
      if(alive&&!isAmazonConnectivityError(reason))setError(errorMessage(reason,'No se pudo cargar Amazon Analytics.'));
    }).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[filters.from,filters.to,filters.marketplaceIds.join(','),onLoaded,refreshToken,retryToken]);

  useEffect(()=>{
    let alive=true;
    const comparisonKey=stableCacheKey('amazon:summary',comparisonFilters);
    setPrevious(readViewCache<AmazonSummaryData>(comparisonKey));setComparisonLoading(true);
    // Wait for primary content before adding an optional comparison scan to
    // the read queue; Products and visible cards can start immediately.
    void primaryRequest.current?.then(async()=>{if(!alive)return;return loadAmazonSummary(comparisonFilters);}).then(value=>{
      if(alive&&value){setPrevious(value);writeViewCache(comparisonKey,value);}
    }).catch(()=>{/* Optional comparison must not delay primary content. */})
      .finally(()=>{if(alive)setComparisonLoading(false);});
    return()=>{alive=false;};
  },[comparisonFilters.from,comparisonFilters.to,filters.marketplaceIds.join(','),refreshToken,retryToken]);

  const needsRefundDetail=summary!=null&&(summary.refundTransactions==null||summary.refundGrossImpact==null);
  useEffect(()=>{
    let alive=true;
    const currentDetailKey=stableCacheKey('amazon:detail',filters);
    const cachedDetail=readViewCache<AmazonDetail>(currentDetailKey);
    setDetail(cachedDetail);
    // New summaries already contain the visible refund figures. Older RPCs
    // retain one fallback read; all other detail stays lazy.
    if(!graphOpen&&!detailsOpen&&!needsRefundDetail)return()=>{alive=false;};
    void loadAmazonDetail(filters).then(value=>{
      if(alive){setDetail(value);writeViewCache(currentDetailKey,value);}
    }).catch(reason=>{
      if(alive&&!isAmazonConnectivityError(reason))setError(errorMessage(reason,'No se pudo cargar el detalle de Amazon.'));
    });
    return()=>{alive=false;};
  },[filters.from,filters.to,filters.marketplaceIds.join(','),graphOpen,detailsOpen,needsRefundDetail,refreshToken,retryToken]);

  useEffect(()=>{
    let alive=true;
    const currentSeriesKey=stableCacheKey('amazon:series',{...filters,grain});
    const cachedSeries=readViewCache<AmazonSeriesPoint[]>(currentSeriesKey);
    setSeries(cachedSeries||[]);setSeriesLoading(false);
    if(!graphOpen)return()=>{alive=false;};
    setSeriesLoading(true);
    void loadAmazonSeries(filters,grain).then(value=>{
      if(alive){setSeries(value);writeViewCache(currentSeriesKey,value);}
    }).catch(reason=>{
      if(alive&&!isAmazonConnectivityError(reason))setError(errorMessage(reason,'No se pudo cargar la evolución de Amazon.'));
    }).finally(()=>{if(alive)setSeriesLoading(false);});
    return()=>{alive=false;};
  },[filters.from,filters.to,filters.marketplaceIds.join(','),grain,graphOpen,refreshToken,retryToken]);

  const profitChange=amazonMetricChange(summary?.netProfit,previous?.netProfit);
  const comparisonNote=!previous?comparisonLoading?'Comparando con el periodo anterior…':undefined
    :`Ganancia vs. anterior: ${profitChange==null?'sin base comparable':(profitChange>0?'+':'')+profitChange.toLocaleString('es-ES',{maximumFractionDigits:1})+' %'} · ${dateRangeLabel(comparisonFilters)}`;
  const effectiveChartMetrics=chartMetrics.filter(key=>key!=='adsCost'||!summary?.adsExcluded);
  if(!effectiveChartMetrics.length)effectiveChartMetrics.push('netSales');

  return <div className="amazonSummary">
    {loading&&<AmazonLoading>Cargando resumen de Amazon…</AmazonLoading>}
    {error&&<div className="card amazonQueryError"><span>{error}</span><button className="secondary" onClick={()=>setRetryToken(value=>value+1)}><RefreshCw size={15}/> Reintentar</button></div>}
    <AmazonPeriodCards summaryLoading={loading} calendarDay={calendarDay} filters={filters} summary={summary} currency={settings.amazon.consolidatedCurrency} refreshToken={refreshToken} onPeriodChange={onPeriodChange} comparisonNote={comparisonNote} visibleKpis={visibleKpis} detail={detail} periodOverrides={periodOverrides} onPeriodCustomize={(id,range)=>setPeriodOverrides(current=>{const next={...current};if(range)next[id]=range;else delete next[id];return next;})}/>
    <AmazonProducts key={`${filters.from}:${filters.to}:${filters.marketplaceIds.join(',')}`} filters={filters} embedded refreshToken={refreshToken}/>
    {summary&&<details className="amazonDashboardDetails" onToggle={event=>setGraphOpen(event.currentTarget.open)}><summary>Gráfica y desglose del periodo · {dateRangeLabel(filters)}</summary>
    <div className="amazonDashboardSectionHead amazonSelectedPeriodHead"><div><span className="amazonSectionLabel">PERIODO SELECCIONADO</span><h2>{dateRangeLabel(filters)}</h2></div><button className="amazonMoreButton" onClick={()=>setDetailsOpen(true)}>Más detalles <ChevronRight size={15}/></button></div>
    <AmazonCompleteness data={summary}/>
    {detailsOpen&&<div className="amazonDetailsBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setDetailsOpen(false)}}>
      <section className="amazonDetailsModal" role="dialog" aria-modal="true" aria-label="Detalle de Amazon">
        <header className="amazonDetailsHead">
          <div><span className="amazonSectionLabel">DETALLE DEL PERIODO</span><h3>Amazon · {dateRangeLabel(filters)}</h3><p>Desglose de los datos que ZENVIA está utilizando en el resumen.</p></div>
          <button onClick={()=>setDetailsOpen(false)} aria-label="Cerrar"><X size={18}/></button>
        </header>
        <div className="amazonDetailsBody">
          <section><h4>Ventas y actividad</h4>
            <DetailRow label="Ventas" value={money.format(summary.grossSales)}/>
            <DetailRow label="Ventas sin IVA" value={money.format(summary.netSales)}/>
            <DetailRow label="IVA ventas" value={money.format(summary.salesVat)}/>
            <DetailRow label="Pedidos únicos" value={integer.format(summary.orders)}/>
            <DetailRow label="Líneas de pedido" value={detail?integer.format(detail.orderLines):'—'} note="Una misma orden puede contener varias líneas/SKU."/>
            <DetailRow label="Pedidos B2B" value={integer.format(summary.businessOrders||0)}/>
            <DetailRow label="Unidades vendidas" value={integer.format(summary.units)}/>
            <DetailRow label="Promociones registradas" value={detail?money.format(-detail.promotionDiscounts):'—'}/>
            <DetailRow label="Envío cobrado al cliente" value={detail?money.format(detail.shippingCharged):'—'} note="No es el coste logístico."/>
          </section>
          <section><h4>Tarifas Amazon</h4>
            <DetailRow label="Tarifas Amazon sin IVA" value={money.format(summary.amazonFees)}/>
            <DetailRow label="Comisiones" value={detail?money.format(detail.commissionFees):'—'}/>
            <DetailRow label="Tarifas FBA" value={detail?money.format(detail.fbaFees):'—'}/>
            <DetailRow label="Digital Services Fee" value={detail?money.format(detail.digitalServicesFees):'—'}/>
            <DetailRow label="Almacenamiento" value={detail?money.format(detail.storageFees):'—'}/>
            <DetailRow label="Otras tarifas Amazon" value={detail?money.format(detail.otherAmazonFees):'—'}/>
            <DetailRow label="IVA soportado tarifas" value={money.format(summary.amazonFeeVat)}/>
            <DetailRow label="Publicidad diaria" value={summary.dailyAdsAvailable?money.format(summary.adsCost):'No disponible'} note={summary.dailyAdsAvailable?undefined:'Amazon Ads sin conectar: SP-API no aporta el gasto diario de campañas.'}/><DetailRow label="Cargos publicitarios contabilizados" value={money.format(summary.adsCost)} note="Movimientos financieros; no equivalen al gasto diario de Amazon Ads."/>
          </section>
          <section><h4>Reembolsos</h4>
            <DetailRow label="Operaciones de reembolso" value={detail?integer.format(detail.refundTransactions):'—'} note="Transacciones financieras únicas detectadas por Amazon."/>
            <DetailRow label="Pedidos con reembolso" value={detail?integer.format(detail.refundOrders):'—'}/>
            <DetailRow label="Impacto neto sin IVA" value={money.format(summary.refunds)}/>
            <DetailRow label="Impacto bruto" value={detail?money.format(detail.refundGrossImpact):'—'}/>
            <DetailRow label="IVA asociado" value={detail?money.format(detail.refundTaxImpact):'—'}/>
          </section>
          <section><h4>Costes y rentabilidad</h4>
            <DetailRow label="Coste de producto" value={money.format(summary.productCost)} note={summary.unmappedUnits?integer.format(summary.unmappedUnits)+' uds. todavía sin coste vinculado.':undefined}/>
            <DetailRow label="Coste envíos FBM" value={money.format(summary.fbmShippingCost)}/>
            <DetailRow label="Ajustes Amazon" value={money.format(summary.amazonAdjustments)}/>
            <DetailRow label="Ganancia neta" value={summary.netProfit==null?'—':money.format(summary.netProfit)} note={(!summary.profitComplete||!summary.dailyAdsAvailable)?'Provisional por datos pendientes.':undefined}/>
            <DetailRow label="Margen neto" value={summary.marginPct==null?'—':summary.marginPct.toFixed(2)+' %'}/>
          </section>
          <section><h4>Calidad del dato</h4>
            <DetailRow label="SKU sin vincular" value={integer.format(summary.unmappedSkuCount)}/>
            <DetailRow label="Unidades sin vincular" value={integer.format(summary.unmappedUnits)}/>
            <DetailRow label="Pedidos con IVA pendiente" value={integer.format(summary.missingVatOrderCount)}/>
            <DetailRow label="FBM sin coste de envío" value={integer.format(summary.missingFbmShippingCostCount)}/>
            <DetailRow label="Sincronizaciones en cola" value={integer.format(summary.syncQueued)}/>
            <DetailRow label="Sincronizaciones ejecutándose" value={integer.format(summary.syncRunning)}/>
            <DetailRow label="Sincronizaciones con error" value={integer.format(summary.syncFailed)}/>
          </section>
        </div>
      </section>
    </div>}

    <div className="amazonAnalyticsGrid">
      <section className="card amazonChartCard">
        <div className="amazonCardHeading"><div><span className="amazonSectionLabel">EVOLUCIÓN</span><strong>Ventas, costes y ganancia</strong></div><span className="amazonCountBadge">{grain==='day'?'Diario':'Mensual'}</span></div>
        {seriesLoading&&<AmazonLoading>Cargando evolución…</AmazonLoading>}
        <div className="amazonChartOptions" aria-label="Métricas de la gráfica">{chartOptions.map(option=><label key={option.key} style={{'--metric-color':option.color} as React.CSSProperties}><input type="checkbox" checked={effectiveChartMetrics.includes(option.key)} disabled={(option.key==='adsCost'&&summary.adsExcluded)||(effectiveChartMetrics.length===1&&effectiveChartMetrics.includes(option.key))} onChange={()=>setChartMetrics(current=>current.includes(option.key)?current.filter(key=>key!==option.key):[...current,option.key])}/><span>{option.label}</span></label>)}</div>
        {series.length?<div className="amazonChart"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{top:8,right:16,bottom:0,left:10}}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="period" tickFormatter={value=>chartTickLabel(value,grain)} interval="preserveStartEnd" minTickGap={34}/><YAxis width={86} domain={['auto','auto']} tickFormatter={value=>chartMoneyTick(value,settings.amazon.consolidatedCurrency)}/><Tooltip labelFormatter={value=>chartTooltipLabel(value,grain)} formatter={(value:any)=>value==null?'—':money.format(Number(value))}/><Legend/>
          {effectiveChartMetrics.includes('netSales')&&<Line type="monotone" dataKey="netSales" name="Ventas sin IVA" stroke="#2563eb" strokeWidth={2.5} dot={false}/>}
          {effectiveChartMetrics.includes('netProfit')&&<Line type="monotone" dataKey="netProfit" name="Ganancia neta" stroke="#16a34a" strokeWidth={2.5} dot={false} connectNulls={false}/>}
          {effectiveChartMetrics.includes('adsCost')&&<Line type="monotone" dataKey="adsCost" name="Cargos publicitarios" stroke="#a855f7" strokeWidth={2} dot={false}/>}
          {effectiveChartMetrics.includes('refunds')&&<Line type="monotone" dataKey="refunds" name="Reembolsos" stroke="#ea580c" strokeWidth={2} dot={false}/>}
        </LineChart></ResponsiveContainer></div>:<div className="amazonChartEmpty">{seriesLoading?'Cargando evolución…':'No hay datos de evolución disponibles para este periodo.'}</div>}
      </section>
      <section className="card amazonProfitStatement">
        <div className="amazonCardHeading"><div><span className="amazonSectionLabel">CUENTA DE RESULTADOS</span><strong>De las ventas al beneficio</strong></div></div>
        <div className="amazonProfitBridge">{amazonProfitBridge(summary).map(row=><div key={row.key} className={`amazonProfitBridgeRow is-${row.kind}`}><span>{row.label}</span><strong className={row.amount!=null&&row.amount<0?'isNegative':row.kind==='total'?'isPositive':''}>{row.key==='adsCost'&&summary.adsExcluded?'No disponible':row.amount==null?'—':(row.kind==='movement'&&row.amount>0&&row.key!=='grossSales'?'+':'')+money.format(row.amount)}</strong></div>)}</div>
        <div className="amazonStatementFoot"><span>Margen neto</span><strong>{summary.marginPct==null?'—':summary.marginPct.toLocaleString('es-ES',{maximumFractionDigits:1})+' %'}</strong></div>
        <p className="amazonStatementNote">{(!summary.profitComplete||!summary.dailyAdsAvailable)?'Resultado provisional por datos pendientes y gasto diario de publicidad sin verificar. ':''}El IVA recuperable de las tarifas ({money.format(summary.amazonFeeVat)}) se muestra en el detalle y no se resta de nuevo al beneficio.</p>
      </section>
    </div>

    </details>}

  </div>;
}
