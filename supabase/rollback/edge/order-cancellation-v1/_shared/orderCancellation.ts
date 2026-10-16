const cancellationReasons:any={customer:{amazon:'BuyerCanceled',shopify:'CUSTOMER'},inventory:{amazon:'NoInventory',shopify:'INVENTORY'},address:{amazon:'ShippingAddressUndeliverable',shopify:'OTHER'},other:{amazon:'GeneralAdjustment',shopify:'OTHER'}};
function reason(value:string){const found=cancellationReasons[value];if(!found)throw new Error('Motivo de cancelación no válido.');return found;}
function xmlEscape(value:string){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
export function amazonCancellationXml(sellerId:string,orderId:string,itemIds:string[],reasonKey:string){
 if(!/^\d{3}-\d{7}-\d{7}$/.test(orderId)||!sellerId||!itemIds.length)throw new Error('Faltan los identificadores del pedido Amazon.');
 return `<?xml version="1.0" encoding="UTF-8"?><AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd"><Header><DocumentVersion>1.01</DocumentVersion><MerchantIdentifier>${xmlEscape(sellerId)}</MerchantIdentifier></Header><MessageType>OrderAcknowledgement</MessageType><Message><MessageID>1</MessageID><OrderAcknowledgement><AmazonOrderID>${xmlEscape(orderId)}</AmazonOrderID><StatusCode>Failure</StatusCode>${itemIds.map(id=>`<Item><AmazonOrderItemCode>${xmlEscape(id)}</AmazonOrderItemCode><CancelReason>${reason(reasonKey).amazon}</CancelReason></Item>`).join('')}</OrderAcknowledgement></Message></AmazonEnvelope>`;
}
export function shopifyCancellationInput(orderId:string,options:any){
 if(!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))throw new Error('Identificador Shopify no válido.');
 return {orderId,reason:reason(options.reason).shopify,notifyCustomer:false,refundMethod:{originalPaymentMethodsRefund:options.refund===true},restock:options.restock!==false};
}
export function carrierCancellationResult(provider:string,payload:any){
 if(provider==='envia'&&payload?.meta==='error')throw new Error(payload.error?.message||payload.error?.description||'Envia.com rechazó la cancelación.');
 const data=Array.isArray(payload?.data)?payload.data[0]:payload?.data||payload;
 const status=String(data?.status||payload?.status||'').toLowerCase();
 if(['cancelled','canceled','success','confirmed'].includes(status)||data?.cancelled===true||data?.canceled===true)return {status:'confirmed',message:'El transportista aceptó la anulación.'};
 if(['pending','cancellation_requested','cancellation_pending','requested','in_progress'].includes(status))return {status:'pending',message:'Anulación solicitada; pendiente de confirmación del transportista.'};
 if(['error','failed','rejected'].includes(status)||data?.cancelled===false)throw new Error(data?.message||payload?.message||'El transportista rechazó la anulación.');
 return {status:'unknown',message:'La respuesta no confirma la anulación. Comprueba el estado con el transportista.'};
}
function xmlTag(xml:string,tag:string){return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,'i'))?.[1]?.trim()||'';}
export function amazonFeedResult(xml:string){
 const errors=xmlTag(xml,'MessagesWithError'),success=xmlTag(xml,'MessagesSuccessful');
 if(Number(errors)>0||/<ResultCode>\s*Error\s*<\/ResultCode>/i.test(xml))return {status:'rejected',message:xmlTag(xml,'ResultDescription')||'Amazon rechazó la cancelación.'};
 if(errors==='0'&&Number(success)>0)return {status:'confirmed',message:'Amazon procesó la cancelación.'};
 return {status:'unknown',message:'El informe de Amazon no confirma la cancelación.'};
}
export async function assertNoCancellation(admin:any,order:any){
 const result=await admin.from('order_cancellation_operations').select('id').eq('owner_id',order.owner_id).eq('order_id',order.id).in('status',['submitting','pending','unknown']).limit(1);
 if(result.error)throw result.error;if(result.data?.length)throw new Error('El pedido tiene una cancelación pendiente. Comprueba su resultado antes de generar o confirmar envíos.');
 const source=await admin.from('order_cancellation_operations').select('id').eq('owner_id',order.owner_id).eq('order_id',order.id).eq('kind','order').eq('status','confirmed').limit(1);
 if(source.error)throw source.error;if(source.data?.length||String(order.source_status||'').includes('cancel'))throw new Error('El pedido está cancelado.');
}
export async function claimOrderShipping(admin:any,order:any){
 const lease=crypto.randomUUID();const result=await admin.rpc('integration_claim_order_shipping',{p_order_id:order.id,p_owner_id:order.owner_id,p_lease:lease});
 if(result.error)throw result.error;if(!result.data)throw new Error('Hay otra operación de envío o cancelación en curso.');return {id:order.id,ownerId:order.owner_id,lease};
}
export async function releaseOrderShipping(admin:any,claim:any){if(claim)await admin.from('fulfillment_orders').update({order_action_lease:null,order_action_lease_until:null}).eq('id',claim.id).eq('owner_id',claim.ownerId).eq('order_action_lease',claim.lease);}
