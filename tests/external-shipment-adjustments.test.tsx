import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {ExternalShipmentModal} from '../src/components/ExternalShipmentModal';
import {trackingPresentation} from '../src/services/shipmentTracking';
afterEach(cleanup);
const order={id:'demo',orderNumber:'DEMO-1',sourceChannel:'shopify',currency:'EUR'} as any;
const account={id:'mrw-account',provider:'mrw',displayName:'Mi MRW',enabled:true,status:'connected'} as any;
const choose=async(name:string,option:string)=>{fireEvent.click(screen.getByRole('combobox',{name}));fireEvent.click(await screen.findByRole('option',{name:option}))};
it('offers canonical carriers and fills MRW from its selected account',async()=>{
 const save=vi.fn(async()=>{});render(<ExternalShipmentModal order={order} accounts={[account]} onSave={save} onClose={()=>{}}/>);
 await choose('Transportista *','GLS');await choose('Cuenta o integración (opcional)','Mi MRW · MRW');
 expect(screen.getByRole('combobox',{name:'Transportista *'}).textContent).toContain('MRW');
 fireEvent.change(screen.getByLabelText('Tracking *'),{target:{value:'SYNTHETIC-000123'}});fireEvent.click(screen.getByRole('button',{name:'Registrar envío'}));
 await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toMatchObject({carrier:'MRW',accountId:'mrw-account',trackingNumber:'SYNTHETIC-000123'});
});
it('supports Other and a Spanish date calendar',async()=>{
 const save=vi.fn(async()=>{});render(<ExternalShipmentModal order={order} accounts={[]} onSave={save} onClose={()=>{}}/>);
 await choose('Transportista *','Otro');fireEvent.change(screen.getByLabelText('Nombre del transportista *'),{target:{value:'Reparto local'}});
 fireEvent.change(screen.getByLabelText('Tracking *'),{target:{value:'LOCAL-123'}});
 const date=screen.getByLabelText('Fecha de envío (opcional)');expect(date.getAttribute('placeholder')).toBe('dd/mm/aaaa');
 fireEvent.change(date,{target:{value:'21/10/2026'}});fireEvent.click(screen.getByRole('button',{name:'Abrir calendario de envío'}));expect(screen.getByText('L')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Registrar envío'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 expect(save.mock.calls[0][0]).toMatchObject({carrier:'Reparto local'});expect(save.mock.calls[0][0].shippedAt).toBeTruthy();
});
it.each(['mrw','envia','sendcloud'])('shows pending first poll for an integrated %s shipment',provider=>{
 expect(trackingPresentation({shippingProvider:provider,shippingIntegrationAccountId:'account',trackingNumber:'FULL-123'} as any)).toMatchObject({label:'Pendiente de la primera consulta',unavailable:false});
});
it('keeps manual shipments without an account distinct from scheduled tracking',()=>{
 expect(trackingPresentation({trackingNumber:'FULL-123'})).toMatchObject({label:'Sin seguimiento disponible',unavailable:true});
});

it('does not reuse a label status as the first integrated MRW observation',()=>{expect(trackingPresentation({shippingProvider:'mrw',shippingIntegrationAccountId:'a',trackingNumber:'123',trackingStatusCode:'SHIPPED'})).toMatchObject({label:'Pendiente de la primera consulta',state:null})});

it('distinguishes a failed integrated query from an unavailable integration',()=>{expect(trackingPresentation({shippingProvider:'mrw',shippingIntegrationAccountId:'a',trackingNumber:'123',trackingError:'ACCOUNT_PAUSED'}).label).toBe('Consulta pendiente')});
it('rejects impossible Spanish dates without registering',async()=>{const save=vi.fn(async()=>{});render(<ExternalShipmentModal order={order} accounts={[]} onSave={save} onClose={()=>{}}/>);await choose('Transportista *','MRW');fireEvent.change(screen.getByLabelText('Tracking *'),{target:{value:'FULL-123'}});fireEvent.change(screen.getByLabelText('Fecha de envío (opcional)'),{target:{value:'31/02/2026'}});fireEvent.click(screen.getByRole('button',{name:'Registrar envío'}));expect(save).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('fecha válida')});
