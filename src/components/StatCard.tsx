import type { ReactNode } from 'react';
export function StatCard({label,value,sub,icon,className='',variant='default',onClick}:{label:string;value:ReactNode;sub?:ReactNode;icon:ReactNode;className?:string;variant?:'default'|'warning';onClick?:()=>void}){
  const classes=[className,variant==='warning'?'dashboardPendingOrders':''].filter(Boolean).join(' ');
  const content=<><div className="statIcon">{icon}</div><div className="statContent"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div></>;
  if(onClick)return <button type="button" className={`stat statButton ${classes}`.trim()} onClick={onClick}>{content}</button>;
  return <div className={`stat ${classes}`.trim()}>{content}</div>;
}
