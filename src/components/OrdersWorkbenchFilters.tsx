import {useEffect,useId,useRef,useState} from 'react';
import {FormGrid} from '@zenvia/ui';
import {Plus,Search,X} from 'lucide-react';
import {SelectField,type SelectFieldOption} from './forms/SelectField';
import '../orders-workbench-filters.css';

export type OrdersWorkbenchFilterValues={query:string;channel:string;country:string;carrier:string;pickupReport:'all'|'none'|'in';tracking:string};
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
 const [open,setOpen]=useState(false);
 const [editing,setEditing]=useState<FilterKey|null>(null);
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const panel=useRef<HTMLDivElement>(null);
 const popupId=useId();
 const allowed=keys.filter(key=>tab!=='reports'&&(key!=='tracking'||!['pending','cancelled'].includes(tab))&&(key!=='pickupReport'||tab!=='pending'));
 const allowedKey=allowed.join(',');
 const close=()=>{setOpen(false);setEditing(null);trigger.current?.focus()};
 // The parent owns filter state. Clear values which cannot apply in the new view.
 useEffect(()=>{
  if(tab==='reports')return;
  const patch:Partial<OrdersWorkbenchFilterValues>={};
  for(const key of keys)if(!allowed.includes(key)&&values[key]!=='all')patch[key]='all';
  if(tab==='issues'&&terminalTracking.has(values.tracking))patch.tracking='all';
  if(Object.keys(patch).length)onChange(patch);
 },[tab,allowedKey,values.pickupReport,values.tracking,onChange]);
 useEffect(()=>{setOpen(false);setEditing(null)},[tab]);
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const outside=(event:PointerEvent)=>{
   const target=event.target;
   if(!(target instanceof Node)||root.current?.contains(target))return;
   // SelectField renders its options in a portal owned by the shared select.
   if(target instanceof Element&&target.closest('.searchableSelectMenu'))return;
   close();
  };
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[open,editing]);
 if(tab==='reports')return null;
 const options:Record<FilterKey,SelectFieldOption[]>={
  channel:[{value:'all',label:'Todos los canales'},{value:'amazon',label:`Amazon${channelCounts?` (${channelCounts.amazon})`:''}`},{value:'shopify',label:`Shopify${channelCounts?` (${channelCounts.shopify})`:''}`},{value:'other',label:`Manual / API${channelCounts?` (${channelCounts.manual})`:''}`}],
  country:[{value:'all',label:'Todos los países'},...countries.filter(option=>option.value!=='all')],
  carrier:[{value:'all',label:'Todos los transportistas'},...carriers.filter(option=>option.value!=='all')],
  pickupReport:[{value:'all',label:'Todos'},{value:'none',label:'Sin informe'},{value:'in',label:'En informe'}],
  tracking:trackingOptions.filter(option=>tab!=='issues'||!terminalTracking.has(option.value)),
 };
 const active=allowed.filter(key=>values[key]!=='all'&&!(tab==='issues'&&key==='tracking'&&terminalTracking.has(values.tracking)));
 const edit=(key:FilterKey)=>{setEditing(key);setOpen(true)};
 const remove=(key:FilterKey)=>{onChange({[key]:'all'});if(editing===key)close()};
 return <div className="ordersWorkbenchFilters" role="region" aria-label="Filtros de pedidos" ref={root}>
  <div className="ordersWorkbenchFilterLine">
   <div className="search ordersWorkbenchSearch"><Search size={16} aria-hidden="true"/><input aria-label="Buscar pedidos" value={values.query} onChange={event=>onChange({query:event.target.value})} placeholder="Buscar pedido, cliente, producto, tracking o transportista…"/>{values.query&&<button type="button" className="ordersWorkbenchClearSearch" aria-label="Borrar búsqueda" onClick={()=>onChange({query:''})}><X size={14}/></button>}</div>
   <button type="button" className="secondary ordersWorkbenchAddFilter" ref={trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?popupId:undefined} onClick={()=>open?close():(setEditing(null),setOpen(true))}><Plus size={15} aria-hidden="true"/>Añadir filtro</button>
   {(values.query||active.length>0)&&<button type="button" className="ordersWorkbenchReset" onClick={()=>{onChange({...emptyValues});close()}}>Limpiar filtros</button>}
  </div>
  {active.length>0&&<div className="ordersWorkbenchFilterChips" aria-label="Filtros activos">{active.map(key=>{
   const title=`${labels[key]}: ${options[key].find(option=>option.value===values[key])?.label||values[key]}`;
   return <span className="ordersWorkbenchFilterChip" key={key}><button type="button" aria-label={`Editar filtro ${title}`} onClick={()=>edit(key)}>{title}</button><button type="button" aria-label={`Quitar filtro ${title}`} onClick={()=>remove(key)}><X size={13} aria-hidden="true"/></button></span>;
  })}</div>}
  {open&&<div className="ordersWorkbenchFilterPopover" id={popupId} role="dialog" aria-label={editing?`Editar filtro ${labels[editing]}`:'Añadir filtro'} ref={panel} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close()}}}>
   <div className="ordersWorkbenchFilterPopoverHead"><strong>{editing?labels[editing]:'Añadir filtro'}</strong><button type="button" aria-label="Cerrar filtros" onClick={close}><X size={16}/></button></div>
   {editing?<><FormGrid><label className="filterField"><span>{labels[editing]}</span><SelectField ariaLabel={ariaLabels[editing]} value={values[editing]} options={options[editing]} onChange={value=>onChange({[editing]:value} as Partial<OrdersWorkbenchFilterValues>)}/></label></FormGrid><button type="button" className="ordersWorkbenchFilterDone" onClick={close}>Aplicar filtro</button></>:<div className="ordersWorkbenchFilterMenu">{allowed.map(key=><button type="button" key={key} onClick={()=>edit(key)}>{labels[key]}{values[key]!=='all'&&<span>Activo</span>}</button>)}{onShowAll&&<button type="button" className="ordersWorkbenchShowAll" onClick={()=>{close();onShowAll()}}>Ver todos los pedidos</button>}</div>}
  </div>}
 </div>;
}
