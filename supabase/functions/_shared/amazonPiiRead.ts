// Hold the same owner-scoped order lease observed by the purge runner for the
// entire external operation. Eight minutes exceeds Edge's 400s wall-clock.
// Quotes consume the owner-scoped row already read by the authenticated handler.
// They never mutate an order or exclude other readers/providers.
export async function withOrderQuote(_admin:any,order:any,operation:()=>Promise<any>,denied:(message:string,status:number)=>any){
 if(order.pii_purged_at)return denied('Los datos personales de este pedido se han eliminado por retención.',410);
 return operation();
}
// Every channel/provider shares this database lease for label creation. Re-read
// after claiming: a request queued behind another must not use a stale snapshot.
export async function withOrderLabelCreation(admin:any,order:any,operation:()=>Promise<any>,denied:(message:string,status:number)=>any){
 const lease=crypto.randomUUID();
 const result=await admin.rpc('integration_claim_order_shipping',{p_order_id:order.id,p_owner_id:order.owner_id,p_lease:lease});
 if(result.error)throw result.error;
 if(result.data!==true){
  const check=await admin.from('fulfillment_orders').select('pii_purged_at').eq('id',order.id).eq('owner_id',order.owner_id).maybeSingle();
  if(check.error)throw check.error;
  if(check.data?.pii_purged_at)return denied('Los datos personales de este pedido se han eliminado por retención.',410);
  return denied('Hay otra operación de envío o cancelación en curso.',409);
 }
 try{
  const fresh=await admin.from('fulfillment_orders').select('*').eq('id',order.id).eq('owner_id',order.owner_id).maybeSingle();
  if(fresh.error)throw fresh.error;
  if(!fresh.data)return denied('Pedido no encontrado.',404);
  Object.assign(order,fresh.data);
  if(order.pii_purged_at)return denied('Los datos personales de este pedido se han eliminado por retención.',410);
  if(order.external_shipment)return denied('Este pedido ya tiene un envío externo registrado.',409);
  if(order.shipping_remote_id||order.sendcloud_parcel_id||order.label_created_at)return denied('Este pedido ya tiene una etiqueta. Actualiza el pedido para consultarla.',409);
  return await operation();
 }finally{
  const released=await admin.from('fulfillment_orders').update({order_action_lease:null,order_action_lease_until:null}).eq('id',order.id).eq('owner_id',order.owner_id).eq('order_action_lease',lease);
  if(released.error)console.warn('ORDER_SHIPPING_LEASE_RELEASE_FAILED');
 }
}
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
