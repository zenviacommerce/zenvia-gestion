import { CheckboxOption } from '../forms/CheckboxOption';
import {amazonCalendarDate} from '../../services/amazonCalendar';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, Globe2 } from 'lucide-react';
import { SelectField } from '../forms/SelectField';
import { quickPresets } from '../PeriodFilterPanel';
import type { PeriodPreset } from '../../services/filters';
import { amazonQuickRange, type AmazonAnalyticsFilters, type AmazonMarketplaceStatus, type AmazonRangeKey } from '../../services/amazon';

const presets:readonly (readonly [PeriodPreset,string])[]=[...quickPresets.filter(([key])=>key!=='all'),['7d','7 días'],['30d','30 días']];
export function AmazonFilters({filters,marketplaces,initialPreset='today',onChange,calendarDay}:{filters:AmazonAnalyticsFilters;marketplaces:AmazonMarketplaceStatus[];initialPreset?:AmazonRangeKey;onChange:(filters:AmazonAnalyticsFilters)=>void;calendarDay?:string}){
  const now=calendarDay?amazonCalendarDate(calendarDay):new Date();
  const periodRef=useRef<HTMLDetailsElement>(null);
  const [preset,setPreset]=useState<AmazonRangeKey>(initialPreset);
  const [draft,setDraft]=useState({from:filters.from,to:filters.to});
  const [error,setError]=useState('');
  useEffect(()=>{
    setDraft({from:filters.from,to:filters.to});setError('');
    setPreset(current=>{
      const matches=(key:AmazonRangeKey)=>{const range=amazonQuickRange(key,now);return range.from===filters.from&&range.to===filters.to;};
      if(current!=='custom'&&matches(current))return current;
      return (presets.find(([key])=>key!=='custom'&&matches(key as AmazonRangeKey))?.[0] as AmazonRangeKey|undefined)||'custom';
    });
  },[filters.from,filters.to,calendarDay]);
  const toggleMarketplace=(id:string)=>{
    const next=filters.marketplaceIds.includes(id)?filters.marketplaceIds.filter(value=>value!==id):[...filters.marketplaceIds,id];
    onChange({...filters,marketplaceIds:next});
  };
  const active=marketplaces.filter(item=>item.active);
  const marketplaceLabel=!filters.marketplaceIds.length?'Todos':filters.marketplaceIds.length===1?active.find(item=>item.id===filters.marketplaceIds[0])?.name||filters.marketplaceIds[0]:`${filters.marketplaceIds.length} seleccionados`;
  const periodLabel=presets.find(([key])=>key===preset)?.[1]||'Personalizado';
  return <section className="amazonDesktopFilters" aria-label="Filtros de Amazon Analytics">
    <details ref={periodRef} className="amazonFilterDropdown">
      <summary><CalendarDays size={15}/><span><small>Periodo</small><strong>{periodLabel}</strong></span><ChevronDown size={14}/></summary>
      <div className="amazonFilterDropdownPanel">
        <div><span className="amazonDropdownFieldLabel">Periodo</span><SelectField ariaLabel="Periodo de Amazon" value={preset} options={[...presets.map(([value,label])=>({value,label})),{value:'custom',label:'Personalizado'}]} onChange={value=>{
          const key=value as AmazonRangeKey;setPreset(key);
          if(key!=='custom'){onChange({...filters,...amazonQuickRange(key,now)});periodRef.current?.removeAttribute('open');}
        }}/></div>
        <form onSubmit={event=>{
          event.preventDefault();if(!draft.from||!draft.to||draft.from>draft.to){setError('Selecciona un intervalo válido.');return;}
          setPreset('custom');onChange({...filters,...draft});setError('');event.currentTarget.closest('details')?.removeAttribute('open');
        }}>
          <div className="amazonDropdownDates"><label>Desde<input aria-label="Desde periodo" type="date" required value={draft.from} onChange={event=>setDraft(current=>({...current,from:event.target.value}))}/></label><label>Hasta<input aria-label="Hasta periodo" type="date" required min={draft.from} value={draft.to} onChange={event=>setDraft(current=>({...current,to:event.target.value}))}/></label></div>
          {error&&<p className="amazonDateError" role="alert">{error}</p>}<button className="primary" type="submit">Aplicar fechas</button>
        </form>
      </div>
    </details>
    <details className="amazonFilterDropdown">
      <summary><Globe2 size={15}/><span><small>Marketplace</small><strong>{marketplaceLabel}</strong></span><ChevronDown size={14}/></summary>
      <div className="amazonFilterDropdownPanel amazonDropdownMarketplaces" role="group" aria-label="Seleccionar marketplaces">
        <button type="button" className={`sharedCheckboxReset ${!filters.marketplaceIds.length?'isActive':''}`} onClick={()=>onChange({...filters,marketplaceIds:[]})}>Todos los marketplaces</button>
        {active.map(item=><CheckboxOption key={item.id} checked={filters.marketplaceIds.includes(item.id)} onChange={()=>toggleMarketplace(item.id)} label={item.name||item.countryCode} description={item.countryCode}/>)}
      </div>
    </details>
  </section>;
}
