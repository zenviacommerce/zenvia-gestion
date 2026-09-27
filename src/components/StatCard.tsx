import type { ReactNode } from 'react';
export function StatCard({label,value,sub,icon,className='',onClick}:{label:string;value:string;sub?:string;icon:ReactNode;className?:string;onClick?:()=>void}){
  const content=<><div className="statIcon">{icon}</div><div><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div></>;
  if(onClick)return <button type="button" className={`stat statButton ${className}`.trim()} onClick={onClick}>{content}</button>;
  return <div className={`stat ${className}`.trim()}>{content}</div>;
}
