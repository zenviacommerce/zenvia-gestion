import {expect,it} from 'vitest';import {trackingPresentation} from '../src/services/shipmentTracking';
it('uses machine code rather than cancellation mentions and separates origin return',()=>{expect(trackingPresentation({trackingStatusCode:'SHIPPED',trackingStatusMessage:'not cancelled'}).state).toBe('in_transit');expect(trackingPresentation({shippingProvider:'envia',trackingStatusCode:'Delivered at Origin'}).state).toBe('returned')});
it('shows event time, detects missing date honestly, and stops stale warnings for terminals',()=>{const now=Date.parse('2026-10-22T10:00:00Z');const p=trackingPresentation({trackingNormalizedState:'in_transit',trackingEventAt:'2026-10-18T10:00:00Z',trackingMovementAt:'2026-10-18T10:00:00Z',trackingCheckedAt:'2026-10-22T10:00:00Z'},now);expect(p.date).toBe('2026-10-18T10:00:00Z');expect(p.staleLabel).toContain('4 días');expect(trackingPresentation({trackingNormalizedState:'delivered',trackingMovementAt:'2026-10-01T00:00:00Z'},now).staleLabel).toBeNull();expect(trackingPresentation({trackingNormalizedState:'in_transit',trackingObservedAt:'2026-10-20T10:00:00Z'},now).dateKind).toBe('Detectado')});
it('does not turn direct MRW access rejection into a legacy shipment event',()=>{
 const p=trackingPresentation({shippingProvider:'mrw',trackingNumber:'test-only',trackingStatusCode:'SHIPPED',trackingError:'MRW_TRACKING_ACCESS_DENIED'});
 expect(p.label).toBe('Sin seguimiento disponible');expect(p.state).toBeNull();expect(p.unavailable).toBe(true);expect(p.staleLabel).toBeNull();
});
it('keeps a known MRW observation while disclosing unavailable automatic updates',()=>{
 const p=trackingPresentation({shippingProvider:'mrw',trackingNumber:'test-only',trackingNormalizedState:'in_transit',trackingEventAt:'2026-10-20T10:00:00Z',trackingError:'ACCOUNT_PAUSED'});
 expect(p.label).toBe('En tránsito');expect(p.date).toBe('2026-10-20T10:00:00Z');expect(p.unavailable).toBe(true);
});
it('shows unavailable direct MRW without an observation and leaves Sendcloud MRW unchanged',()=>{
 expect(trackingPresentation({shippingProvider:'mrw',trackingNumber:'test-only',trackingStatusCode:'SHIPPED'}).label).toBe('Sin seguimiento disponible');
 const sendcloud=trackingPresentation({shippingProvider:'sendcloud',trackingNumber:'test-only',trackingStatusCode:'SHIPPED',trackingError:'PROVIDER_HTTP_503'});
 expect(sendcloud.state).toBe('in_transit');expect(sendcloud.unavailable).toBe(false);
});
