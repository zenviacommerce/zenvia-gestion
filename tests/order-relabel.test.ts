import {it,expect} from 'vitest';
import * as eligibility from '../supabase/functions/_shared/amazonShippingEligibility';
const cancelled={source_channel:'amazon',source_status:'Shipped',shipping_provider:'sendcloud',tracking_status_code:'CANCELLED',fulfilled_at:'2026-10-22T10:00:00Z'};
it('allows a replacement for a cancelled shipment without treating Amazon Shipped as a new live expedition',()=>{
 expect((eligibility as any).canRelabelCancelledShipment?.(cancelled)).toBe(true);
 expect(()=>eligibility.assertAmazonOrderShippable(cancelled)).not.toThrow();
});
it('accepts a recorded label cancellation after its descriptors were cleared',()=>{
 expect((eligibility as any).canRelabelCancelledShipment?.({...cancelled,tracking_status_code:null,label_cancelled_at:'2026-10-22T11:00:00Z'})).toBe(true);
});
it.each([
 {source_status:'Canceled'}, {source_status:'Delivered'}, {source_status:'Pending'},
 {shipping_remote_id:'ACTIVE'}, {sendcloud_parcel_id:123}, {label_created_at:'2026-10-22T12:00:00Z'}, {shipping_label_url:'https://example.test/label'},
 {pii_purged_at:'2026-10-22T11:00:00Z'}, {external_shipment:{requestId:'external'}},
 {tracking_status_code:'SHIPPED',tracking_status_message:'not cancelled'},
])('rejects unsafe replacement %j',patch=>expect((eligibility as any).canRelabelCancelledShipment?.({...cancelled,...patch})).toBe(false));
it('requires a machine cancellation rather than a free-text mention',()=>{
 expect((eligibility as any).canRelabelCancelledShipment?.({...cancelled,tracking_status_code:null,tracking_status_message:'Cancelado por el cliente, no confirmado'})).toBe(false);
});
