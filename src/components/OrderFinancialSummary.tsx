import {useEffect,useRef,useState} from 'react';
import {Calculator,Euro,Percent,ShoppingBag,Truck} from 'lucide-react';
import {KpiGrid,StatCard} from '@zenvia/ui';
import {useSettings} from '../context/SettingsContext';
import {type DateRangeFilter,periodLabel} from '../services/filters';
import {formatAppMoney} from '../services/formatting';
import {fetchOrdersDashboardPage,type OrdersDashboardKpis} from '../services/orders';
import {transportKpisWithTariffs} from '../services/orderShipping';
import {listTransportTariffs} from '../services/transportTariffs';

export function OrderFinancialSummary({filter,refreshRevision,visibleKpis}:{filter:DateRangeFilter;refreshRevision:number;visibleKpis:ReadonlySet<string>}){
  const {settings}=useSettings();
  const {from,to}=filter;
  const overdueHours=settings.orders.overdueHours;
  const [summary,setSummary]=useState<{from:string;to:string;kpis:OrdersDashboardKpis}|null>(null);
  const [error,setError]=useState(false);
  const [loading,setLoading]=useState(true);
  const inFlight=useRef<Promise<void>|null>(null);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError(false);
    const run=async()=>{
      // A period change or snapshot can supersede an in-flight read. Wait for
      // it, then read only the latest requested scope; never publish stale data.
      if(inFlight.current)await inFlight.current;
      if(!active)return;
      const request=(async()=>{
        try{
          const [page,tariffs]=await Promise.all([
            fetchOrdersDashboardPage({from,to,state:'all',channel:'all',query:'',tracking:'all',country:'all',carrier:'all',page:0,pageSize:1,overdueHours,sortKey:'orderDate',sortDirection:'desc'}),
            listTransportTariffs(),
          ]);
          if(active)setSummary({from,to,kpis:{...page.kpis,transport:transportKpisWithTariffs(page.kpis.transport,page.tariffCandidates,tariffs)}});
        }catch{if(active)setError(true);}
        finally{if(active)setLoading(false);}
      })();
      inFlight.current=request;
      await request;
      if(inFlight.current===request)inFlight.current=null;
    };
    void run();
    return()=>{active=false;};
  },[from,to,overdueHours,refreshRevision]);
  const kpis=summary?.from===from&&summary.to===to?summary.kpis:null;
  const money=(value:number)=>formatAppMoney(value,'EUR',settings.general,{minimumFractionDigits:2,maximumFractionDigits:2});
  const value=(amount:number|undefined)=>amount===undefined?'—':money(amount);
  const selectedPeriod=periodLabel(filter);
  if(!['orderValue','orderVat','orderNet','orderAverage','orderTransport'].some(key=>visibleKpis.has(key)))return null;
  return <section aria-label="Ventas y costes de pedidos" aria-busy={loading}>
    <div className="dashboardSectionHead"><div><div className="eyebrow">PEDIDOS</div><h2>Ventas y costes de pedidos</h2><p>{selectedPeriod} · Ventas de pedidos no cancelados · costes de expediciones · no facturación emitida</p></div></div>
    {error&&<div className="errorBox" role="alert">{kpis?'No se pudo actualizar. Se conserva el último resumen de este periodo.':'No se pudieron cargar las ventas y costes de pedidos de este periodo.'}</div>}
    {loading&&!kpis&&<p role="status">Cargando ventas y costes de pedidos…</p>}
    <KpiGrid label="Ventas y costes de pedidos" dense>
      {visibleKpis.has('orderValue')&&<StatCard label="Total vendido" value={value(kpis?.sales.gross)} sub={kpis?`${kpis.sales.count} pedidos · ${selectedPeriod}`:selectedPeriod} icon={<Euro/>}/>}
      {visibleKpis.has('orderVat')&&<StatCard label="IVA estimado" value={value(kpis?.sales.vat)} sub={selectedPeriod} icon={<Percent/>}/>}
      {visibleKpis.has('orderNet')&&<StatCard label="Neto sin IVA" value={value(kpis?.sales.net)} sub={selectedPeriod} icon={<Calculator/>}/>}
      {visibleKpis.has('orderAverage')&&<StatCard label="Ticket medio" value={value(kpis?.sales.average)} sub={selectedPeriod} icon={<ShoppingBag/>}/>}
      {visibleKpis.has('orderTransport')&&<StatCard label="Coste transportistas (IVA incl.)" value={value(kpis?.transport.total)} sub={kpis?<>{`MRW ${money(kpis.transport.mrw)} · Correos ${money(kpis.transport.correos)} · Otros ${money(kpis.transport.other)}`}<br/>{`${kpis.transport.valued}/${kpis.transport.shipments} envíos con coste${kpis.transport.missing?` · ${kpis.transport.missing} sin valorar`:''}`}<br/>Costes registrados y estimaciones por tarifa</>:selectedPeriod} icon={<Truck/>}/>}
    </KpiGrid>
  </section>;
}
