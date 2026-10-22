import {expect,it} from 'vitest';
import {trackingUrlForOrder} from '../src/services/orderShipping';
import type {FulfillmentOrder} from '../src/services/orders';
it('offers a manual public MRW form when a direct shipment has no recorded tracking link',()=>{
 expect(trackingUrlForOrder({shippingProvider:'mrw',trackingNumber:'test-only'} as FulfillmentOrder)).toBe('https://www.mrw.es/seguimiento/');
});
it('does not offer a public form for Sendcloud MRW, absent shipment numbers, or purged orders',()=>{
 for(const order of [{shippingProvider:'sendcloud',carrierCode:'mrw',trackingNumber:'test-only'},{shippingProvider:'mrw'},{shippingProvider:'mrw',trackingNumber:'test-only',piiPurgedAt:'2026-10-22'}])expect(trackingUrlForOrder(order as FulfillmentOrder)).toBeNull();
});
