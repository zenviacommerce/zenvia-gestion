import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {ExternalShipmentModal} from '../src/components/ExternalShipmentModal';
afterEach(cleanup);
const order={id:'demo',orderNumber:'DEMO-1',sourceChannel:'shopify',currency:'EUR'} as any;
it('requires carrier and tracking, defaults source notification off and preserves optional zero cost',async()=>{
 const save=vi.fn(async()=>{});render(<ExternalShipmentModal order={order} accounts={[]} onClose={()=>{}} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Registrar envío'}));expect(save).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Transportista *'),{target:{value:'MRW'}});fireEvent.change(screen.getByLabelText('Tracking *'),{target:{value:'SYNTHETIC'}});
 fireEvent.change(screen.getByLabelText('Coste (EUR, opcional)'),{target:{value:'0'}});
 fireEvent.click(screen.getByRole('button',{name:'Registrar envío'}));
 await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toMatchObject({carrier:'MRW',trackingNumber:'SYNTHETIC',notifySource:false,cost:0});
});
it('retains the draft on server rejection and prevents duplicate submission',async()=>{
 let reject!:(e:Error)=>void;const save=vi.fn(()=>new Promise<void>((_,r)=>{reject=r}));render(<ExternalShipmentModal order={order} accounts={[]} onClose={()=>{}} onSave={save}/>);
 fireEvent.change(screen.getByLabelText('Transportista *'),{target:{value:'MRW'}});fireEvent.change(screen.getByLabelText('Tracking *'),{target:{value:'SYNTHETIC'}});
 const submit=screen.getByRole('button',{name:'Registrar envío'});fireEvent.click(submit);fireEvent.click(submit);expect(save).toHaveBeenCalledOnce();
 reject(Error('Expedición existente'));await screen.findByText('Expedición existente');expect((screen.getByLabelText('Tracking *') as HTMLInputElement).value).toBe('SYNTHETIC');
});
