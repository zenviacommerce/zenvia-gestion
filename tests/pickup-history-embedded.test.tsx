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
it('uses the shared search and keeps Estado inside Añadir filtro with a removable chip',async()=>{
 render(<PickupReportHistory embedded onClose={()=>{}}/>);await screen.findByText('REC-1');
 expect(screen.getByRole('searchbox',{name:'Buscar informes de recogida'}).closest('.dsSearchField')).toBeTruthy();expect(screen.queryByRole('combobox',{name:'Estado del informe'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));fireEvent.click(screen.getByRole('button',{name:'Estado',exact:true}));fireEvent.click(screen.getByRole('combobox',{name:'Estado del informe'}));fireEvent.click(await screen.findByRole('option',{name:'Firmado',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Aplicar filtro'}));
 expect(screen.getByRole('button',{name:'Quitar filtro Estado: Firmado'})).toBeTruthy();expect(screen.queryByText('REC-1')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Quitar filtro Estado: Firmado'}));expect(await screen.findByText('REC-1')).toBeTruthy();
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'NO-EXISTE'}});expect(screen.queryByText('REC-1')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Borrar búsqueda'}));expect(await screen.findByText('REC-1')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));fireEvent.click(screen.getByRole('button',{name:'Transportista',exact:true}));fireEvent.click(screen.getByRole('combobox',{name:'Transportista del informe'}));fireEvent.click(await screen.findByRole('option',{name:'MRW',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Aplicar filtro'}));expect(screen.getByRole('button',{name:'Quitar filtro Transportista: MRW'})).toBeTruthy();expect(screen.getByText('REC-1')).toBeTruthy();
});

it('keeps embedded report actions and semantic state badges visible without a repeated heading',async()=>{
 render(<PickupReportHistory embedded onClose={()=>{}}/>);await screen.findByText('REC-1');
 expect(screen.queryByRole('heading',{name:'Informes de recogida'})).toBeNull();
 expect(screen.getByText('Pendiente').closest('.dsStatusBadge')?.getAttribute('data-tone')).toBe('warning');
 expect(screen.getByRole('button',{name:'Enviar por correo REC-1'})).toBeTruthy();
 expect(screen.getByRole('region',{name:'Filtros de informes de recogida'}).classList.contains('dsSearchFiltersInset')).toBe(true);
});
