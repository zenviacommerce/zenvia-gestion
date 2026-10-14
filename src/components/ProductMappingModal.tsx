import { useEffect, useRef, type ReactNode } from 'react';
import { ImageOff, Link2, X } from 'lucide-react';
export function ProductMappingModal({name,subtitle,imageUrl,channelName,onClose,children}:{name:string;subtitle:string;imageUrl?:string|null;channelName:string;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>previous?.focus();},[]);
 return <div className="amazonMappingModalBackdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
  <section ref={dialog} className="amazonMappingModal" role="dialog" aria-modal="true" aria-label={`Gestionar productos vinculados de ${channelName}`} onKeyDown={event=>{if(event.defaultPrevented)return;if(event.key==='Escape')onClose();if(event.key==='Tab'){const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]),first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}>
   <header className="amazonMappingModalHead"><div className="amazonMappingModalIdentity">{imageUrl?<img className="amazonMappingModalThumb" src={imageUrl} alt="" referrerPolicy="no-referrer"/>:<span className="amazonMappingModalThumb amazonProductThumbPlaceholder"><ImageOff size={21}/></span>}<div><span className="amazonSectionLabel">VINCULAR PRODUCTOS</span><strong><Link2 size={16}/>{name}</strong><small>{subtitle}</small></div></div><button className="amazonMappingModalClose" type="button" onClick={onClose} aria-label="Cerrar"><X size={19}/></button></header>
   <div className="amazonMappingModalBody">{children}</div>
  </section>
 </div>;
}
