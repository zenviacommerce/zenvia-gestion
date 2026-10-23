import {createAdminClient,requireInternalSecret} from '../_shared/amazon/supabase.ts';
import {runCreationReconciliationWorker} from '../_shared/shippingReconciliationWorker.ts';
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 try{requireInternalSecret(req)}catch{return new Response('Unauthorized',{status:401})}
 try{return Response.json(await runCreationReconciliationWorker(createAdminClient()))}
 catch{return Response.json({error:'CREATION_RECONCILIATION_UNAVAILABLE'},{status:503})}
});
