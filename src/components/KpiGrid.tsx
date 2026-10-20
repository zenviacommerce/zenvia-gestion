import type {ReactNode} from 'react';

/** Layout only: StatCard owns the single card surface and its actions. */
export function KpiGrid({children,label,dense=false}:{children:ReactNode;label:string;dense?:boolean}){
  return <div className={`kpiGrid${dense?' kpiGridDense':''}`} role="group" aria-label={label}>{children}</div>;
}
