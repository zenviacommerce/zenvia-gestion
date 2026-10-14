import { AmazonLoading } from './AmazonLoading';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isAmazonConnectivityError, loadAmazonDetail, loadAmazonSummary, type AmazonAnalyticsFilters, type AmazonDetail, type AmazonKpiKey, type AmazonSummary as AmazonSummaryData } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { AmazonPeriodCards } from './AmazonPeriodCards';
import { amazonComparisonRange, amazonMetricChange } from '../../services/amazonDashboard';
import { AmazonProducts } from './AmazonProducts';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';
import { useSettings } from '../../context/SettingsContext';

function dateRangeLabel(filters:AmazonAnalyticsFilters){const fmt=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-ES');return fmt(filters.from)+' – '+fmt(filters.to);}
export function AmazonSummary({filters,onLoaded,refreshToken=0,visibleKpis,onPeriodChange,calendarDay}:{filters:AmazonAnalyticsFilters;onLoaded?:(summary:AmazonSummaryData)=>void;refreshToken?:number;visibleKpis?:AmazonKpiKey[];onPeriodChange?:(filters:AmazonAnalyticsFilters)=>void;calendarDay?:string}){
  const {settings}=useSettings();
  const summaryCacheKey=stableCacheKey('amazon:summary',filters);
  const detailCacheKey=stableCacheKey('amazon:detail',filters);
  const [summary,setSummary]=useState<AmazonSummaryData|null>(()=>readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [detail,setDetail]=useState<AmazonDetail|null>(()=>readViewCache<AmazonDetail>(detailCacheKey));
  const [periodOverrides,setPeriodOverrides]=useState<Record<string,{from:string;to:string}>>({});
  const comparisonFilters=amazonComparisonRange(filters);
  const [previous,setPrevious]=useState<AmazonSummaryData|null>(()=>readViewCache<AmazonSummaryData>(stableCacheKey('amazon:summary',comparisonFilters)));
  const [comparisonLoading,setComparisonLoading]=useState(false);
  const [loading,setLoading]=useState(()=>!readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [error,setError]=useState('');
  const [retryToken,setRetryToken]=useState(0);
  const primaryRequest=useRef<Promise<AmazonSummaryData>|null>(null);

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
    // Keep only the legacy fallback for refund figures shown on the cards.
    if(!needsRefundDetail)return()=>{alive=false;};
    void loadAmazonDetail(filters).then(value=>{
      if(alive){setDetail(value);writeViewCache(currentDetailKey,value);}
    }).catch(reason=>{
      if(alive&&!isAmazonConnectivityError(reason))setError(errorMessage(reason,'No se pudo cargar el detalle de Amazon.'));
    });
    return()=>{alive=false;};
  },[filters.from,filters.to,filters.marketplaceIds.join(','),needsRefundDetail,refreshToken,retryToken]);

  const profitChange=amazonMetricChange(summary?.netProfit,previous?.netProfit);
  const comparisonNote=!previous?comparisonLoading?'Comparando con el periodo anterior…':undefined
    :`Ganancia vs. anterior: ${profitChange==null?'sin base comparable':(profitChange>0?'+':'')+profitChange.toLocaleString('es-ES',{maximumFractionDigits:1})+' %'} · ${dateRangeLabel(comparisonFilters)}`;
  return <div className="amazonSummary">
    {loading&&<AmazonLoading>Cargando resumen de Amazon…</AmazonLoading>}
    {error&&<div className="card amazonQueryError"><span>{error}</span><button className="secondary" onClick={()=>setRetryToken(value=>value+1)}><RefreshCw size={15}/> Reintentar</button></div>}
    <AmazonPeriodCards summaryLoading={loading} calendarDay={calendarDay} filters={filters} summary={summary} currency={settings.amazon.consolidatedCurrency} refreshToken={refreshToken} onPeriodChange={onPeriodChange} comparisonNote={comparisonNote} visibleKpis={visibleKpis} detail={detail} periodOverrides={periodOverrides} onPeriodCustomize={(id,range)=>setPeriodOverrides(current=>{const next={...current};if(range)next[id]=range;else delete next[id];return next;})}/>
    <AmazonProducts key={`${filters.from}:${filters.to}:${filters.marketplaceIds.join(',')}`} filters={filters} embedded refreshToken={refreshToken}/>

  </div>;
}
