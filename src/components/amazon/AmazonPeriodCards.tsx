import {amazonCalendarDate} from '../../services/amazonCalendar';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { loadAmazonSummary, loadAmazonDetail, isAmazonConnectivityError, type AmazonAnalyticsFilters, type AmazonSummary, type AmazonDetail, type AmazonKpiKey } from '../../services/amazon';
import { amazonDashboardPeriods, amazonMonthForecast } from '../../services/amazonDashboard';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';

type Snapshot={data:AmazonSummary|null;error:boolean;loading:boolean;stale?:boolean;refundCount:number|null;refundGrossImpact?:number|null;refundCountError?:boolean};
const sameRange=(a:AmazonAnalyticsFilters,b:AmazonAnalyticsFilters)=>a.from===b.from&&a.to===b.to;
const dateLabel=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});
const accents=['#2563eb','#0e7490','#7c3aed','#c2410c','#475569'];
export function AmazonPeriodCards({filters,summary,currency,refreshToken,onPeriodChange,comparisonNote,visibleKpis,detail,periodOverrides={},onPeriodCustomize,calendarDay}:{filters:AmazonAnalyticsFilters;summary:AmazonSummary|null;currency:string;refreshToken:number;onPeriodChange?:(filters:AmazonAnalyticsFilters)=>void;comparisonNote?:string;visibleKpis?:AmazonKpiKey[];detail?:AmazonDetail|null;periodOverrides?:Record<string,{from:string;to:string}>;onPeriodCustomize?:(id:string,range:{from:string;to:string}|null)=>void;calendarDay?:string}){
  const now=calendarDay?amazonCalendarDate(calendarDay):new Date();
  const bases=amazonDashboardPeriods(now,filters.marketplaceIds);
  const periods=bases.map(period=>({...period,filters:{...period.filters,...(period.id==='forecast'?{}:periodOverrides[period.id])},custom:period.id!=='forecast'&&Boolean(periodOverrides[period.id])}));
  // A custom filter gets a tile too, so the active list always has an explicit period.
  const monthBase=bases.find(period=>period.id==='current_month')!;
  if(!periods.some(period=>period.id!=='forecast'&&sameRange(period.filters,filters)))periods.push({id:'selected',label:'Periodo seleccionado',filters,custom:false});
  const periodKey=periods.map(p=>p.filters.from+p.filters.to).join('|');
  const rail=useRef<HTMLDivElement>(null);
  const [snapshots,setSnapshots]=useState<Record<string,Snapshot>>({});
  const requests=useRef(new Set<string>());
  const generation=useRef(0);
  const mounted=useRef(false);
  const snapshotKey=(range:AmazonAnalyticsFilters)=>stableCacheKey('amazon:summary',range);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const [visiblePeriods,setVisiblePeriods]=useState<string[]>(['today','yesterday']);
  useEffect(()=>{
    if(typeof IntersectionObserver==='undefined'){setVisiblePeriods(periods.map(period=>period.id));return;}
    const observer=new IntersectionObserver(entries=>{
      const visible=entries.filter(entry=>entry.isIntersecting).map(entry=>(entry.target as HTMLElement).dataset.periodId!).filter(Boolean);
      if(visible.length)setVisiblePeriods(current=>Array.from(new Set([...current,...visible])));
    },{root:rail.current,rootMargin:'0px 150px'});
    rail.current?.querySelectorAll('[data-period-id]').forEach(tile=>observer.observe(tile));
    return()=>observer.disconnect();
  },[periodKey]);
  const [expanded,setExpanded]=useState<string[]>([]);
  const [editor,setEditor]=useState<{id:string;label:string;from:string;to:string}|null>(null);
  const [dateError,setDateError]=useState('');
  const editorRef=useRef<HTMLFormElement>(null);
  const dateTrigger=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{if(editor)editorRef.current?.querySelector('input')?.focus();},[editor?.id]);
  const closeEditor=()=>{setEditor(null);dateTrigger.current?.focus();};
  const [retry,setRetry]=useState(0);
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency});
  // Visibility and new selected summary objects add work without discarding
  // completed cards or restarting requests already in flight.
  useEffect(()=>{generation.current++;requests.current.clear();},[filters.marketplaceIds.join(','),refreshToken,retry]);
  useEffect(()=>{
    const requested=periods.filter(period=>period.id!=='forecast'&&visiblePeriods.includes(period.id));
    if(visiblePeriods.includes('forecast'))requested.push({...monthBase,custom:false},{...bases[0],custom:false});
    const unique=new Map(requested.map(period=>[snapshotKey(period.filters),period]));
    const currentGeneration=generation.current;
    const active=()=>mounted.current&&generation.current===currentGeneration;
    for(const [key,period] of unique){
      if(sameRange(period.filters,filters)||requests.current.has(key))continue;
      requests.current.add(key);
      const detailKey=stableCacheKey('amazon:detail',period.filters);
      const cached=readViewCache<AmazonSummary>(key);
      const cachedDetail=readViewCache<AmazonDetail>(detailKey);
      setSnapshots(current=>({...current,[key]:{
        ...current[key],data:current[key]?.data||cached,error:false,loading:true,
        refundCount:current[key]?.refundCount??cached?.refundTransactions??cachedDetail?.refundTransactions??null,
        refundGrossImpact:current[key]?.refundGrossImpact??cached?.refundGrossImpact??cachedDetail?.refundGrossImpact??null,
      }}));
      // Submit every unique summary first. A legacy refund-detail request is
      // optional follow-up work and cannot occupy a summary worker slot.
      void loadAmazonSummary(period.filters).then(data=>{
        if(!active())return;
        writeViewCache(key,data);
        setSnapshots(current=>({...current,[key]:{
          ...current[key],data,error:false,loading:false,stale:false,
          refundCount:data.refundTransactions??current[key]?.refundCount??null,
          refundGrossImpact:data.refundGrossImpact??current[key]?.refundGrossImpact??null,
        }}));
        if(data.refundTransactions!=null&&data.refundGrossImpact!=null)return;
        void loadAmazonDetail(period.filters).then(nextDetail=>{
          if(!active())return;
          writeViewCache(detailKey,nextDetail);
          setSnapshots(current=>({...current,[key]:{...current[key],refundCount:nextDetail.refundTransactions,refundGrossImpact:nextDetail.refundGrossImpact,refundCountError:false}}));
        }).catch(()=>{if(active())setSnapshots(current=>({...current,[key]:{...current[key],refundCountError:true}}));});
      }).catch(error=>{
        if(!active())return;
        setSnapshots(current=>({...current,[key]:{...current[key],error:!isAmazonConnectivityError(error),loading:false,stale:Boolean(current[key]?.data)}}));
      });
    }
  },[periodKey,filters.marketplaceIds.join(','),filters.from,filters.to,refreshToken,retry,visiblePeriods.join(',')]);
  const show=(key:AmazonKpiKey)=>!visibleKpis?.length||visibleKpis.includes(key);
  const move=(direction:number)=>rail.current?.scrollBy({left:direction*340,behavior:'smooth'});
  return <section className="amazonPeriodSection" aria-label="Comparativa rápida por periodos">
    <div className="amazonDashboardSectionHead"><div><span className="amazonSectionLabel">TABLERO</span><h2>Rentabilidad por periodo</h2></div><div className="amazonCarouselControls"><span>Desliza para ver más periodos</span><button onClick={()=>move(-1)} aria-label="Desplazar tarjetas a la izquierda"><ChevronLeft size={18}/></button><button onClick={()=>move(1)} aria-label="Desplazar tarjetas a la derecha"><ChevronRight size={18}/></button></div></div>
    <div className="amazonPeriodCarousel" ref={rail}>{periods.map((period,index)=>{
      const periodSnapshot=snapshots[snapshotKey(period.filters)];
      const forecast=period.id==='forecast';
      const matches=!forecast&&sameRange(period.filters,filters);
      const selected=matches&&periods.find(p=>p.id!=='forecast'&&sameRange(p.filters,filters))?.id===period.id;
      const monthData=sameRange(monthBase.filters,filters)?summary:snapshots[snapshotKey(monthBase.filters)]?.data;
      const todayPeriod=bases[0];
      const todayData=sameRange(todayPeriod.filters,filters)?summary:snapshots[snapshotKey(bases[0].filters)]?.data;
      const forecastData=monthData&&todayData?amazonMonthForecast(monthData,todayData,now):null;
      const monthSnapshot=snapshots[snapshotKey(monthBase.filters)];
      const todaySnapshot=snapshots[snapshotKey(todayPeriod.filters)];
      const snapshot=forecast?{
        error:Boolean(monthSnapshot?.error||todaySnapshot?.error),
        loading:(!monthData&&!monthSnapshot?.error)||(!todayData&&!todaySnapshot?.error),
        stale:Boolean(monthSnapshot?.stale||todaySnapshot?.stale),
        refundCountError:Boolean(monthSnapshot?.refundCountError||todaySnapshot?.refundCountError),
      }:periodSnapshot;
      const data=forecast?forecastData:matches?summary:periodSnapshot?.data;
      const monthRefunds=monthData?.refundTransactions??(sameRange(monthBase.filters,filters)?detail?.refundTransactions:snapshots[snapshotKey(monthBase.filters)]?.refundCount);
      const todayRefunds=todayData?.refundTransactions??(sameRange(todayPeriod.filters,filters)?detail?.refundTransactions:snapshots[snapshotKey(bases[0].filters)]?.refundCount);
      const completedDays=now.getDate()-1;
      const forecastFactor=completedDays>0?new Date(now.getFullYear(),now.getMonth()+1,0).getDate()/completedDays:0;
      const refundCount=forecast?monthRefunds!=null&&todayRefunds!=null&&completedDays>0?Math.round(Math.max(0,monthRefunds-todayRefunds)*forecastFactor):null:data?.refundTransactions??(matches?detail?.refundTransactions??periodSnapshot?.refundCount:periodSnapshot?.refundCount);
      const monthRefundGross=monthData?.refundGrossImpact??(sameRange(monthBase.filters,filters)?detail?.refundGrossImpact:snapshots[snapshotKey(monthBase.filters)]?.refundGrossImpact);
      const todayRefundGross=todayData?.refundGrossImpact??(sameRange(todayPeriod.filters,filters)?detail?.refundGrossImpact:snapshots[snapshotKey(bases[0].filters)]?.refundGrossImpact);
      const refundGross=forecast?monthRefundGross!=null&&todayRefundGross!=null&&completedDays>0?(monthRefundGross-todayRefundGross)*forecastFactor:null:data?.refundGrossImpact??(matches?detail?.refundGrossImpact??periodSnapshot?.refundGrossImpact:periodSnapshot?.refundGrossImpact);
      const more=expanded.includes(period.id);
      const metric=(value:number|null|undefined)=>value==null?'—':money.format(value);
      return <article className={`card amazonPeriodCard ${selected?'isSelected':''}`} style={{'--period-accent':accents[index%accents.length]} as CSSProperties} key={period.id} data-period-id={period.id} aria-busy={snapshot?.loading||false}>
        {onPeriodChange&&<button type="button" className="amazonPeriodSelect" aria-label={`Mostrar productos de ${period.label}`} aria-pressed={selected} aria-controls="amazon-period-products" onClick={()=>onPeriodChange(forecast?monthBase.filters:period.filters)}/>}
        <header><h3>{period.custom?'Personalizado':period.label}</h3>{forecast?<span className="amazonTileDate">{dateLabel(period.filters.from)} – {dateLabel(period.filters.to)}</span>:<button type="button" className="amazonTileDate" aria-label={`Cambiar fechas de ${period.label}`} onClick={event=>{dateTrigger.current=event.currentTarget;setDateError('');setEditor({id:period.id,label:period.label,from:period.filters.from,to:period.filters.to});}}><span>{period.filters.from===period.filters.to?dateLabel(period.filters.from):dateLabel(period.filters.from)+' – '+dateLabel(period.filters.to)}</span><CalendarDays size={14}/></button>}</header>
        <div className="amazonPeriodBody">
          {show('grossSales')&&<div className="amazonPeriodSales"><span>Ventas</span><strong>{metric(data?.grossSales)}</strong></div>}
          <dl className="amazonPeriodMetrics">
            {(show('orders')||show('units'))&&<div><dt>{show('orders')&&show('units')?'Pedidos / unidades':show('orders')?'Pedidos':'Unidades'}</dt><dd>{data?[...(show('orders')?[data.orders.toLocaleString('es-ES')]:[]),...(show('units')?[data.units.toLocaleString('es-ES')]:[])].join(' / '):'—'}</dd></div>}
            {show('refunds')&&<div><dt>Reembolsos con IVA</dt><dd data-metric="refunds">{metric(refundGross)}<small className="amazonRefundCount">{refundCount==null?snapshot?.refundCountError?'Número no disponible':'Número pendiente':refundCount.toLocaleString('es-ES')+' '+(refundCount===1?'reembolso':'reembolsos')}</small></dd></div>}
            {show('adsCost')&&<div className="amazonPeriodMetricSeparator"><dt>Publicidad diaria</dt><dd>{data&&!data.dailyAdsAvailable?'No disponible':data?.adsExcluded?'No disponible':metric(data?.adsCost==null?null:-data.adsCost)}{data&&!data.dailyAdsAvailable&&<small className="amazonRefundCount">Amazon Ads sin conectar</small>}</dd></div>}
            {show('productCost')&&<div className="amazonPeriodMetricSeparator"><dt>Coste producto</dt><dd data-metric="productCost">{metric(data?.productCost==null?null:-data.productCost)}</dd></div>}
            {show('netProfit')&&<div className="amazonPeriodProfit"><dt>Ganancia neta</dt><dd data-metric="netProfit" className={data?.netProfit!=null&&data.netProfit<0?'isNegative':'isPositive'}>{metric(data?.netProfit)}</dd></div>}
            {show('marginPct')&&<div><dt>Margen neto</dt><dd>{data?.marginPct==null?'—':data.marginPct.toLocaleString('es-ES',{maximumFractionDigits:1})+' %'}</dd></div>}
          </dl>
          <span className="amazonPeriodQuality">{forecast?'Estimación · '+(snapshot?.error?'Error al actualizar la base':data?(data.profitComplete&&data.dailyAdsAvailable)?'Base completa':'Base provisional':completedDays<1?'Sin días completos':'Cargando base'):snapshot?.stale?'Últimos datos guardados':snapshot?.loading&&data?'Actualizando…':snapshot?.error?'Error al actualizar':data?(!data.profitComplete||!data.dailyAdsAvailable)?'Provisional':'Datos completos':snapshot?.loading?'Cargando…':'Sin datos disponibles'}{data&&(!data.profitComplete||!data.dailyAdsAvailable)&&(snapshot?.stale||snapshot?.loading)&&' · Provisional'}</span>
          {selected&&show('netProfit')&&comparisonNote&&<p className="amazonTileComparison">{comparisonNote}</p>}
          {forecast&&<p className="amazonTileComparison">Media de los días completos del mes × días del mes. Al seleccionar se muestran los productos vendidos este mes.</p>}
          {more&&<p className="amazonTileComparison">Pedidos únicos de Amazon. Reembolsos por fecha de devolución. Publicidad procedente de movimientos financieros; no incluye el gasto diario de Amazon Ads. El beneficio puede cambiar al recibir comisiones y costes pendientes.</p>}
          {more&&<dl className="amazonPeriodExtra" id={`amazon-period-extra-${period.id}`}>
            <div><dt>Cargos publicitarios contabilizados</dt><dd>{metric(data?.adsCost==null?null:-data.adsCost)}</dd></div>
            <div><dt>Reembolsos sin IVA</dt><dd>{metric(data?.refunds)}</dd></div>
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
    {editor&&<div className="amazonTileDateBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeEditor();}}>
      <form ref={editorRef} className="amazonTileDateDialog" role="dialog" aria-modal="true" aria-label="Personalizar periodo" onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();closeEditor();}
        if(event.key==='Tab'){
          const controls=Array.from(editorRef.current?.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button')||[]);
          const first=controls[0],last=controls[controls.length-1];
          if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
          else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
        }
      }} onSubmit={event=>{
        event.preventDefault();
        if(!editor.from||!editor.to||editor.from>editor.to){setDateError('Selecciona un intervalo válido: Desde debe ser anterior o igual a Hasta.');return;}
        onPeriodCustomize?.(editor.id,{from:editor.from,to:editor.to});
        onPeriodChange?.({from:editor.from,to:editor.to,marketplaceIds:filters.marketplaceIds});
        closeEditor();
      }}>
        <header><div><h3>Personalizar periodo</h3><p>{editor.label} · Selecciona uno o varios días.</p></div><button type="button" onClick={closeEditor} aria-label="Cerrar fechas"><X size={18}/></button></header>
        <div className="amazonTileDateQuick">{[2,3,7].map(days=><button type="button" key={days} onClick={()=>{
          const end=new Date(editor.to+'T12:00:00Z');if(!Number.isFinite(end.getTime())){setDateError('Selecciona primero la fecha Hasta.');return;}end.setUTCDate(end.getUTCDate()-days+1);
          setEditor(current=>current?{...current,from:end.toISOString().slice(0,10)}:current);setDateError('');
        }}>{days} días</button>)}</div>
        <div className="amazonTileDateFields">
          <label>Desde<input name="from" type="date" required value={editor.from} onInput={event=>{const value=event.currentTarget.value;setEditor(current=>current?{...current,from:value}:current);}} onChange={event=>{const value=event.currentTarget.value;setEditor(current=>current?{...current,from:value}:current);}}/></label>
          <label>Hasta<input name="to" type="date" required min={editor.from} value={editor.to} onInput={event=>{const value=event.currentTarget.value;setEditor(current=>current?{...current,to:value}:current);}} onChange={event=>{const value=event.currentTarget.value;setEditor(current=>current?{...current,to:value}:current);}}/></label>
        </div>
        {dateError&&<p className="amazonDateError" role="alert">{dateError}</p>}
        <footer>{editor.id!=='selected'&&<button type="button" className="secondary" onClick={()=>{
          const base=amazonDashboardPeriods(now,filters.marketplaceIds).find(period=>period.id===editor.id);
          onPeriodCustomize?.(editor.id,null);if(base)onPeriodChange?.(base.filters);closeEditor();
        }}>Restablecer {editor.label}</button>}<button className="primary" type="submit">Aplicar periodo</button></footer>
      </form>
    </div>}
  </section>;
}
