import { Link2 } from 'lucide-react';

export function ProductMappingAction({onClick,disabled=false,title}:{onClick:()=>void;disabled?:boolean;title?:string}){
  return <button type="button" className="secondary productMappingAction" disabled={disabled} title={title} onClick={onClick}><Link2 size={14} aria-hidden="true"/>Vincular / crear</button>;
}
