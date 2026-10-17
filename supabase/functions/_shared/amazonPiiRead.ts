// Hold the same owner-scoped order lease observed by the purge runner for the
// entire external operation. Eight minutes exceeds Edge's 400s wall-clock.
export async function withAmazonBuyerRead(admin:any,order:any,operation:()=>Promise<any>,denied:(message:string,status:number)=>any){
  if(order.source_channel!=='amazon')return operation();
  const lease=crypto.randomUUID();
  const result=await admin.rpc('amazon_pii_claim_external_read',{p_order_id:order.id,p_owner_id:order.owner_id,p_lease:lease});
  if(result.error)throw new Error('No se pudo proteger el acceso a los datos del pedido.');
  if(result.data!=='claimed')return denied(result.data==='purged'?'Los datos personales de este pedido se han eliminado por retención.':'Hay otra operación sobre el pedido. Inténtalo de nuevo.',result.data==='purged'?410:result.data==='not_found'?404:409);
  try{return await operation();}
  finally{
    try{
      const released=await admin.from('fulfillment_orders').update({order_action_lease:null,order_action_lease_until:null}).eq('id',order.id).eq('owner_id',order.owner_id).eq('order_action_lease',lease);
      if(released.error)console.warn('AMAZON_PII_READ_LEASE_RELEASE_FAILED');
    }catch{console.warn('AMAZON_PII_READ_LEASE_RELEASE_FAILED');}
  }
}
