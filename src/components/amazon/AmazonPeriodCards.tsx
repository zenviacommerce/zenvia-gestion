import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { loadAmazonSummary, loadAmazonDetail, isAmazonConnectivityError, type AmazonAnalyticsFilters, type AmazonSummary, type AmazonDetail, type AmazonKpiKey } from '../../services/amazon';
import { amazonDashboardPeriods } from '../../services/amazonDashboard';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';

type Snapshot={data:AmazonSummary|null;error:boolean;loading:boolean;stale?:boolean;refundCount:number|null;refundCountError?:boolean};
const sameRange=(a:AmazonAnalyticsFilters,b:AmazonAnalyticsFilters)=>a.from===b.from&&a.to===b.to;
const dateLabel=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});
const accents=['#2563eb','#0e7490','#7c3aed','#c2410c','#475569'];
export function AmazonPeriodCards({filters,summary,currency,refreshToken,onPeriodChange,comparisonNote,visibleKpis,detail,periodOverrides={},onPeriodCustomize}:{filters:AmazonAnalyticsFilters;summary:AmazonSummary;currency:string;refreshToken:number;onPeriodChange?:(filters:AmazonAnalyticsFilters)=>void;comparisonNote?:string;visibleKpis?:AmazonKpiKey[];detail?:AmazonDetail|null;periodOverrides?:Record<string,{from:string;to:string}>;onPeriodCustomize?:(id:string,range:{from:string;to:string}|null)=>void}){
  const periods=amazonDashboardPeriods(new Date(),filters.marketplaceIds).map(period=>({...period,filters:{...period.filters,...periodOverrides[period.id]},custom:Boolean(periodOverrides[period.id])}));
  // A custom filter gets a tile too, so the active list always has an explicit period.
  if(!periods.some(period=>sameRange(period.filters,filters)))periods.push({id:'selected',label:'Periodo seleccionado',filters,custom:false});
  const periodKey=periods.map(p=>p.filters.from+p.filters.to).join('|');
  const rail=useRef<HTMLDivElement>(null);
  const [snapshots,setSnapshots]=useState<Record<string,Snapshot>>({});
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
  useEffect(()=>{
    let alive=true;
    const initial:Record<string,Snapshot>={};
    for(const period of periods){
      const selected=sameRange(period.filters,filters);
      const data=selected?summary:readViewCache<AmazonSummary>(stableCacheKey('amazon:summary',period.filters));
      const cachedDetail=readViewCache<AmazonDetail>(stableCacheKey('amazon:detail',period.filters));
      initial[period.id]={data,error:false,loading:!selected,refundCount:cachedDetail?.refundTransactions??null};
    }
    setSnapshots(initial);
    const pending=periods.filter(period=>visiblePeriods.includes(period.id)&&!sameRange(period.filters,filters));
    let index=0;
    const worker=async()=>{
      while(alive&&index<pending.length){
        const period=pending[index++];
        try{
          const data=await loadAmazonSummary(period.filters);
          if(!alive)return;
          writeViewCache(stableCacheKey('amazon:summary',period.filters),data);
          setSnapshots(current=>({...current,[period.id]:{data,error:false,loading:false,refundCount:current[period.id]?.refundCount??null}}));
          try{
            const nextDetail=await loadAmazonDetail(period.filters);
            if(!alive)return;
            writeViewCache(stableCacheKey('amazon:detail',period.filters),nextDetail);
            setSnapshots(current=>({...current,[period.id]:{...current[period.id],refundCount:nextDetail.refundTransactions,refundCountError:false}}));
          }catch{if(alive)setSnapshots(current=>({...current,[period.id]:{...current[period.id],refundCountError:true}}));}
        }catch(error){
          if(!alive)return;
          setSnapshots(current=>({...current,[period.id]:{data:current[period.id]?.data||null,error:!isAmazonConnectivityError(error),loading:false,stale:true,refundCount:current[period.id]?.refundCount??null}}));
        }
      }
    };
    void Promise.all([worker(),worker()]);
    return()=>{alive=false;};
  },[periodKey,filters.marketplaceIds.join(','),filters.from,filters.to,summary,refreshToken,retry,visiblePeriods.join(',')]);
  const show=(key:AmazonKpiKey)=>!visibleKpis?.length||visibleKpis.includes(key);
  const move=(direction:number)=>rail.current?.scrollBy({left:direction*340,behavior:'smooth'});
  return <section className="amazonPeriodSection" aria-label="Comparativa rápida por periodos">
    <div className="amazonDashboardSectionHead"><div><span className="amazonSectionLabel">TABLERO</span><h2>Rentabilidad por periodo</h2></div><div className="amazonCarouselControls"><span>Desliza para ver más periodos</span><button onClick={()=>move(-1)} aria-label="Desplazar tarjetas a la izquierda"><ChevronLeft size={18}/></button><button onClick={()=>move(1)} aria-label="Desplazar tarjetas a la derecha"><ChevronRight size={18}/></button></div></div>
    <div className="amazonPeriodCarousel" ref={rail}>{periods.map((period,index)=>{
      const snapshot=snapshots[period.id];
      const matches=sameRange(period.filters,filters);
      const selected=matches&&periods.find(p=>sameRange(p.filters,filters))?.id===period.id;
      const data=matches?summary:snapshot?.data;
      const refundCount=matches?detail?.refundTransactions??snapshot?.refundCount:snapshot?.refundCount;
      const more=expanded.includes(period.id);
      const metric=(value:number|null|undefined)=>value==null?'—':money.format(value);
      return <article className={`card amazonPeriodCard ${selected?'isSelected':''}`} style={{'--period-accent':accents[index%accents.length]} as CSSProperties} key={period.id} data-period-id={period.id} aria-busy={snapshot?.loading||false}>
        {onPeriodChange&&<button type="button" className="amazonPeriodSelect" aria-label={`Mostrar productos de ${period.label}`} aria-pressed={selected} aria-controls="amazon-period-products" onClick={()=>onPeriodChange(period.filters)}/>}
        <header><h3>{period.custom?'Personalizado':period.label}</h3><button type="button" className="amazonTileDate" aria-label={`Cambiar fechas de ${period.label}`} onClick={event=>{dateTrigger.current=event.currentTarget;setDateError('');setEditor({id:period.id,label:period.label,from:period.filters.from,to:period.filters.to});}}><span>{period.filters.from===period.filters.to?dateLabel(period.filters.from):dateLabel(period.filters.from)+' – '+dateLabel(period.filters.to)}</span><CalendarDays size={14}/></button></header>
        <div className="amazonPeriodBody">
          {show('grossSales')&&<div className="amazonPeriodSales"><span>Ventas</span><strong>{metric(data?.grossSales)}</strong></div>}
          <dl className="amazonPeriodMetrics">
            {(show('orders')||show('units'))&&<div><dt>{show('orders')&&show('units')?'Pedidos / unidades':show('orders')?'Pedidos':'Unidades'}</dt><dd>{data?[...(show('orders')?[data.orders.toLocaleString('es-ES')]:[]),...(show('units')?[data.units.toLocaleString('es-ES')]:[])].join(' / '):'—'}</dd></div>}
            {show('refunds')&&<div><dt>Reembolsos</dt><dd data-metric="refunds">{metric(data?.refunds)}<small className="amazonRefundCount">{refundCount==null?snapshot?.refundCountError?'Número no disponible':'Número pendiente':refundCount.toLocaleString('es-ES')+' '+(refundCount===1?'reembolso':'reembolsos')}</small></dd></div>}
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
          const base=amazonDashboardPeriods(new Date(),filters.marketplaceIds).find(period=>period.id===editor.id);
          onPeriodCustomize?.(editor.id,null);if(base)onPeriodChange?.(base.filters);closeEditor();
        }}>Restablecer {editor.label}</button>}<button className="primary" type="submit">Aplicar periodo</button></footer>
      </form>
    </div>}
  </section>;
}
