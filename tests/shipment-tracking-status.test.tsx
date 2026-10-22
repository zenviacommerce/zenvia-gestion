import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {ShipmentTrackingStatus} from '../src/components/ShipmentTrackingStatus';
afterEach(cleanup);
it.each(['Entrega concertada','Concertada próxima entrega'])('shows the MRW appointment description visibly alongside its normalized transit state: %s',(message)=>{
 render(<ShipmentTrackingStatus order={{shippingProvider:'mrw',trackingNumber:'synthetic',trackingNormalizedState:'in_transit',trackingStatusCode:'33',trackingStatusMessage:message,trackingEventAt:'2026-10-22T10:00:00Z'}}/>);
 expect(screen.getByText('En tránsito')).toBeTruthy();
 expect(screen.getByText(message).tagName).toBe('SMALL');
});
it('retains the raw code and carrier message in the unclassified MRW tooltip without claiming a pending query',()=>{
 render(<ShipmentTrackingStatus order={{shippingProvider:'mrw',trackingNumber:'synthetic',trackingNormalizedState:null,trackingStatusCode:'999',trackingStatusMessage:'Mensaje original del transportista',trackingObservedAt:'2026-10-22T10:00:00Z',trackingError:'MRW_UNKNOWN_STATUS_999'}}/>);
 expect(screen.getByText('Estado sin clasificar').title).toBe('999 · Mensaje original del transportista');
 expect(screen.queryByText('Comprobación pendiente')).toBeNull();expect(screen.queryByText('Consulta manual disponible en el detalle')).toBeNull();
});
it('keeps missing MRW observations unavailable with manual consultation',()=>{
 render(<ShipmentTrackingStatus order={{shippingProvider:'mrw',trackingNumber:'synthetic',trackingNormalizedState:null,trackingError:'MRW_UNKNOWN_STATUS_999'}}/>);
 expect(screen.getByText('Sin seguimiento disponible')).toBeTruthy();expect(screen.getByText('Consulta manual disponible en el detalle')).toBeTruthy();
});
