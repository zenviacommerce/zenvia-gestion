import {reconcileShipmentCreation} from './shippingReconciliation.ts';
export async function runCreationReconciliationWorker(admin:any,request:typeof fetch=fetch){
 const enabled=await admin.rpc('shipping_creation_worker_enabled');
 if(enabled.error)throw Error('CREATION_CANDIDATES_UNAVAILABLE');
 if(enabled.data!==true)return {processed:0,recovered:0,released:0,pending:0,failed:0,paused:true};
 const candidates=await admin.rpc('shipping_creation_candidates',{p_limit:5});
 if(candidates.error||!Array.isArray(candidates.data))throw Error('CREATION_CANDIDATES_UNAVAILABLE');
 const result={processed:0,recovered:0,released:0,pending:0,failed:0},started=Date.now();
 for(const item of candidates.data.slice(0,5)){
  if(Date.now()-started>40000)break;
  result.processed++;
  try{const value=await reconcileShipmentCreation(admin,item.owner_id,item.order_id,request);if(value?.status==='recovered')result.recovered++;else if(value?.status==='released')result.released++;else result.pending++;}
  catch{result.failed++;}
 }
 return result;
}
