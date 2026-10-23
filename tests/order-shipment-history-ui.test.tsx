import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import {OrderShipmentHistory} from '../src/components/OrderShipmentHistory';
afterEach(cleanup);
const old={id:'old',provider:'mrw',carrier:'MRW',trackingNumber:'SYNTHETIC-PREVIOUS-000123',shipmentReference:'OLD-REF',cancelledAt:'2026-10-22T12:00:00Z'};
it('keeps the full previous carrier, tracking and cancellation date after a replacement',async()=>{
 const load=vi.fn().mockResolvedValue([old]);const view=render(<OrderShipmentHistory orderId="order" shipmentKey="cancelled" loadHistory={load}/>);
 await screen.findByText(old.trackingNumber);expect(screen.getByText('MRW')).toBeTruthy();expect(screen.getByText(/22\/10\/(20)?26/)).toBeTruthy();
 view.rerender(<OrderShipmentHistory orderId="order" shipmentKey="NEW-TRACK:NEW-LABEL" loadHistory={load}/>);
 await waitFor(()=>expect(load).toHaveBeenCalledTimes(2));expect(await screen.findByText(old.trackingNumber)).toBeTruthy();cleanup();
});
it('does not invent missing legacy references and hides all history when PII is purged',async()=>{
 const load=vi.fn().mockResolvedValue([]);const view=render(<OrderShipmentHistory orderId="order" shipmentKey="cancelled" loadHistory={load} fallback={{carrier:'MRW',trackingNumber:null,cancelledAt:null}}/>);
 await screen.findByText('Tracking no disponible');expect(screen.getByText('Fecha no disponible')).toBeTruthy();
 view.rerender(<OrderShipmentHistory orderId="order" shipmentKey="purged" purged loadHistory={load}/>);expect(screen.queryByText('Expediciones anteriores')).toBeNull();cleanup();
});
