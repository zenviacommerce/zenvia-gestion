import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isAmazonConnectivityError, loadAmazonMarketplaces, type AmazonAnalyticsFilters, type AmazonMarketplaceAnalytics } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';
import { useSettings } from '../../context/SettingsContext';
import { SortableTableHeader, useSortableTable } from '../SortableTableHeader';

export function AmazonMarketplaces({filters,refreshToken=0}:{filters:AmazonAnalyticsFilters;refreshToken?:number}){
  const {settings}=useSettings();
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:settings.amazon.consolidatedCurrency});
  const initialKey=stableCacheKey('amazon:marketplaces',filters);
  const initialItems=readViewCache<AmazonMarketplaceAnalytics[]>(initialKey);
  const [items,setItems]=useState<AmazonMarketplaceAnalytics[]>(()=>initialItems||[]);const [loading,setLoading]=useState(()=>!initialItems);const [error,setError]=useState('');
  const refresh=()=>{const key=stableCacheKey('amazon:marketplaces',filters);const cached=readViewCache<AmazonMarketplaceAnalytics[]>(key);if(cached)setItems(cached);setLoading(!cached);setError('');return loadAmazonMarketplaces(filters).then(result=>{setItems(result.items);writeViewCache(key,result.items);}).catch(e=>{if(!isAmazonConnectivityError(e))setError(errorMessage(e,'No se pudieron cargar los marketplaces.'));}).finally(()=>setLoading(false));};
  useEffect(()=>{void refresh();},[filters.from,filters.to,filters.marketplaceIds.join(','),refreshToken]);
  const sorting=useSortableTable('amazon-marketplaces',items,{
    marketplace:row=>`${row.countryCode} ${row.name}`,orders:row=>row.orders,units:row=>row.units,
    sales:row=>row.netSales,fees:row=>row.amazonFees,cost:row=>row.productCost,profit:row=>row.profitBeforeAds,margin:row=>row.marginPct,
  },{key:'sales',direction:'desc'});
  const rows=sorting.rows;
  return <section className="card amazonTableCard"><div className="amazonTableToolbar"><div><span className="amazonSectionLabel">RENDIMIENTO POR PAÍS</span><strong>Marketplaces</strong></div></div>{error&&<div className="amazonQueryError amazonQueryErrorInline"><span>{error}</span><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={14}/> Reintentar</button></div>}<div className="amazonTableScroll"><table className="amazonTable"><thead><tr>
<SortableTableHeader label="Marketplace" sortKey="marketplace" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Pedidos" sortKey="orders" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Unidades" sortKey="units" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Ventas" sortKey="sales" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Tarifas" sortKey="fees" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Coste" sortKey="cost" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Beneficio" sortKey="profit" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Margen" sortKey="margin" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
</tr></thead><tbody>{rows.map(row=><tr key={row.marketplaceId}><td><strong>{row.countryCode} · {row.name}</strong><small>{row.marketplaceId}</small></td><td>{row.orders}</td><td>{row.units}</td><td>{money.format(row.netSales)}</td><td>{money.format(row.amazonFees)}</td><td>{money.format(row.productCost)}</td><td>{money.format(row.profitBeforeAds)}{!row.profitComplete&&<small className="amazonIncomplete">Incompleto</small>}</td><td>{row.marginPct==null?'—':`${row.marginPct.toFixed(1)} %`}</td></tr>)}{!items.length&&<tr><td colSpan={8} className="amazonEmptyCell">{loading?'Cargando marketplaces de Amazon…':'No hay datos para este periodo.'}</td></tr>}</tbody></table></div></section>;
}
