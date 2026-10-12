import { useState } from 'react';
import { PeriodFilterPanel, quickPresets } from '../PeriodFilterPanel';
import type { DateRangeFilter, PeriodPreset } from '../../services/filters';
import { amazonQuickRange, type AmazonAnalyticsFilters, type AmazonMarketplaceStatus, type AmazonRangeKey } from '../../services/amazon';

const presets:readonly (readonly [PeriodPreset,string])[]=[...quickPresets.filter(([key])=>key!=='all'),['7d','7 días'],['30d','30 días']];

export function AmazonFilters({filters,marketplaces,initialPreset='current_month',onChange}:{filters:AmazonAnalyticsFilters;marketplaces:AmazonMarketplaceStatus[];initialPreset?:AmazonRangeKey;onChange:(filters:AmazonAnalyticsFilters)=>void}){
  const [preset,setPreset]=useState<AmazonRangeKey>(initialPreset);
  const apply=(next:DateRangeFilter)=>{
    const key=next.preset as AmazonRangeKey;
    setPreset(key);
    onChange({...filters,...(key==='custom'?{from:next.from,to:next.to}:amazonQuickRange(key,new Date()))});
  };
  const toggleMarketplace=(id:string)=>{const selected=filters.marketplaceIds.includes(id);onChange({...filters,marketplaceIds:selected?filters.marketplaceIds.filter(value=>value!==id):[...filters.marketplaceIds,id]});};
  return <>
    <PeriodFilterPanel filter={{...filters,preset}} onChange={apply} title="Periodo de Amazon" presets={presets}/>
    <section className="card amazonFilters" aria-label="Filtros de Amazon Analytics">
    <div className="amazonMarketplaceFilter"><span>Marketplace</span><button className={!filters.marketplaceIds.length?'isActive':''} onClick={()=>onChange({...filters,marketplaceIds:[]})}>Todos</button>{marketplaces.filter(item=>item.active).map(item=><button key={item.id} className={filters.marketplaceIds.includes(item.id)?'isActive':''} onClick={()=>toggleMarketplace(item.id)}>{item.countryCode}</button>)}</div>
  </section></>;
}
