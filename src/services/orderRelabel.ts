import {canRelabelCancelledShipment} from '../../supabase/functions/_shared/amazonShippingEligibility';
import type {FulfillmentOrder} from './orders';
export function canRelabelOrder(order:FulfillmentOrder){
 return canRelabelCancelledShipment({source_channel:order.sourceChannel,source_status:order.sourceStatus,shipping_provider:order.shippingProvider,tracking_status_code:order.trackingStatusCode,label_cancelled_at:order.labelCancelledAt,pii_purged_at:order.piiPurgedAt,external_shipment:order.shippingCostSource==='external_manual',shipping_remote_id:order.shippingRemoteId,sendcloud_parcel_id:order.sendcloudParcelId,label_created_at:order.labelCreatedAt,shipping_label_url:order.shippingLabelUrl});
}
