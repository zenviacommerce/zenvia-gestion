import type { GmailCandidate } from './gmail';
import type { GmailImportOutcome } from './gmailImport';
import { runGmailImportBatch } from './gmailBulkImport';

export type GmailBackgroundResult=Awaited<ReturnType<typeof runGmailImportBatch>>;
export type GmailBackgroundState={
 running:boolean; started:number; total:number; detail:string;
 result:GmailBackgroundResult|null; error:string|null;
};
let state:GmailBackgroundState={running:false,started:0,total:0,detail:'',result:null,error:null};
const listeners=new Set<()=>void>();
const notify=()=>{for(const listener of listeners)listener();};
export function subscribeGmailBackground(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
export function getGmailBackgroundState(){return state;}
export function startGmailBackgroundImport(
 candidates:GmailCandidate[],
 importer:(candidate:GmailCandidate,progress:(detail:string)=>void)=>Promise<GmailImportOutcome>,
){
 if(state.running)return false;
 state={running:true,started:0,total:candidates.length,detail:'Preparando facturas…',result:null,error:null};
 notify();
 // Keep the task owned by a module, not by the page: navigating away won't abort it.
 void runGmailImportBatch(candidates,source=>importer(source,detail=>{
   state={...state,detail:source.attachmentName+': '+detail};notify();
 }),source=>{
   state={...state,started:state.started+1,detail:'Procesando '+source.attachmentName+'…'};notify();
 }).then(result=>{
   state={...state,running:false,result,detail:'Importación finalizada'};notify();
 }).catch(error=>{
   state={...state,running:false,error:error instanceof Error?error.message:String(error),detail:'Error de importación'};notify();
 });
 return true;
}
export function dismissGmailBackgroundResult(){
 if(state.running)return;
 state={...state,result:null,error:null};notify();
}
