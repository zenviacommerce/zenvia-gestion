import {useEffect,useRef} from 'react';
import {ENTITY_CHANGED,type SharedEntity} from '../services/entityChanges';
// Subscribe retained screens without remounting or destroying drafts/imports.
export function useEntityRefresh(entities:SharedEntity[],reload:()=>void|Promise<unknown>){
 const latest=useRef(reload);latest.current=reload;
 const key=entities.join(',');
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const changed=(event:Event)=>{if(!key.split(',').includes((event as CustomEvent).detail))return;clearTimeout(timer);timer=setTimeout(()=>{void latest.current()},0)};
  window.addEventListener(ENTITY_CHANGED,changed);
  return()=>{clearTimeout(timer);window.removeEventListener(ENTITY_CHANGED,changed)};
 },[key]);
}
