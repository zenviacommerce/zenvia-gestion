import {useEffect,useId,useRef,type ReactNode,type KeyboardEvent} from 'react';

export type TabItem<T extends string>={id:T;label:string;description?:string;icon?:ReactNode;badge?:ReactNode;badgeTone?:'neutral'|'danger'};
export type TabsProps<T extends string>={
 label:string;value:T;onChange:(value:T)=>void|boolean|Promise<void|boolean>;
 items:TabItem<T>[];panelId?:string;className?:string;children?:ReactNode;hidden?:boolean;
};

/** One horizontal card rail in every app. Business state and dirty guards stay with the caller. */
export function Tabs<T extends string>({label,value,onChange,items,panelId,className='',children,hidden=false}:TabsProps<T>){
 const generated=useId();const id=panelId||`tabs-${generated}`;
 const rail=useRef<HTMLDivElement>(null),pending=useRef(false);
 useEffect(()=>{rail.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'})},[value]);
 const select=(next:number,current:number,focus:boolean)=>{
  if(pending.current)return;
  const finish=(accepted:void|boolean)=>{const target=rail.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[accepted===false?current:next];if(focus||accepted===false)target?.focus({preventScroll:true});target?.scrollIntoView?.({block:'nearest',inline:'nearest'})};
  const accepted=onChange(items[next].id);
  if(accepted instanceof Promise){pending.current=true;void accepted.then(finish,()=>finish(false)).finally(()=>{pending.current=false})}else finish(accepted);
 };
 const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index-1+items.length)%items.length:null;
  if(next===null)return;event.preventDefault();void select(next,index,true);
 };
 return <div className="dsTabsSection"><div ref={rail} hidden={hidden} className={`dsTabs ${className}`.trim()} role="tablist" aria-label={label} aria-orientation="horizontal">
  {items.map((item,index)=><button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-controls={panelId} aria-selected={value===item.id} tabIndex={value===item.id?0:-1} onClick={()=>void select(index,items.findIndex(item=>item.id===value),false)} onKeyDown={event=>move(event,index)}>
   {item.icon&&<span className="dsTabIcon" aria-hidden="true">{item.icon}</span>}
   <span className="dsTabText"><span className="dsTabTitle">{item.label}{item.badge!==undefined&&<span className="dsTabBadge" data-tone={item.badgeTone||'neutral'}>{item.badge}</span>}</span>{item.description&&<span className="dsTabDescription">{item.description}</span>}</span>
  </button>)}
 </div>{children&&<div className="dsTabsContent">{children}</div>}</div>;
}
