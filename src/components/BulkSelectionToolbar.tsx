import {useEffect,useRef,type ReactNode} from 'react';
import '../bulk-selection.css';

export function BulkSelectCheckbox({
  checked,disabled=false,onChange,label='Seleccionar fila',indeterminate=false,
}:{checked:boolean;indeterminate?:boolean;disabled?:boolean;onChange:(checked:boolean)=>void;label?:string}){
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(input.current)input.current.indeterminate=indeterminate},[indeterminate]);
  return <label className="bulkSelectCheckbox" title={label}>
    <input ref={input} type="checkbox" aria-checked={indeterminate?'mixed':checked} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)} aria-label={label}/>
    <span aria-hidden="true"/>
  </label>;
}

export function BulkSelectionToolbar({
  selectedCount,totalCount,allSelected,onToggleAll,children,label='seleccionados',disabled=false,scopeLabel='',indeterminate=false,alwaysVisible=false,countLabel,
}:{
  disabled?:boolean;indeterminate?:boolean;alwaysVisible?:boolean;countLabel?:string;
  selectedCount:number;
  totalCount:number;
  allSelected:boolean;
  onToggleAll:(checked:boolean)=>void;
  children?:ReactNode;
  label?:string;
  scopeLabel?:string;
}){
  if(totalCount<=0&&!alwaysVisible)return null;
  return <div className="bulkSelectionToolbar">
    <div className="bulkSelectionToggle">
      <BulkSelectCheckbox
        indeterminate={indeterminate}
        disabled={disabled}
        checked={allSelected}
        onChange={onToggleAll}
        label={`${allSelected?'Deseleccionar todos':'Seleccionar todos'}${scopeLabel?' de '+scopeLabel:''}`}
      />
      <button type="button" disabled={disabled} className="bulkSelectionTextButton" onClick={()=>onToggleAll(!allSelected)}>
        {allSelected?'Deseleccionar todos':'Seleccionar todos'}{scopeLabel?' de '+scopeLabel:''}
      </button>
      <span className="bulkSelectionCount">{countLabel??`${selectedCount} de ${totalCount} ${label}`}</span>
    </div>
    <div className="bulkSelectionActions">{children}</div>
  </div>;
}
