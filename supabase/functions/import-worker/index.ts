import {workerAuthorized} from '../../../shared/imports/workerAuth.ts';
import {createAdminClient,getAdminKey} from '../_shared/amazon/supabase.ts';
import {runImportBatch} from '../../../shared/imports/worker.ts';
import {workerRepository,jobForItem} from '../_shared/imports/repository.ts';
import {executeImport} from '../_shared/imports/registry.ts';
import {importError} from '../../../shared/imports/state.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Método no permitido',{status:405});
 try{
  if(!workerAuthorized(getAdminKey(),req.headers.get('x-import-worker-secret'),req.headers.get('apikey')))return Response.json({error:'Llamada interna no autorizada.'},{status:401});const admin=createAdminClient(),repository=workerRepository(admin);const committed=new Set<string>();
  const result=await runImportBatch({...repository,finish:async(item,outcome)=>committed.has(item.id)||await repository.finish(item,outcome)},async item=>{
   const job=await jobForItem(admin,item);const outcome=await executeImport(admin,job,item);if(outcome.committed)committed.add(item.id);return outcome;
  });
  return Response.json({ok:true,...result});
 }catch(error){return Response.json({error:importError(error).message},{status:500});}
});
