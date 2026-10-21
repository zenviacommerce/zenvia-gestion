import {useEffect,useState,type ReactNode,type KeyboardEvent} from 'react';
type Tab<T extends string>={id:T;label:string;description?:string;icon?:ReactNode;badge?:ReactNode};
export function PageTabs<T extends string>({label,value,onChange,items,className='',panelId,verticalAbove}:{label:string;value:T;onChange:(value:T)=>void|boolean|Promise<void|boolean>;items:Tab<T>[];className?:string;panelId?:string;verticalAbove?:number}){
 const [vertical,setVertical]=useState(()=>verticalAbove!==undefined&&typeof window!=='undefined'&&window.innerWidth>=verticalAbove);
 useEffect(()=>{if(verticalAbove===undefined)return;const update=()=>setVertical(window.innerWidth>=verticalAbove);update();window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update)},[verticalAbove]);
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key===(vertical?'ArrowDown':'ArrowRight')?(index+1)%items.length:event.key===(vertical?'ArrowUp':'ArrowLeft')?(index-1+items.length)%items.length:null;
  if(next===null)return;event.preventDefault();
  const tabs=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  const focus=(accepted:void|boolean)=>tabs?.[accepted===false?index:next]?.focus();
  const accepted=onChange(items[next].id);if(accepted instanceof Promise)void accepted.then(focus);else focus(accepted);
 };
 return <div className={`expenseHubNav dsPageTabs ${className}`.trim()} role="tablist" aria-orientation={vertical?'vertical':'horizontal'} aria-label={label}>{items.map((item,index)=><button key={item.id} type="button" role="tab" id={panelId?`${panelId}-tab-${item.id}`:undefined} aria-controls={panelId} aria-selected={value===item.id} tabIndex={value===item.id?0:-1} className={value===item.id?'active':''} onClick={()=>onChange(item.id)} onKeyDown={event=>move(event,index)}>{item.icon&&<span className="expenseHubTabIcon">{item.icon}</span>}<span className="expenseHubTabText"><strong>{item.label}{item.badge}</strong>{item.description&&<small>{item.description}</small>}</span></button>)}</div>;
}
