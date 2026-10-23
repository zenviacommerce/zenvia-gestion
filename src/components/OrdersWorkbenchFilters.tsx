import {useEffect} from 'react';
import {SearchFilters} from '@zenvia/ui';
import {SelectField,type SelectFieldOption} from './forms/SelectField';

export type OrdersWorkbenchFilterValues={query:string;channel:string;country:string;carrier:string;pickupReport:'all'|'none'|'in'|'pending'|'signed'|'void';tracking:string};
export type OrdersWorkbenchFiltersProps={
 tab:string;
 values:OrdersWorkbenchFilterValues;
 onChange:(patch:Partial<OrdersWorkbenchFilterValues>)=>void;
 countries:Array<{value:string;label:string}>;
 carriers:Array<{value:string;label:string}>;
 channelCounts?:{amazon:number;shopify:number;manual:number};
 onShowAll?:()=>void;
};
type FilterKey=Exclude<keyof OrdersWorkbenchFilterValues,'query'>;
const labels:Record<FilterKey,string>={channel:'Canal',country:'Destino',carrier:'Transportista',pickupReport:'Informe de recogida',tracking:'Seguimiento'};
const ariaLabels:Record<FilterKey,string>={channel:'Filtrar por canal',country:'Filtrar por país de destino',carrier:'Filtrar por transportista',pickupReport:'Filtrar por informe de recogida',tracking:'Filtrar por seguimiento'};
const keys:FilterKey[]=['channel','country','carrier','pickupReport','tracking'];
const trackingOptions:SelectFieldOption[]=[{value:'all',label:'Todos'},{value:'none',label:'Sin etiqueta / pendiente'},{value:'ready',label:'Preparado'},{value:'transit',label:'En tránsito'},{value:'route',label:'En reparto'},{value:'pickup',label:'Punto de recogida'},{value:'delivered',label:'Entregado'},{value:'issue',label:'Incidencias'},{value:'returned',label:'Devuelto'},{value:'cancelled',label:'Cancelado'}];
const terminalTracking=new Set(['delivered','returned','cancelled']);
const emptyValues:OrdersWorkbenchFilterValues={query:'',channel:'all',country:'all',carrier:'all',pickupReport:'all',tracking:'all'};

export function OrdersWorkbenchFilters({tab,values,onChange,countries,carriers,channelCounts,onShowAll}:OrdersWorkbenchFiltersProps){
 const allowed=keys.filter(key=>tab!=='reports'&&(key!=='tracking'||!['pending','cancelled'].includes(tab))&&(key!=='pickupReport'||tab!=='pending'));
 const allowedKey=allowed.join(',');
 // The parent owns filter state. Clear values which cannot apply in the new view.
 useEffect(()=>{
  if(tab==='reports')return;
  const patch:Partial<OrdersWorkbenchFilterValues>={};
  for(const key of keys)if(!allowed.includes(key)&&values[key]!=='all')patch[key]='all';
  if(tab==='issues'&&terminalTracking.has(values.tracking))patch.tracking='all';
  if(Object.keys(patch).length)onChange(patch);
 },[tab,allowedKey,values.pickupReport,values.tracking,onChange]);
 if(tab==='reports')return null;
 const options:Record<FilterKey,SelectFieldOption[]>={
  channel:[{value:'all',label:'Todos los canales'},{value:'amazon',label:`Amazon${channelCounts?` (${channelCounts.amazon})`:''}`},{value:'shopify',label:`Shopify${channelCounts?` (${channelCounts.shopify})`:''}`},{value:'other',label:`Manual / API${channelCounts?` (${channelCounts.manual})`:''}`}],
  country:[{value:'all',label:'Todos los países'},...countries.filter(option=>option.value!=='all')],
  carrier:[{value:'all',label:'Todos los transportistas'},...carriers.filter(option=>option.value!=='all')],
  pickupReport:[{value:'all',label:'Todos'},{value:'none',label:'Sin informe activo'},{value:'in',label:'En informe activo'},{value:'pending',label:'Pendiente de firma'},{value:'signed',label:'Firmado'},{value:'void',label:'Anulado'}],
  tracking:trackingOptions.filter(option=>tab!=='issues'||!terminalTracking.has(option.value)),
 };
 return <SearchFilters key={tab} label="Filtros de pedidos" query={values.query} onQueryChange={query=>onChange({query})} searchLabel="Buscar pedidos" placeholder="Buscar pedido, cliente, producto, tracking o transportista…" filters={allowed.map(key=>({id:key,label:labels[key],value:values[key],valueLabel:options[key].find(option=>option.value===values[key])?.label||values[key],control:<SelectField ariaLabel={ariaLabels[key]} value={values[key]} options={options[key]} onChange={value=>onChange({[key]:value} as Partial<OrdersWorkbenchFilterValues>)}/>}))} onRemove={key=>onChange({[key]:'all'} as Partial<OrdersWorkbenchFilterValues>)} onReset={()=>onChange({...emptyValues})} extraAction={onShowAll?{label:'Ver todos los pedidos',onClick:onShowAll}:undefined}/>;
}
