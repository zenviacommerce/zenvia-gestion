import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, RotateCcw } from 'lucide-react';

export type TableSortDirection='asc'|'desc';
export type TableSortValue=string|number|boolean|Date|null|undefined;
export type TableSortAccessor<T>=(row:T)=>TableSortValue;
export type TableSortState={key:string;direction:TableSortDirection};

const collator=new Intl.Collator('es',{numeric:true,sensitivity:'base'});

function storageKey(tableId:string){return `zenvia:table-sort:${tableId}`; }

function readStoredSort(tableId:string,keys:Set<string>,fallback:TableSortState):TableSortState|null{
  if(typeof window==='undefined')return null;
  try{
    const raw=window.localStorage.getItem(storageKey(tableId));
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(!keys.has(String(parsed?.key||''))||!['asc','desc'].includes(parsed?.direction))return null;
    if(parsed.key===fallback.key&&parsed.direction===fallback.direction)return null;
    return {key:String(parsed.key),direction:parsed.direction};
  }catch{return null;}
}

/** An override has three states; the resolved sort always remains valid for server queries. */
export function useTableSort(tableId:string,allowedKeys:string[],defaultSort:TableSortState,{persist=true}:{persist?:boolean}={}){
  const keySignature=allowedKeys.join('\0');
  const keys=useMemo(()=>new Set(allowedKeys),[keySignature]);
  const safeDefault=keys.has(defaultSort.key)?defaultSort:{key:allowedKeys[0]||'',direction:'asc' as const};
  const [state,setState]=useState<{tableId:string;override:TableSortState|null}>(()=>({tableId,override:persist?readStoredSort(tableId,keys,safeDefault):null}));
  const scoped=state.tableId===tableId?state.override:(persist?readStoredSort(tableId,keys,safeDefault):null);
  const override=scoped&&keys.has(scoped.key)?scoped:null;
  const sort=override||safeDefault;
  const isDefaultSort=sort.key===safeDefault.key&&sort.direction===safeDefault.direction;
  useEffect(()=>{
    if(state.tableId!==tableId||scoped&&!keys.has(scoped.key))setState({tableId,override});
  },[tableId,keys,state.tableId,scoped?.key]);
  useEffect(()=>{
    if(!persist||typeof window==='undefined'||state.tableId!==tableId)return;
    try{
      if(isDefaultSort)window.localStorage.removeItem(storageKey(tableId));
      else window.localStorage.setItem(storageKey(tableId),JSON.stringify(sort));
    }catch{}
  },[persist,tableId,state.tableId,sort.key,sort.direction,isDefaultSort]);
  const resetSort=()=>setState({tableId,override:null});
  const toggleSort=(key:string)=>{
    if(!keys.has(key))return;
    setState(current=>{
      const previous=current.tableId===tableId?current.override:override;
      const next=previous?.key===key?(previous.direction==='asc'?{key,direction:'desc' as const}:null):{key,direction:'asc' as const};
      return {tableId,override:next};
    });
  };
  return {sort,isDefaultSort,resetSort,toggleSort};
}

export type TableSortControls={isDefaultSort:boolean;resetSort:()=>void};
export function TableSortReset({sorting}:{sorting:TableSortControls}){
  if(sorting.isDefaultSort)return null;
  return <div className="tableSortControls"><button type="button" className="secondary" onClick={sorting.resetSort} title="Volver al orden predeterminado de esta lista"><RotateCcw size={14}/> Restablecer orden</button></div>;
}

function rank(value:TableSortValue){
  if(value==null||value==='')return {empty:true,value:'' as string|number|boolean};
  if(value instanceof Date)return {empty:false,value:value.getTime()};
  if(typeof value==='number'||typeof value==='boolean')return {empty:false,value};
  const text=String(value).trim();
  const timestamp=/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(text)?Date.parse(text):NaN;
  return {empty:false,value:Number.isNaN(timestamp)?text:timestamp};
}

function compare(a:TableSortValue,b:TableSortValue,direction:TableSortDirection){
  const av=rank(a),bv=rank(b);
  if(av.empty&&bv.empty)return 0;
  if(av.empty)return 1;
  if(bv.empty)return -1;
  let result=0;
  if(typeof av.value==='number'&&typeof bv.value==='number')result=av.value-bv.value;
  else if(typeof av.value==='boolean'&&typeof bv.value==='boolean')result=Number(av.value)-Number(bv.value);
  else result=collator.compare(String(av.value),String(bv.value));
  return direction==='asc'?result:-result;
}

export function useSortableTable<T>(
  tableId:string,
  rows:T[],
  accessors:Record<string,TableSortAccessor<T>>,
  defaultSort:TableSortState,
){
  const controls=useTableSort(tableId,Object.keys(accessors),defaultSort);
  const {sort}=controls;

  const sortedRows=useMemo(()=>{
    const accessor=accessors[sort.key];
    if(!accessor)return rows;
    return rows
      .map((row,index)=>({row,index}))
      .sort((left,right)=>compare(accessor(left.row),accessor(right.row),sort.direction)||left.index-right.index)
      .map(item=>item.row);
  },[rows,accessors,sort]);

  return {rows:sortedRows,...controls};
}

export function SortableTableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className='',
  title,
}:{
  label:string;
  sortKey:string;
  activeKey:string;
  direction:TableSortDirection;
  onSort:(key:string)=>void;
  className?:string;
  title?:string;
}){
  const active=activeKey===sortKey;
  const ariaSort=active?(direction==='asc'?'ascending':'descending'):'none';
  return <th className={className||undefined} aria-sort={ariaSort}>
    <button
      type="button"
      className={active?'sortableTableHeader isActive':'sortableTableHeader'}
      onClick={()=>onSort(sortKey)}
      title={title||`Ordenar por ${label}`}
    >
      <span>{label}</span>
      {active?(direction==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>):<ArrowUpDown size={13}/>}
    </button>
  </th>;
}
