import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function RecordDetailDrawer({
  open,title,eyebrow,subtitle,onClose,children,actions,
}:{
  open:boolean;title:string;eyebrow?:string;subtitle?:string;onClose:()=>void;children:ReactNode;actions?:ReactNode;
}){
  if(!open)return null;
  return <div className="recordDrawerBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <aside className="recordDrawer" role="dialog" aria-modal="true" aria-label={title}>
      <header className="recordDrawerHead"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="iconBtn" onClick={onClose} aria-label="Cerrar"><X size={18}/></button></header>
      <div className="recordDrawerBody">{children}</div>
      {actions&&<footer className="recordDrawerActions">{actions}</footer>}
    </aside>
  </div>;
}
