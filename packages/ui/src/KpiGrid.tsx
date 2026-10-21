import {Children,type CSSProperties,type ReactNode} from 'react';

/** Keep rows balanced; mobile uses two columns with an odd final card spanning both. */
function columns(count:number,limit:number){
 if(count<=limit)return Math.max(1,count);
 const balanced=Math.ceil(count/Math.ceil(count/limit));
 for(let n=balanced;n>=2;n--)if(count%n!==1)return n;
 return balanced;
}
/** Layout only: StatCard owns the single card surface and its actions. */
export function KpiGrid({children,label,dense=false}:{children:ReactNode;label:string;dense?:boolean}){
 const count=Children.toArray(children).length;
 const style={'--kpi-columns':columns(count,4),'--kpi-columns-wide':columns(count,6),'--kpi-columns-tablet':columns(count,3)} as CSSProperties;
 return <div className={`kpiGrid${dense?' kpiGridDense':''}`} style={style} role="group" aria-label={label}>{children}</div>;
}
