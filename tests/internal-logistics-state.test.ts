// @vitest-environment node
import {expect,it} from 'vitest';
import {isProcessedOrder,isLabelledOrder} from '../src/services/orderStatus';
import type {FulfillmentOrder} from '../src/services/orders';
const label={id:'test',sourceStatus:'shipped',shippingProvider:'mrw',labelCreatedAt:'2026-10-23T08:00:00Z',trackingNumber:'TEST',shippingRemoteId:'TEST'} as FulfillmentOrder;
it('marketplace confirmation and legacy SHIPPED text leave an active label in the warehouse',()=>{
 expect(isProcessedOrder({...label,trackingStatusCode:'SHIPPED'})).toBe(false);
 expect(isLabelledOrder(label)).toBe(true);
});
it('dispatch evidence belongs to the current active label',()=>{
 expect(isProcessedOrder({...label,logisticsDispatchedAt:'2026-10-23T09:00:00Z',logisticsDispatchCause:'manual'} as FulfillmentOrder)).toBe(true);
 expect(isProcessedOrder({...label,labelCancelledAt:'2026-10-23T09:30:00Z',logisticsDispatchedAt:'2026-10-23T09:00:00Z'} as FulfillmentOrder)).toBe(false);
});
it('a legacy carrier cancellation is not in the warehouse queue',()=>expect(isLabelledOrder({...label,trackingStatusCode:'CANCELLED'})).toBe(false));

it('an old labelled history stays shipped without inventing dispatch evidence',()=>{expect(isProcessedOrder({...label,logisticsHistorical:true})).toBe(true);expect(isLabelledOrder({...label,logisticsHistorical:true})).toBe(false)});
