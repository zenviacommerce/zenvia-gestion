import {importLabel,type ImportJob,type ImportItem,type ImportOutcome,type ImportKind} from '../../../../shared/imports/contracts.ts';
import {checked,guardImportItem,requireModule,ensureImportScheduler} from './repository.ts';
import {syncAccountShipments,monthKeys} from './enviaCore.ts';
import {createAdminClient,getAdminKey} from '../amazon/supabase.ts';
export async function enqueueOrderImport(admin:any,caller:any,kind:ImportKind,options:Record<string,unknown>,accountId?:string){
 requireModule(caller,kind);await ensureImportScheduler(admin);const provider=kind==='shopify_orders'?'shopify':kind==='envia_shipments'?'envia':'sendcloud';
 let query=admin.from('integration_accounts').select('id,display_name').eq('owner_id',caller.data_owner_id).eq('provider',provider).eq('enabled',true);if(accountId)query=query.eq('id',accountId);
 const accounts=await checked<any[]>(query);if(!accounts.length)throw new Error('No hay cuentas conectadas.');
 const job=await checked<any>(admin.rpc('import_enqueue',{p_owner:caller.data_owner_id,p_actor:caller.user_id,p_kind:kind,p_module:'orders',p_label:importLabel[kind],p_request_key:crypto.randomUUID(),p_account:accountId||null,p_options:options,p_items:accounts.map(a=>({key:a.id,label:a.display_name,input:{accountId:a.id}}))}));
 const promise=fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/import-worker`,{method:'POST',headers:{apikey:getAdminKey(),'x-import-worker-secret':getAdminKey(),'Content-Type':'application/json'},body:'{}'}).then(()=>undefined).catch(()=>undefined);(globalThis as any).EdgeRuntime?.waitUntil(promise);
 return job;
}
export async function executeEnvia(admin:any,job:ImportJob,item:ImportItem):Promise<ImportOutcome>{
 const account=await checked<any>(admin.from('integration_accounts').select('*').eq('owner_id',job.owner_id).eq('id',item.input.accountId).eq('provider','envia').eq('enabled',true).single());
 const periods=(item.checkpoint.periods as Array<{month:number;year:number}>)||monthKeys(Math.max(1,Math.min(Number(job.options.months)||2,12)));
 const index=Number(item.checkpoint.periodIndex)||0,offset=Number(item.checkpoint.offset)||0;
 if(!periods[index])return {status:'imported',result:{synced:Number(item.checkpoint.synced)||0}};
 const result=await syncAccountShipments(admin,job.owner_id,account,Number(job.options.months)||2,{period:periods[index],offset,limit:5,guard:()=>guardImportItem(admin,job,item),write:async(id,patch)=>{await checked(admin.rpc('import_order_write',{p_item:item.id,p_lease:item.lease_token,p_action:'update',p_rows:[{...patch,id}]}))},remove:async(id)=>{await checked(admin.rpc('import_order_write',{p_item:item.id,p_lease:item.lease_token,p_action:'delete_synthetic',p_rows:[{id}]}))}});
 const synced=(Number(item.checkpoint.synced)||0)+result.synced;const periodIndex=result.nextOffset==null?index+1:index;
 return {status:periodIndex<periods.length?'queued':'imported',stage:`Envia.com · ${synced} envíos`,checkpoint:{periods,periodIndex,offset:result.nextOffset||0,synced},result:{synced,accountId:account.id}};
}
