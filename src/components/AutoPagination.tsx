import {mirrorPaginationBars,clearPaginationMirrors} from '../services/paginationBars';
import { useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import {CONTROL_CLASS,collectTargets,renderTarget} from '../services/autoListPagination';
export function AutoPagination(){
  const {preferences}=useSettings();
  const pageSize=preferences.pageSize;
  useEffect(()=>{
    let scheduled=false;let frame=0;
    const apply=()=>{scheduled=false;collectTargets().forEach(target=>renderTarget(target,pageSize));mirrorPaginationBars();};
    const schedule=()=>{if(scheduled)return;scheduled=true;frame=window.requestAnimationFrame(apply);};
    schedule();
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled']});
    window.addEventListener('resize',schedule);
    return()=>{observer.disconnect();window.cancelAnimationFrame(frame);clearPaginationMirrors();window.removeEventListener('resize',schedule);document.querySelectorAll(`.${CONTROL_CLASS}`).forEach(node=>node.remove());};
  },[pageSize]);
  return null;
}
