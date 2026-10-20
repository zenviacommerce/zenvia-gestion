import {Pencil,Trash2} from 'lucide-react';
export function RowActions({onEdit,onDelete,disabled=false}:{onEdit:()=>void;onDelete:()=>void;disabled?:boolean}){
 return <div className="dsRowActions" onClick={event=>event.stopPropagation()}>
  <button type="button" className="zenviaRowAction" aria-label="Editar" title="Editar" disabled={disabled} onClick={onEdit}><Pencil size={15}/><span>Editar</span></button>
  <button type="button" className="zenviaRowAction danger" aria-label="Eliminar" title="Eliminar" disabled={disabled} onClick={onDelete}><Trash2 size={15}/><span>Eliminar</span></button>
 </div>;
}
