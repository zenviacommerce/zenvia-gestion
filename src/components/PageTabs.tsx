import type {ReactNode,KeyboardEvent} from 'react';
type Tab<T extends string>={id:T;label:string;description?:string;icon?:ReactNode;badge?:ReactNode};
export function PageTabs<T extends string>({label,value,onChange,items,className='',panelId}:{label:string;value:T;onChange:(value:T)=>void;items:Tab<T>[];className?:string;panelId?:string}){
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index-1+items.length)%items.length:null;
  if(next===null)return;event.preventDefault();onChange(items[next].id);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
 };
 return <div className={`expenseHubNav dsPageTabs ${className}`.trim()} role="tablist" aria-label={label}>{items.map((item,index)=><button key={item.id} type="button" role="tab" id={panelId?`${panelId}-tab-${item.id}`:undefined} aria-controls={panelId} aria-selected={value===item.id} tabIndex={value===item.id?0:-1} className={value===item.id?'active':''} onClick={()=>onChange(item.id)} onKeyDown={event=>move(event,index)}>{item.icon&&<span className="expenseHubTabIcon">{item.icon}</span>}<span className="expenseHubTabText"><strong>{item.label}{item.badge}</strong>{item.description&&<small>{item.description}</small>}</span></button>)}</div>;
}
