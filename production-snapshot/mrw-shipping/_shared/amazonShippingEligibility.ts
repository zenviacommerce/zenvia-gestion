export function assertAmazonOrderShippable(order:{source_channel?:string;source_status?:string|null}){
  if(order.source_channel!=='amazon')return;
  const status=String(order.source_status||'').toLowerCase().replace(/[^a-z]/g,'');
  if(!['unshipped','partiallyshipped'].includes(status)){
    throw new Error('El pedido de Amazon no está confirmado para enviar. Espera a que Amazon confirme el pago y lo marque como pendiente de envío.');
  }
}
