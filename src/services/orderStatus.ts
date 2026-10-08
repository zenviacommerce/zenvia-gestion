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
  if(order.labelCancelledAt&&!hasShippingLabel(order)&&!isCancelledOrder(order))return false;
  if(isReadyForDispatch(order))return false;
  const status=orderStatusCode(order);
  return status==='fulfilled'||status==='shipped'||status==='delivered';
}

export function isLabelledOrder(order:FulfillmentOrder){
  return hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);
}

export function isPendingOrder(order:FulfillmentOrder){
  return !order.cancellations?.some(op=>['submitting','pending','unknown'].includes(op.status))&&!hasShippingLabel(order)&&!isCancelledOrder(order)&&!isProcessedOrder(order);
}
