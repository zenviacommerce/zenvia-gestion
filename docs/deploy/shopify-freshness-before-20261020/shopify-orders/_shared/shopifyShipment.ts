export async function confirmShopifyShipment(request:(query:string,variables:any)=>Promise<any>,shipment:{orderId:string;number:string;company:string;url?:string|null;previousNumber?:string|null}){
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(shipment.orderId)||!shipment.number.trim())throw new Error('Falta el pedido Shopify o el seguimiento.');
  const trackingInfo:any={number:shipment.number.trim(),company:shipment.company.trim()||'Transportista'};
  if(shipment.url){const url=new URL(shipment.url);if(!['https:','http:'].includes(url.protocol))throw new Error('Enlace de seguimiento no válido.');trackingInfo.url=url.href;}
  const fulfillmentOrders:any[]=[];let after:string|null=null,remote:any=null;
  do{
    const data=await request(`query ZenviaShipmentOrder($id:ID!,$after:String){order(id:$id){id cancelledAt fulfillments(first:250){id status trackingInfo(first:10){number}} fulfillmentOrders(first:100,after:$after){nodes{id status assignedLocation{location{id}} supportedActions{action}} pageInfo{hasNextPage endCursor}}}}`,{id:shipment.orderId,after});
    remote=data?.order;if(!remote)throw new Error('Pedido Shopify no encontrado.');
    if(remote.cancelledAt)throw new Error('El pedido Shopify está cancelado.');
    fulfillmentOrders.push(...(remote.fulfillmentOrders?.nodes||[]));
    after=remote.fulfillmentOrders?.pageInfo?.hasNextPage?remote.fulfillmentOrders.pageInfo.endCursor:null;
    if(fulfillmentOrders.length>1000)throw new Error('Demasiadas órdenes de preparación en Shopify.');
  }while(after);
  const existing=(remote.fulfillments||[]).filter((f:any)=>f.status==='SUCCESS'&&(f.trackingInfo||[]).some((t:any)=>t.number===trackingInfo.number));
  if((remote.fulfillments||[]).length>=250)throw new Error('Revisa manualmente los envíos de este pedido Shopify.');
  if(shipment.previousNumber){
    const replacements=(remote.fulfillments||[]).filter((f:any)=>f.status==='SUCCESS'&&(f.trackingInfo||[]).some((t:any)=>t.number===shipment.previousNumber));
    if(replacements.length||existing.length){
      const ids=existing.map((f:any)=>f.id);
      for(const previous of replacements){
      const result=await request(`mutation ZenviaReplaceTracking($id:ID!,$tracking:FulfillmentTrackingInput!){fulfillmentTrackingInfoUpdate(fulfillmentId:$id,trackingInfoInput:$tracking,notifyCustomer:false){fulfillment{id} userErrors{field message}}}`,{id:previous.id,tracking:trackingInfo});
      const payload=result.fulfillmentTrackingInfoUpdate;if(payload?.userErrors?.length)throw new Error(payload.userErrors.map((e:any)=>e.message).join(' · '));if(!payload?.fulfillment?.id)throw new Error('Shopify no confirmó el nuevo seguimiento.');
      ids.push(payload.fulfillment.id);
      }
      return {fulfillmentIds:ids,status:replacements.length?'confirmed':'already_synced'};
    }
  }
  const groups=new Map<string,any[]>();
  for(const fo of fulfillmentOrders){
    if(['CLOSED','CANCELLED'].includes(fo.status))continue;
    if(!(fo.supportedActions||[]).some((a:any)=>a.action==='CREATE_FULFILLMENT'))throw new Error('Shopify no permite preparar este pedido en su estado actual.');
    const location=fo.assignedLocation?.location?.id;if(!location)throw new Error('Falta la ubicación de preparación en Shopify.');
    const items:any[]=[];let cursor:string|null=null;
    do{
      const data=await request(`query ZenviaShipmentItems($id:ID!,$after:String){fulfillmentOrder(id:$id){lineItems(first:100,after:$after){nodes{id remainingQuantity} pageInfo{hasNextPage endCursor}}}}`,{id:fo.id,after:cursor});
      const connection=data?.fulfillmentOrder?.lineItems;if(!connection)throw new Error('No se pudieron consultar las cantidades pendientes de Shopify.');
      for(const item of connection.nodes||[])if(item.remainingQuantity>0)items.push({id:item.id,quantity:item.remainingQuantity});
      cursor=connection.pageInfo?.hasNextPage?connection.pageInfo.endCursor:null;
      if(items.length>10000)throw new Error('Demasiadas líneas en el pedido Shopify.');
    }while(cursor);
    if(items.length){const group=groups.get(location)||[];group.push({fulfillmentOrderId:fo.id,fulfillmentOrderLineItems:items});groups.set(location,group);}
  }
  if(!groups.size&&!existing.length)throw new Error('El pedido Shopify no tiene cantidades pendientes para este envío.');
  const ids=existing.map((f:any)=>f.id);
  for(const lineItemsByFulfillmentOrder of groups.values()){
    const result=await request(`mutation ZenviaShipmentCreate($fulfillment:FulfillmentInput!){fulfillmentCreate(fulfillment:$fulfillment){fulfillment{id} userErrors{field message}}}`,{fulfillment:{notifyCustomer:false,trackingInfo,lineItemsByFulfillmentOrder}});
    const payload=result?.fulfillmentCreate;
    if(payload?.userErrors?.length)throw new Error(payload.userErrors.map((e:any)=>e.message).join(' · '));
    if(!payload?.fulfillment?.id)throw new Error('Shopify no confirmó la creación del envío.');
    ids.push(payload.fulfillment.id);
  }
  return {fulfillmentIds:ids,status:groups.size?'confirmed':'already_synced'};
}

export function preserveShopifyLabelTracking(rows:any[],existing:any[]){
 const local=new Map(existing.filter(row=>row.label_created_at||row.label_cancelled_at).map(row=>[row.sendcloud_id,row]));
 return rows.map(row=>{
  const saved:any=local.get(row.sendcloud_id);if(!saved)return row;
  const result={...row};
  if(saved.label_cancelled_at&&!saved.label_created_at){for(const key of ['tracking_number','tracking_url','tracking_status_code','tracking_status_message','tracking_updated_at','fulfilled_at'])result[key]=null;return result;}
  for(const key of ['tracking_number','tracking_url','carrier_name','tracking_status_code','tracking_status_message','tracking_updated_at','fulfilled_at'])result[key]=saved[key]??row[key];
  if(saved.raw_payload?._zenvia_tracking)result.raw_payload={...row.raw_payload,_zenvia_tracking:saved.raw_payload._zenvia_tracking};
  return result;
 });
}
