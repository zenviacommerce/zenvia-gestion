import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ShipmentTrackingHistory} from '../src/components/ShipmentTrackingHistory';
afterEach(cleanup);
it('loads once on opening detail, renders original event and Spanish date without polling',async()=>{
 const load=vi.fn(async()=>[{state:'exception' as const,code:'delivery_failed',message:'Destinatario ausente',eventAt:'2026-10-21T08:15:00Z',eventTimeRaw:null,observedAt:'2026-10-22T10:00:00Z'}]);
 const ui=render(<ShipmentTrackingHistory orderId="one" shipmentKey="label-one" loadEvents={load}/>);
 expect(await screen.findByText('Destinatario ausente')).toBeTruthy();expect(screen.getByText('21/10/2026, 10:15')).toBeTruthy();expect(screen.getByText('Incidencia')).toBeTruthy();expect(screen.getByText('delivery_failed')).toBeTruthy();
 ui.rerender(<ShipmentTrackingHistory orderId="one" shipmentKey="label-one" loadEvents={load}/>);expect(load).toHaveBeenCalledTimes(1);
});
it('ignores a late response after changing label and shows civil time without inventing a zone',async()=>{
 let resolve!:(rows:any[])=>void;const load=vi.fn().mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValueOnce([{state:'in_transit',code:'2',message:'Nuevo envío',eventAt:null,eventTimeRaw:'2026-10-21 20:16:11',observedAt:'2026-10-22T10:00:00Z'}]);
 const ui=render(<ShipmentTrackingHistory orderId="one" shipmentKey="old" loadEvents={load}/>);ui.rerender(<ShipmentTrackingHistory orderId="one" shipmentKey="new" loadEvents={load}/>);
 expect(await screen.findByText('Nuevo envío')).toBeTruthy();resolve([{message:'Antiguo envío',state:'delivered'}]);await waitFor(()=>expect(screen.queryByText('Antiguo envío')).toBeNull());expect(screen.getByText('21/10/2026 20:16:11 (zona no indicada)')).toBeTruthy();
});
