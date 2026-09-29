import { useEffect, useState } from 'react';
import { ImageOff, RefreshCw, Search } from 'lucide-react';
import { isAmazonConnectivityError, loadAmazonInventory, loadAmazonProductImages, type AmazonAnalyticsFilters, type AmazonInventoryAnalytics, type AmazonMarketplaceStatus, type AmazonPageResult } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { formatAmazonMarketplace } from './marketplaceLabel';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';
import { SortableTableHeader, useSortableTable } from '../SortableTableHeader';
export function AmazonInventory({filters,marketplaces,refreshToken=0}:{filters:AmazonAnalyticsFilters;marketplaces:AmazonMarketplaceStatus[];refreshToken?:number}){
 const [search,setSearch]=useState('');const [page,setPage]=useState(1);const initialKey=stableCacheKey('amazon:inventory',{marketplaceIds:filters.marketplaceIds,search:'',page:1,pageSize:25});const initialData=readViewCache<AmazonPageResult<AmazonInventoryAnalytics>>(initialKey);const [data,setData]=useState<AmazonPageResult<AmazonInventoryAnalytics>>(()=>initialData||{items:[],page:1,pageSize:25,total:0});const [loading,setLoading]=useState(()=>!initialData);const [error,setError]=useState('');const [images,setImages]=useState<Record<string,string>>({});
 const refresh=()=>{const key=stableCacheKey('amazon:inventory',{marketplaceIds:filters.marketplaceIds,search,page,pageSize:25});const cached=readViewCache<AmazonPageResult<AmazonInventoryAnalytics>>(key);if(cached)setData(cached);setLoading(!cached);setError('');return loadAmazonInventory(filters,search,page,25).then(next=>{setData(next);writeViewCache(key,next);}).catch(e=>{if(!isAmazonConnectivityError(e))setError(errorMessage(e,'No se pudo cargar el inventario.'));}).finally(()=>setLoading(false));};
 useEffect(()=>{void refresh();},[filters.marketplaceIds.join(','),search,page,refreshToken]);
 useEffect(()=>{const asins=data.items.map(row=>row.asin).filter((value):value is string=>Boolean(value));if(!asins.length){setImages({});return}void loadAmazonProductImages(asins).then(setImages).catch(()=>setImages({}));},[data.items]);
 const sorting=useSortableTable('amazon-inventory',data.items,{
   sku:row=>row.sellerSku,marketplace:row=>formatAmazonMarketplace(row.marketplaceId,marketplaces),
   fulfillable:row=>row.fulfillable,reserved:row=>row.reserved,inbound:row=>row.inbound,
   unfulfillable:row=>row.unfulfillable,researching:row=>row.researching,total:row=>row.total,lastSync:row=>row.lastSync,
 },{key:'sku',direction:'asc'});
 const rows=sorting.rows;
 return <section className="card amazonTableCard"><div className="amazonTableToolbar"><div><span className="amazonSectionLabel">FBA</span><strong>Inventario</strong></div><label className="amazonSearch"><Search size={16}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Buscar SKU o ASIN"/></label></div>{error&&<div className="amazonQueryError amazonQueryErrorInline"><span>{error}</span><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={14}/> Reintentar</button></div>}<div className="amazonTableScroll"><table className="amazonTable"><thead><tr>
<SortableTableHeader label="SKU" sortKey="sku" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Marketplace" sortKey="marketplace" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Disponible" sortKey="fulfillable" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Reservado" sortKey="reserved" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Entrante" sortKey="inbound" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="No disponible" sortKey="unfulfillable" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Investigando" sortKey="researching" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Total" sortKey="total" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
<SortableTableHeader label="Última sync" sortKey="lastSync" activeKey={sorting.sort.key} direction={sorting.sort.direction} onSort={sorting.toggleSort}/>
</tr></thead><tbody>{rows.map(row=><tr key={`${row.marketplaceId}-${row.sellerSku}`}><td><div className="amazonProductIdentity">{row.asin&&images[row.asin]?<img className="amazonProductThumb" src={images[row.asin]} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="amazonProductThumb amazonProductThumbPlaceholder"><ImageOff size={18}/></span>}<div><strong>{row.sellerSku}</strong><small>{row.asin||'ASIN no disponible'}</small></div></div></td><td>{formatAmazonMarketplace(row.marketplaceId,marketplaces)}</td><td>{row.fulfillable}</td><td>{row.reserved}</td><td>{row.inbound}</td><td>{row.unfulfillable}</td><td>{row.researching}</td><td><strong>{row.total}</strong></td><td>{new Date(row.lastSync).toLocaleString('es-ES')}</td></tr>)}{!data.items.length&&<tr><td colSpan={9} className="amazonEmptyCell">{loading?'Cargando inventario de Amazon…':'No hay inventario sincronizado.'}</td></tr>}</tbody></table></div><div className="amazonPagination"><span>{loading&&!data.items.length?'Cargando inventario…':`${data.total} posiciones`}</span><div><button disabled={page<=1} onClick={()=>setPage(v=>v-1)}>Anterior</button><span>Página {page}</span><button disabled={page*25>=data.total} onClick={()=>setPage(v=>v+1)}>Siguiente</button></div></div></section>;
}
