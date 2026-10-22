import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PickupReportHistory} from '../src/components/PickupReports';
const f=vi.hoisted(()=>({get:vi.fn(async()=>({id:'r1',number:'REC-1'})),pdf:vi.fn(async()=>{})}));
vi.mock('../src/services/pickupReports',()=>({listPickupReports:async()=>[{id:'r1',number:'REC-1',createdAt:'2026-10-22T08:00:00Z',totalOrders:9,totalPackages:9,carriers:['MRW']}],getPickupReport:f.get,previewPickupReport:vi.fn(),createPickupReport:vi.fn()}));
vi.mock('../src/services/pickupReportPdf',()=>({downloadPickupReportPdf:f.pdf}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('embeds the existing history as a region and reprints the saved report without creating a new one',async()=>{
 render(<PickupReportHistory embedded onClose={()=>{}}/>);
 await screen.findByText('REC-1');expect(screen.getByRole('region',{name:'Informes de recogida'})).toBeTruthy();expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Reimprimir REC-1'}));await waitFor(()=>expect(f.pdf).toHaveBeenCalledWith({id:'r1',number:'REC-1'}));expect(f.get).toHaveBeenCalledWith('r1');
});
it('keeps the original order-specific history modal available',async()=>{
 render(<PickupReportHistory orderId="order" onClose={()=>{}}/>);await screen.findByText('REC-1');expect(screen.getByRole('dialog',{name:'Informes de recogida'})).toBeTruthy();
});
