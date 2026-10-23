type ShipmentEligibilityOrder={source_channel?:string;source_status?:string|null;shipping_provider?:string|null;tracking_status_code?:string|null;label_cancelled_at?:string|null;pii_purged_at?:string|null;external_shipment?:unknown;shipping_remote_id?:string|null;sendcloud_parcel_id?:number|null;label_created_at?:string|null;shipping_label_url?:string|null};

// Cancellation of the shipment does not cancel the marketplace order. Only a
// recorded cancellation / machine code can reopen preparation; messages cannot.
export function canRelabelCancelledShipment(order:ShipmentEligibilityOrder){
 const source=String(order.source_status||'').toLowerCase().replace(/[^a-z]/g,'');
 if(source.includes('cancel')||['delivered','returned','refunded'].includes(source)||order.pii_purged_at||order.external_shipment)return false;
 if(order.source_channel==='amazon'&&!['unshipped','partiallyshipped','shipped'].includes(source))return false;
 if(order.shipping_remote_id||order.sendcloud_parcel_id||order.label_created_at||order.shipping_label_url)return false;
 const code=String(order.tracking_status_code||'').trim().toUpperCase();
 return !!order.label_cancelled_at||['CANCELLED','CANCELED'].includes(code)||(order.shipping_provider==='envia'&&code==='4');
}
export function assertAmazonOrderShippable(order:ShipmentEligibilityOrder){
 if(order.source_channel!=='amazon')return;
 const status=String(order.source_status||'').toLowerCase().replace(/[^a-z]/g,'');
 if(!['unshipped','partiallyshipped'].includes(status)&&!canRelabelCancelledShipment(order)){
  throw new Error('El pedido de Amazon no está confirmado para enviar. Espera a que Amazon confirme el pago y lo marque como pendiente de envío.');
 }
}
