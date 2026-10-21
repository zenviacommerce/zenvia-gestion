import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';

export function PageHeader({title,eyebrow,description,actions}:{title:string;eyebrow?:ReactNode;description?:ReactNode;actions?:ReactNode}){
  const row=useRef<HTMLDivElement>(null),[hasMore,setHasMore]=useState(false);
  const measure=()=>{const el=row.current;setHasMore(Boolean(el&&el.scrollWidth-el.clientWidth-el.scrollLeft>2));};
  useLayoutEffect(()=>{
    measure();const el=row.current;if(!el)return;
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(el);
    const content=new MutationObserver(measure);content.observe(el,{childList:true,subtree:true,characterData:true});
    window.addEventListener('resize',measure);return()=>{observer?.disconnect();content.disconnect();window.removeEventListener('resize',measure);};
  },[actions]);
  return <header className="pageHead dsPageHeader">
    <div className="dsPageHeaderIdentity">{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>
    {actions&&<div className="dsPageHeaderActionsFrame"><div ref={row} onScroll={measure} className="dsPageHeaderActions" role="region" aria-label={`Acciones de ${title}`} tabIndex={0}>{actions}</div>{hasMore&&<span className="dsActionsScrollHint" aria-hidden="true">→</span>}</div>}
  </header>;
}
