import {supabase,getActiveTenant} from './supabase';
import type {ImportKind,ImportJob,ImportItem} from '../../shared/imports/contracts';
import {reviewPayload} from '../../shared/imports/observer';
export type {ImportKind,ImportJob,ImportItem};
export const IMPORT_JOBS_EVENT='zenvia:imports-changed';
const changed=()=>window.dispatchEvent(new CustomEvent(IMPORT_JOBS_EVENT));
export async function importApi<T>(body:Record<string,unknown>):Promise<T>{
 const {data,error}=await supabase.functions.invoke('import-jobs',{body});
 if(error){let message=error.message;try{const json=await (error as {context?:Response}).context?.json();message=json?.error||message;}catch{/* network errors have no JSON body */}throw new Error(message);}
 if(data?.error)throw new Error(data.error);return data as T;
}
export type AmazonObservedJob={id:string;source:string;status:string;rows_processed:number;last_error:string|null;created_at:string;updated_at:string};
export async function loadImportSnapshot(){return importApi<{jobs:ImportJob[];amazon:AmazonObservedJob[]}>({action:'list'});}
export async function loadImportJobs(){return (await loadImportSnapshot()).jobs;}
export function loadImportJob(id:string){return importApi<{job:ImportJob;items:ImportItem[]}>({action:'detail',jobId:id});}
export async function enqueueImport(input:{kind:ImportKind;accountId?:string|null;sourceDocumentIds?:string[];gmailIds?:string[];options?:Record<string,unknown>;requestKey?:string}){
 const {job}=await importApi<{job:ImportJob}>({action:'enqueue',...input,requestKey:input.requestKey||crypto.randomUUID()});changed();return job;
}
export async function uploadImportSources(files:File[],kind:ImportKind,source:'manual'|'camera'='manual',onProgress?:(current:number,total:number)=>void){
 if(!files.length||files.length>100)throw new Error('Selecciona entre 1 y 100 documentos.');
 const tenant=getActiveTenant()?.workspace_id,tenantUrl=getActiveTenant()?.supabase_url;const storage=supabase.storage,auth=supabase.auth;
 const {data}=await auth.getSession();const userId=data.session?.user.id;if(!userId)throw new Error('Sesión no válida.');
 const assertScope=async()=>{const current=await auth.getSession();if(getActiveTenant()?.workspace_id!==tenant||getActiveTenant()?.supabase_url!==tenantUrl||current.data.session?.user.id!==userId)throw new Error('La empresa o sesión ha cambiado. Vuelve a iniciar la importación.');};
 const ids:string[]=[];
 for(const file of files){
  await assertScope();if(file.size>20*1024*1024)throw new Error(`${file.name} supera 20 MB.`);
  const upload=await importApi<{bucket:string;path:string;token:string}>({action:'prepare_source',kind,name:file.name,size:file.size});await assertScope();
  const {error}=await storage.from(upload.bucket).uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type||undefined});if(error)throw error;
  await assertScope();const {source:original}=await importApi<{source:{id:string}}>({action:'register_source',kind,bucket:upload.bucket,path:upload.path,name:file.name,mimeType:file.type,source});ids.push(original.id);onProgress?.(ids.length,files.length);
 }
 await assertScope();return ids;
}
export async function startDocumentImport(files:File[],kind:ImportKind,options:Record<string,unknown>={},onProgress?:(current:number,total:number)=>void){
 const tenant=getActiveTenant()?.workspace_id,tenantUrl=getActiveTenant()?.supabase_url;const {data}=await supabase.auth.getSession();const identity=data.session?.user.id;
 const ids=await uploadImportSources(files,kind,options.source==='camera'?'camera':'manual',onProgress);const current=await supabase.auth.getSession();if(getActiveTenant()?.workspace_id!==tenant||getActiveTenant()?.supabase_url!==tenantUrl||current.data.session?.user.id!==identity)throw new Error('La empresa o sesión ha cambiado. Vuelve a iniciar la importación.');return enqueueImport({kind,sourceDocumentIds:ids,options});
}
export async function reviewImportItem(item:ImportItem,candidate:Record<string,unknown>){const result=await importApi<{job:ImportJob;items:ImportItem[]}>(reviewPayload(item,candidate));changed();return result;}
export async function actOnImport(jobId:string,action:'cancel'|'retry'){const result=await importApi<{job:ImportJob;items:ImportItem[]}>({action,jobId});changed();return result;}
export function loadImportOriginal(sourceId:string){return importApi<{url:string;name:string;mimeType:string}>({action:'original',sourceId});}
export async function fileForImportItem(item:ImportItem){if(!item.source_document_id)throw new Error('No se conserva el original.');const source=await loadImportOriginal(item.source_document_id);const response=await fetch(source.url);if(!response.ok)throw new Error('No se pudo abrir el original.');return new File([await response.blob()],source.name,{type:source.mimeType});}

export async function prepareManualImportReview(item:ImportItem){const result=await importApi<{job:ImportJob;items:ImportItem[]}>({action:'manual_review',jobId:item.job_id,itemId:item.id,version:item.version});changed();return result;}
