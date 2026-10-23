import {normalizeStatus} from '../../supabase/functions/_shared/tracking/policy';
import type { FulfillmentOrder } from './orders';

export function orderStatusCode(order:FulfillmentOrder){
  return String(order.sourceStatus||'').trim().toLowerCase();
}

export function isCancelledOrder(order:FulfillmentOrder){
  if(order.logisticsState)return order.logisticsState==='cancelled';
  return ['cancelled','canceled','cancelled_by_customer','cancelled_by_seller'].includes(orderStatusCode(order))||Boolean(order.labelCancelledAt)||(order.trackingNormalizedState||normalizeStatus(order.shippingProvider==='envia'?'envia':'legacy',order.trackingStatusCode))==='cancelled';
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
  if(order.labelCancelledAt)return false;
  if(!hasShippingLabel(order))return order.logisticsHistorical===true;
  return Boolean(order.logisticsDispatchedAt);
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
