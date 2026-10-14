import type { FulfillmentOrder } from './orders';

export function orderStatusCode(order:FulfillmentOrder){
  return String(order.sourceStatus||'').trim().toLowerCase();
}

export function isCancelledOrder(order:FulfillmentOrder){
  return orderStatusCode(order).includes('cancel');
}

export function hasShippingLabel(order:FulfillmentOrder){
  return Boolean(order.sendcloudParcelId||order.shippingRemoteId||order.labelCreatedAt);
}

export function isReadyForDispatch(order:FulfillmentOrder){
  if(!hasShippingLabel(order))return false;
  const raw=`${order.trackingStatusCode||''} ${order.trackingStatusMessage||''}`.toLowerCase().replace(/[_-]+/g,' ');
  return raw.includes('ready to send')||raw.includes('ready for shipment')||raw.includes('announced')||raw.includes('being announced')||raw.includes('no label');
}

export function isProcessedOrder(order:FulfillmentOrder){
  if(isCancelledOrder(order))return false;
  // Marketplace fulfillment confirms dispatch independently of carrier pickup.
  const confirmedStatus=orderStatusCode(order);
  if(['fulfilled','shipped','delivered'].includes(confirmedStatus))return true;
  if(isReadyForDispatch(order))return false;
  const status=orderStatusCode(order);
  return status==='fulfilled'||status==='shipped'||status==='delivered';
}

export function isLabelledOrder(order:FulfillmentOrder){
  return hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);
}

export function isAmazonAwaitingPayment(order:FulfillmentOrder){
  const status=orderStatusCode(order).replace(/[^a-z]/g,'');
  return order.sourceChannel==='amazon'&&['pending','pendingavailability','invoiceunconfirmed'].includes(status);
}

export function isPendingOrder(order:FulfillmentOrder){
  return !isAmazonAwaitingPayment(order)&&!hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);
}
