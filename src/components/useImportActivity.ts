import {useEffect,useRef} from 'react';
import {startActivity} from '../services/activity';
export function useImportActivity(active:boolean,label:string,detail:string,current?:number,total?:number){
 const activity=useRef<ReturnType<typeof startActivity>|null>(null);
 useEffect(()=>{if(active)activity.current=startActivity({scope:'imports',label,detail,showAfterMs:0});return()=>{activity.current?.finish();activity.current=null;};},[active,label]);
 useEffect(()=>{activity.current?.update({detail,current,total,waitingReview:detail==='Revisión preparada',progress:total&&current!=null?current/total*100:undefined});},[detail,current,total]);
}
