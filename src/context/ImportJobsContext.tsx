import {createContext,useContext,useEffect,useState,useRef,useCallback,type ReactNode} from 'react';
import {loadImportSnapshot,IMPORT_JOBS_EVENT,type ImportJob,type AmazonObservedJob} from '../services/importJobs';
import {startActivity} from '../services/activity';
import {ImportRequestGuard} from '../../shared/imports/observer';
import {showInfo} from '../services/toast';
const Context=createContext<{jobs:ImportJob[];amazon:AmazonObservedJob[];error:string;refresh:()=>Promise<void>}>({jobs:[],amazon:[],error:'',refresh:async()=>{}});
export const useImportJobs=()=>useContext(Context);
export function ImportJobsProvider({identity,onChanged,children}:{identity:string;onChanged:()=>Promise<void>|void;children:ReactNode}){
 const [jobs,setJobs]=useState<ImportJob[]>([]),[amazon,setAmazon]=useState<AmazonObservedJob[]>([]),[error,setError]=useState('');
 const guard=useRef(new ImportRequestGuard(identity)),previous=useRef<Map<string,string>>(new Map()),initialized=useRef(false),inflight=useRef(false),importedCounts=useRef<Map<string,number>>(new Map());
 const sessionStart=useRef(Date.now()),activities=useRef<Map<string,ReturnType<typeof startActivity>>>(new Map());const changedRef=useRef(onChanged);changedRef.current=onChanged;
 const refresh=useCallback(async()=>{
  if(inflight.current)return;inflight.current=true;const ticket=guard.current.ticket();
  try{
   const snapshot=await loadImportSnapshot(),next=snapshot.jobs;if(!guard.current.accepts(ticket))return;
   let dataChanged=false;
   for(const job of next){const before=previous.current.get(job.id);
    if(initialized.current&&(before?before!==job.status:new Date(job.created_at).getTime()>=sessionStart.current)&&['completed','completed_with_errors','waiting_review'].includes(job.status)){dataChanged=true;showInfo(`${job.label}: ${job.stage}.`);}
    if(initialized.current&&job.imported>(importedCounts.current.get(job.id)||0))dataChanged=true;importedCounts.current.set(job.id,job.imported);
    previous.current.set(job.id,job.status);
    if(['queued','running'].includes(job.status)){
     let activity=activities.current.get(job.id);if(!activity){activity=startActivity({key:`import:${job.id}`,scope:'imports',label:job.label,showAfterMs:0});activities.current.set(job.id,activity);}
     activity.update({detail:job.stage,current:job.processed,total:job.total,progress:job.total?job.processed/job.total*100:undefined});
    }else{activities.current.get(job.id)?.finish();activities.current.delete(job.id);}
   }
   for(const [id,activity] of activities.current)if(!next.some(j=>j.id===id)){activity.finish();activities.current.delete(id);}
   setJobs(next);setAmazon(snapshot.amazon||[]);setError('');initialized.current=true;
   if(dataChanged){void changedRef.current();window.dispatchEvent(new CustomEvent('zenvia:import-results',{detail:{jobs:next}}));window.dispatchEvent(new Event('zenvia:orders-refresh'));}
  }catch(e){if(guard.current.accepts(ticket))setError(e instanceof Error?e.message:'No se pudo consultar las importaciones.');}finally{inflight.current=false}
 },[]);
 useEffect(()=>{
  guard.current.change(identity);setJobs([]);setAmazon([]);previous.current.clear();importedCounts.current.clear();initialized.current=false;void refresh();
  const poll=window.setInterval(()=>void refresh(),5000);const observe=()=>void refresh();
  window.addEventListener(IMPORT_JOBS_EVENT,observe);window.addEventListener('focus',observe);window.addEventListener('online',observe);
  return()=>{guard.current.change('closed');clearInterval(poll);window.removeEventListener(IMPORT_JOBS_EVENT,observe);window.removeEventListener('focus',observe);window.removeEventListener('online',observe);for(const a of activities.current.values())a.finish();activities.current.clear();};
 },[identity,refresh]);
 return <Context.Provider value={{jobs,amazon,error,refresh}}>{children}</Context.Provider>;
}
