import {cleanup,fireEvent,render,screen} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({list:vi.fn()}));vi.mock('../src/services/pickupReports',()=>({listPickupReports:f.list,previewPickupReport:vi.fn(),createPickupReports:vi.fn(),getPickupReport:vi.fn()}));
import {PickupOrderMembership} from '../src/components/PickupReports';
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('refreshes the visible order membership after a report is signed or annulled',async()=>{const row={id:'report',number:'REC-SYNTHETIC-1',carriers:['MRW'],document:{status:'pending'}};f.list.mockResolvedValueOnce([row]).mockResolvedValueOnce([{...row,document:{status:'signed'}}]);render(<PickupOrderMembership orderId="synthetic-order" onOpen={()=>{}}/>);await screen.findByText(/Pendiente/);fireEvent(window,new CustomEvent('zenvia:pickup-reports-changed'));expect(await screen.findByText(/Firmado/)).toBeTruthy()});
