import {PageHeader} from '../components/PageHeader';
import {Tabs} from '@zenvia/ui';
import { AmazonLoading } from '../components/amazon/AmazonLoading';
import {amazonCalendarDate,amazonCalendarDay,watchAmazonCalendarDay} from '../services/amazonCalendar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import { AMAZON_CONNECTIVITY_EVENT, invalidateAmazonAnalytics, amazonQuickRange, isAmazonConnectivityError, loadAmazonStatus, requestAmazonSync, resolveAmazonMarketplaceSelection, resolveAmazonVisibleKpis, type AmazonAnalyticsFilters, type AmazonStatus, type AmazonSummary as AmazonSummaryData } from '../services/amazon';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { AmazonFilters } from '../components/amazon/AmazonFilters';
import { AmazonSummary } from '../components/amazon/AmazonSummary';
import { AmazonProducts } from '../components/amazon/AmazonProducts';
import { AmazonMarketplaces } from '../components/amazon/AmazonMarketplaces';
import { AmazonOrders } from '../components/amazon/AmazonOrders';
import { AmazonInventory } from '../components/amazon/AmazonInventory';
import { AmazonUnmapped } from '../components/amazon/AmazonUnmapped';
import { readViewCache, writeViewCache } from '../services/viewCache';
import { useSettings } from '../context/SettingsContext';
import { clearActivities } from '../services/activity';

const tabs=[['summary','Resumen'],['products','Productos'],['marketplaces','Marketplaces'],['orders','Pedidos'],['inventory','Inventario'],['unmapped','Sin vincular']] as const;
type AmazonTab=(typeof tabs)[number][0];

const AMAZON_STATUS_CACHE='amazon:status';
function statusLabel(status:AmazonStatus|null,loading:boolean){if(loading&&!status)return 'Comprobando';if(!status?.configured)return 'Pendiente de configurar';if(status.connected)return 'Conectado';if(status.status==='error')return 'Error';return 'Configurado';}

export function AmazonPage({isAdmin}:{isAdmin:boolean}){
  const {settings}=useSettings();
  const amazonSettings=settings.amazon;
  const [status,setStatus]=useState<AmazonStatus|null>(()=>readViewCache<AmazonStatus>(AMAZON_STATUS_CACHE));const [loading,setLoading]=useState(()=>!readViewCache<AmazonStatus>(AMAZON_STATUS_CACHE));const [syncing,setSyncing]=useState(false);const [error,setError]=useState('');
  const [activeTab,setActiveTab]=useState<AmazonTab>('summary');
  const [filters,setFilters]=useState<AmazonAnalyticsFilters>(()=>({...amazonQuickRange('today',amazonCalendarDate(amazonCalendarDay(new Date(),settings.general.timezone))),marketplaceIds:[]}));
  const [summaryMeta,setSummaryMeta]=useState<AmazonSummaryData|null>(null);
  const [calendarDay,setCalendarDay]=useState(()=>amazonCalendarDay(new Date(),settings.general.timezone));
  useEffect(()=>{
    setCalendarDay(amazonCalendarDay(new Date(),settings.general.timezone));
    return watchAmazonCalendarDay((previous,next)=>{
    setCalendarDay(next);
    setFilters(current=>current.from===previous&&current.to===previous?{...current,from:next,to:next}:current);
    invalidateAmazonAnalytics();setAnalyticsRefresh(value=>value+1);
    },settings.general.timezone);
  },[settings.general.timezone]);
  const [analyticsRefresh,setAnalyticsRefresh]=useState(0);
  const [syncFeedback,setSyncFeedback]=useState('');
  const [connectivityIssue,setConnectivityIssue]=useState(()=>typeof navigator!=='undefined'&&!navigator.onLine);
  const previousPendingJobs=useRef(0);
  const [manualSyncPending,setManualSyncPending]=useState(false);

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const next=await loadAmazonStatus();
      setStatus(next);writeViewCache(AMAZON_STATUS_CACHE,next);setConnectivityIssue(false);
      return next;
    }catch(e){
      if(isAmazonConnectivityError(e)){setConnectivityIssue(true);setError('');}
      else setError(errorMessage(e,'No se pudo consultar Amazon.'));
      return null;
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>()=>clearActivities('amazon'),[]);
  useEffect(()=>{
    const markOffline=()=>{setConnectivityIssue(true);setError('');};
    const markOnline=()=>{setConnectivityIssue(false);void refresh();invalidateAmazonAnalytics();setAnalyticsRefresh(value=>value+1);};
    const onAmazonConnectivity=()=>markOffline();
    window.addEventListener('offline',markOffline);
    window.addEventListener('online',markOnline);
    window.addEventListener(AMAZON_CONNECTIVITY_EVENT,onAmazonConnectivity);
    return()=>{
      window.removeEventListener('offline',markOffline);
      window.removeEventListener('online',markOnline);
      window.removeEventListener(AMAZON_CONNECTIVITY_EVENT,onAmazonConnectivity);
    };
  },[refresh]);
  const handleSummary=useCallback((summary:AmazonSummaryData)=>setSummaryMeta(summary),[]);
  const syncNow=async()=>{
    if(connectivityIssue){showError('No hay conexión a Internet. La sincronización se reanudará cuando vuelva la conexión.');return;}
    setSyncFeedback('Solicitando actualización y recuperación de trabajos pendientes…');
    setSyncing(true);
    try{
      const result=await requestAmazonSync();
      const feedback=result.jobs||result.recoveryJobs?`Actualización solicitada: ${result.jobs} trabajos actuales y ${result.recoveryJobs||0} recuperaciones históricas preparadas.`:'No se han creado trabajos nuevos; revisando datos disponibles.';
      setSyncFeedback(feedback);
      showSuccess(feedback);
      const nextStatus=await refresh();
      const nextPending=(nextStatus?.sync.jobCounts.queued||0)+(nextStatus?.sync.jobCounts.running||0);
      if((result.jobs||result.recoveryJobs)&&nextPending>0)setManualSyncPending(true);
      else if(result.jobs||result.recoveryJobs){
        setManualSyncPending(false);
        invalidateAmazonAnalytics();setAnalyticsRefresh(value=>value+1);
        showSuccess('Sincronización de Amazon completada. Los datos se han actualizado.');
      }
    }catch(e){
      setSyncFeedback(errorMessage(e,'No se pudo iniciar la sincronización de Amazon.'));
      if(!isAmazonConnectivityError(e))showError(errorMessage(e,'No se pudo iniciar la sincronización de Amazon.'));
    }finally{setSyncing(false);}
  };

  const connected=Boolean(status?.connected);
  const marketplaceSelection=resolveAmazonMarketplaceSelection(status?.marketplaces||[],amazonSettings);
  const marketplaces=marketplaceSelection.marketplaces;
  const visibleKpis=resolveAmazonVisibleKpis(amazonSettings);
  const defaultPreset='today' as const;
  const jobs=status?.sync.jobCounts;


  const pendingJobs=(jobs?.queued||0)+(jobs?.running||0);
  useEffect(()=>{
    const previous=previousPendingJobs.current;
    previousPendingJobs.current=pendingJobs;

    if(previous>0&&pendingJobs===0){
      invalidateAmazonAnalytics();setAnalyticsRefresh(value=>value+1);
      if(manualSyncPending)showSuccess('Sincronización de Amazon completada. Los datos se han actualizado.');
      setManualSyncPending(false);
    }

    if(!connected||pendingJobs<=0)return;
    const timer=window.setTimeout(()=>void refresh(),5_000);
    return()=>window.clearTimeout(timer);
  },[connected,pendingJobs,refresh,manualSyncPending]);


  useEffect(()=>{
    if(!connected||!marketplaces.length)return;
    setFilters(current=>{
      // An empty selection means "Todos" and is the default. Only clean up
      // marketplaces that are no longer available; never force the primary one.
      if(!current.marketplaceIds.length)return current;
      const valid=current.marketplaceIds.filter(id=>marketplaces.some(item=>item.id===id));
      return valid.length===current.marketplaceIds.length?current:{...current,marketplaceIds:valid};
    });
  },[connected,marketplaces.map(item=>item.id).join(',')]);
  return <div className="page amazonPage commerceDesignPage designSystemPage">
    <PageHeader title="Amazon" eyebrow="AMAZON ANALYTICS" description="Ventas, costes, rentabilidad e inventario de tus marketplaces europeos." actions={<>{isAdmin&&!status?.demo&&<button className="primary amazonSyncButton" onClick={()=>void syncNow()} disabled={syncing||loading||!status?.configured}>{syncing?<LoaderCircle size={17} className="spin"/>:<RefreshCw size={17}/>}<span>{syncing?'Solicitando…':'Actualizar datos'}</span></button>}</>}/>

    {loading&&<AmazonLoading>Comprobando conexión con Amazon…</AmazonLoading>}
    {syncFeedback&&<div role="status" aria-live="polite" className="amazonSyncFeedback" style={{marginBottom:12}}>{syncFeedback}</div>}
    <section aria-label="Estado de conexión" className={`card amazonCompactStatus ${connected?'isConnected':status?.status==='error'?'isError':''}`}><div className="amazonCompactState">{connected?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}<strong>{statusLabel(status,loading)}</strong><span>{status?.account?.displayName||'Amazon SP-API'}</span></div><div className="amazonCompactMeta"><span>{marketplaces.length} marketplaces</span><span>{jobs?.running||0} en curso</span><span>{jobs?.queued||0} en cola</span>{jobs?.failed? <span className="amazonFailed">{jobs.failed} con error</span>:null}{status?.account?.lastSuccessfulSyncAt&&<span>Última sync {new Date(status.account.lastSuccessfulSyncAt).toLocaleString('es-ES')}</span>}</div></section>
    {connectivityIssue&&<div className="amazonOfflineNotice card"><WifiOff size={18}/><div><strong>Sin conexión a Internet</strong><span>Mostrando los últimos datos guardados. Amazon se actualizará automáticamente cuando vuelva la conexión.</span></div><button className="secondary" onClick={()=>{if(navigator.onLine){setConnectivityIssue(false);void refresh();invalidateAmazonAnalytics();setAnalyticsRefresh(value=>value+1);}}}><RefreshCw size={15}/> Reintentar</button></div>}
    {error&&<div className="amazonQueryError card"><span>{error}</span><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={15}/> Reintentar</button></div>}

    {connected?<>
      <div className="amazonToolbar">
      <AmazonFilters calendarDay={calendarDay} filters={filters} marketplaces={marketplaces} initialPreset={defaultPreset} onChange={setFilters}/>


      </div>
<Tabs panelId="amazon-tab-panel" label="Secciones de Amazon Analytics" value={activeTab} onChange={setActiveTab} items={tabs.map(([id,label])=>({id,label,badge:id==='unmapped'&&summaryMeta?.unmappedSkuCount?summaryMeta.unmappedSkuCount:undefined}))}>
      <div className="commerceTabPanel" role="tabpanel" id="amazon-tab-panel" aria-labelledby={'amazon-tab-panel-tab-'+activeTab} tabIndex={0}>
      {activeTab==='summary'&&<AmazonSummary calendarDay={calendarDay} filters={filters} onLoaded={handleSummary} refreshToken={analyticsRefresh} visibleKpis={visibleKpis} onPeriodChange={setFilters}/>}
      {activeTab==='products'&&<AmazonProducts filters={filters} refreshToken={analyticsRefresh}/>}
      {activeTab==='marketplaces'&&<AmazonMarketplaces filters={filters} refreshToken={analyticsRefresh}/>}
      {activeTab==='orders'&&<AmazonOrders filters={filters} marketplaces={marketplaces} refreshToken={analyticsRefresh}/>}
      {activeTab==='inventory'&&<AmazonInventory filters={filters} marketplaces={marketplaces} refreshToken={analyticsRefresh}/>}
      {activeTab==='unmapped'&&<AmazonUnmapped onChanged={()=>setSummaryMeta(null)} refreshToken={analyticsRefresh} defaultConsumptionFactor={amazonSettings.defaultConsumptionFactor}/>}
      </div>
</Tabs>
    </>:<section className="card amazonDisconnected"><strong>Amazon Analytics todavía no está disponible.</strong><p>{loading?'Comprobando la conexión segura con Amazon SP-API…':status?.configured?'Las credenciales están configuradas, pero la conexión no está operativa.':isAdmin?'Completa la configuración segura de Amazon SP-API en el backend.':'El administrador debe completar la conexión con Amazon.'}</p></section>}
  </div>;
}
