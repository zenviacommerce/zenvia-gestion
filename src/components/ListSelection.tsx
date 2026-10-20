import {useEffect,useState} from 'react';
import {BulkSelectCheckbox} from './BulkSelectionToolbar';
export function useListSelection(items:readonly {id:string}[]){
 const [ids,setIds]=useState<Set<string>>(()=>new Set());
 useEffect(()=>{const valid=new Set(items.map(item=>item.id));setIds(current=>{const next=new Set([...current].filter(id=>valid.has(id)));return next.size===current.size?current:next})},[items]);
 return [ids,setIds] as const;
}
export function toggleListScope(current:Set<string>,items:readonly {id:string}[],checked:boolean){
 const next=new Set(current);for(const item of items)if(checked)next.add(item.id);else next.delete(item.id);return next;
}
export function SelectionReview({selected,visibleIds,onRemove,onClear}:{selected:readonly {id:string;name:string}[];visibleIds:ReadonlySet<string>;onRemove:(id:string)=>void;onClear:()=>void}){
 if(!selected.length)return null;
 const hidden=selected.filter(item=>!visibleIds.has(item.id)).length;
 return <section className="dsSelectionReview" aria-label="Selección conservada">
  <p>{selected.length} seleccionados{hidden?` · ${hidden} fuera de los filtros`:''}. Las acciones masivas incluyen toda la selección.</p>
  <details><summary>Revisar selección ({selected.length})</summary><ul>{selected.map(item=><li key={item.id}><BulkSelectCheckbox checked onChange={()=>onRemove(item.id)} label={`Quitar ${item.name} de la selección`}/><span>{item.name}{!visibleIds.has(item.id)?' · fuera de los filtros':''}</span></li>)}</ul></details>
  <button className="secondary" type="button" onClick={onClear}>Vaciar selección</button>
 </section>;
}
