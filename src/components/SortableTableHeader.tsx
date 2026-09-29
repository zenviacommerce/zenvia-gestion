import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type TableSortDirection='asc'|'desc';
export type TableSortValue=string|number|boolean|Date|null|undefined;
export type TableSortAccessor<T>=(row:T)=>TableSortValue;
export type TableSortState={key:string;direction:TableSortDirection};

const collator=new Intl.Collator('es',{numeric:true,sensitivity:'base'});

function storageKey(tableId:string){return `zenvia:table-sort:${tableId}`; }

function readStoredSort(tableId:string,keys:Set<string>,fallback:TableSortState):TableSortState{
  if(typeof window==='undefined')return fallback;
  try{
    const raw=window.localStorage.getItem(storageKey(tableId));
    if(!raw)return fallback;
    const parsed=JSON.parse(raw);
    if(!keys.has(String(parsed?.key||'')))return fallback;
    return {key:String(parsed.key),direction:parsed.direction==='desc'?'desc':'asc'};
  }catch{return fallback;}
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
  const keys=useMemo(()=>new Set(Object.keys(accessors)),[accessors]);
  const safeDefault=keys.has(defaultSort.key)?defaultSort:{key:Object.keys(accessors)[0]||'',direction:'asc' as const};
  const [sort,setSort]=useState<TableSortState>(()=>readStoredSort(tableId,keys,safeDefault));

  useEffect(()=>{
    if(keys.has(sort.key))return;
    setSort(safeDefault);
  },[keys,safeDefault.key,safeDefault.direction,sort.key]);

  useEffect(()=>{
    if(typeof window==='undefined'||!sort.key)return;
    try{window.localStorage.setItem(storageKey(tableId),JSON.stringify(sort));}catch{}
  },[tableId,sort]);

  const sortedRows=useMemo(()=>{
    const accessor=accessors[sort.key];
    if(!accessor)return rows;
    return rows
      .map((row,index)=>({row,index}))
      .sort((left,right)=>compare(accessor(left.row),accessor(right.row),sort.direction)||left.index-right.index)
      .map(item=>item.row);
  },[rows,accessors,sort]);

  const toggleSort=(key:string)=>{
    if(!keys.has(key))return;
    setSort(current=>current.key===key
      ?{key,direction:current.direction==='asc'?'desc':'asc'}
      :{key,direction:'asc'});
  };

  return {rows:sortedRows,sort,toggleSort};
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
