import {getAdminKey} from '../amazon/supabase.ts';
import type {ImportItem,ImportJob,ImportOutcome} from '../../../../shared/imports/contracts.ts';
import {importModule} from '../../../../shared/imports/contracts.ts';
export async function checked<T>(request:PromiseLike<{data:T|null;error:any}>):Promise<T>{const {data,error}=await request;if(error)throw error;return data as T;}
export async function assertJobAccess(admin:any,job:ImportJob,actor=job.created_by){
 const allowed=await checked(admin.rpc('import_actor_allowed',{p_owner:job.owner_id,p_module:job.module,p_actor:actor}));
 if(!allowed)throw new Error('El usuario o la empresa no tienen acceso a esta importación.');
}
export function workerRepository(admin:any){return {
 claim:async()=>await checked<ImportItem[]>(admin.rpc('import_claim_items',{limit_count:2})),
 finish:async(item:ImportItem,outcome:ImportOutcome)=>await checked<boolean>(admin.rpc('import_finish_item',{item_id:item.id,lease_token:item.lease_token,outcome})),
};}
export async function jobForItem(admin:any,item:ImportItem):Promise<ImportJob>{
 const job=await checked<ImportJob>(admin.from('import_jobs').select('*').eq('id',item.job_id).eq('owner_id',item.owner_id).single());
 await assertJobAccess(admin,job);if(job.cancel_requested)throw new Error('Importación cancelada.');return job;
}
export function requireModule(caller:any,kind:any){const module=importModule(kind);if(caller.role!=='admin'&&(module==='settings'||!caller.permissions?.includes(module)))throw new Error('No tienes permiso para esta importación.');return module;}
export async function guardImportItem(admin:any,job:ImportJob,item:ImportItem){
 await assertJobAccess(admin,job);
 const live=await checked<any>(admin.from('import_job_items').select('id').eq('id',item.id).eq('lease_token',item.lease_token).eq('status','running').gt('lease_until',new Date().toISOString()).maybeSingle());
 if(!live)throw new Error('La tarea está cancelada o su lease ha caducado.');
}

export async function ensureImportScheduler(admin:any){await checked(admin.rpc('import_configure_worker',{p_url:Deno.env.get('SUPABASE_URL'),p_key:getAdminKey()}));}
