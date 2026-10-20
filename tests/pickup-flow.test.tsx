import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({preview:vi.fn(),create:vi.fn(),list:vi.fn(),get:vi.fn(),download:vi.fn()}));
vi.mock('../src/services/pickupReports',()=>({previewPickupReport:api.preview,createPickupReport:api.create,listPickupReports:api.list,getPickupReport:api.get}));
vi.mock('../src/services/pickupReportPdf',()=>({downloadPickupReportPdf:api.download}));
import {PickupReportModal,PickupReportHistory} from '../src/components/PickupReports';
const item={orderId:'order',orderNumber:'406-0001',channel:'amazon',carrier:'MRW',trackingNumber:'MRW123',packages:1,eligible:true,previousReports:[],packageCountEstimated:true};
beforeEach(()=>{vi.clearAllMocks();api.preview.mockResolvedValue({items:[item],canCreate:true,totalPackages:1});api.create.mockResolvedValue({id:'report',number:'REC-2026-0001',items:[item],totalPackages:1});api.list.mockResolvedValue([{id:'report',number:'REC-2026-0001',createdAt:'2026-10-20T07:00:00Z',totalPackages:1,totalOrders:1,carriers:['MRW']}]);api.get.mockResolvedValue({id:'report',number:'REC-2026-0001',items:[item]});});afterEach(cleanup);
it('requires an explicit review then creates a saved report with parcel counts and downloads',async()=>{
 const done=vi.fn();render(<PickupReportModal ids={['order']} onClose={()=>{}} onCreated={done}/>);
 expect(await screen.findByText('MRW123')).toBeTruthy();expect(api.create).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('Bultos de 406-0001'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:'Guardar y descargar PDF'}));
 await waitFor(()=>expect(done).toHaveBeenCalled());expect(api.create).toHaveBeenCalledWith(['order'],expect.any(String),false,{order:2});expect(api.download).toHaveBeenCalledTimes(1);
});
it('warns about missing label/tracking without silently dropping selected rows',async()=>{api.preview.mockResolvedValue({items:[{...item,eligible:false,issue:'Sin etiqueta o seguimiento'}],canCreate:false});render(<PickupReportModal ids={['order']} onClose={()=>{}} onCreated={()=>{}}/>);expect(await screen.findByText('Sin etiqueta o seguimiento')).toBeTruthy();expect((screen.getByRole('button',{name:'Guardar y descargar PDF'}) as HTMLButtonElement).disabled).toBe(true);});
it('requires acknowledgement for repeated membership and keeps idempotency on retry',async()=>{api.preview.mockResolvedValue({items:[{...item,previousReports:['REC-2026-0001']}],canCreate:true});api.create.mockRejectedValueOnce(new Error('Timeout'));render(<PickupReportModal ids={['order']} onClose={()=>{}} onCreated={()=>{}}/>);expect(await screen.findByText(/REC-2026-0001/)).toBeTruthy();const button=screen.getByRole('button',{name:'Guardar y descargar PDF'});expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox',{name:/Ya he revisado/}));fireEvent.click(button);await screen.findByText('Timeout');fireEvent.click(button);await waitFor(()=>expect(api.download).toHaveBeenCalled());expect(api.create.mock.calls[0][1]).toBe(api.create.mock.calls[1][1]);});
it('reprints stored snapshot without creating a new report',async()=>{render(<PickupReportHistory onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'Reimprimir REC-2026-0001'}));await waitFor(()=>expect(api.download).toHaveBeenCalled());expect(api.get).toHaveBeenCalledWith('report');expect(api.create).not.toHaveBeenCalled();});
it('shows a persisted report when PDF creation fails and retries download without another create',async()=>{
 api.download.mockImplementationOnce(()=>{throw new Error('PDF renderer failure')});
 render(<PickupReportModal ids={['order']} onClose={()=>{}} onCreated={()=>{}}/>);
 await screen.findByText('MRW123');fireEvent.click(screen.getByRole('button',{name:'Guardar y descargar PDF'}));
 expect(await screen.findByText(/Informe REC-2026-0001 guardado/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Descargar informe REC-2026-0001'}));
 await waitFor(()=>expect(api.download).toHaveBeenCalledTimes(2));expect(api.create).toHaveBeenCalledTimes(1);
});
