import type { FulfillmentOrder, LabelResult } from './orders';
import {removeViewCache} from './viewCache';
export const ORDERS_SNAPSHOT_CACHE='dashboard:orders';
export const ORDERS_SNAPSHOT_EVENT='zenvia:orders-snapshot';
let revision=0;
let current:FulfillmentOrder[]|null=null;
export function resetOrdersSnapshot(){current=null;revision++;removeViewCache(ORDERS_SNAPSHOT_CACHE);if(typeof window!=='undefined')window.dispatchEvent(new Event(ORDERS_SNAPSHOT_EVENT));}
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('zenvia:tenant-changed',resetOrdersSnapshot);
export function ordersSnapshotVersion(){return revision;}
// Operational recipients must not outlive the current page in browser storage.
removeViewCache(ORDERS_SNAPSHOT_CACHE);
export function readOrdersSnapshot(){return current??[];}
export function publishOrdersSnapshot(orders:FulfillmentOrder[],expectedRevision?:number){
  if(expectedRevision!=null&&expectedRevision!==revision)return readOrdersSnapshot();
  current=orders;revision++;
  removeViewCache(ORDERS_SNAPSHOT_CACHE);
  if(typeof window!=='undefined')window.dispatchEvent(new Event(ORDERS_SNAPSHOT_EVENT));
  return orders;
}
export function markOrderLabelCreated(orderId:string,result:Partial<LabelResult>){
  const now=new Date().toISOString();
  publishOrdersSnapshot(readOrdersSnapshot().map(order=>order.id!==orderId?order:{...order,
    labelCreatedAt:order.labelCreatedAt||now,
    shippingProvider:result.provider||order.shippingProvider,
    shippingRemoteId:result.shipmentId||result.trackingNumber||order.shippingRemoteId,
    sendcloudParcelId:result.parcelId||order.sendcloudParcelId,
    trackingNumber:result.trackingNumber||order.trackingNumber,
    carrierName:result.carrierName||order.carrierName,
  }));
}
