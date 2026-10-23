import {it,expect,vi,afterEach} from 'vitest';import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {OrderDispatchModal} from '../src/components/OrderDispatchModal';
afterEach(cleanup);
it('shows the precise shipment selection and requires confirmation before dispatch',async()=>{
 const save=vi.fn(async()=>{});render(<OrderDispatchModal orders={[{id:'one',orderNumber:'DEMO-1',trackingNumber:'TRACK-1'} as any]} onClose={()=>{}} onSave={save}/>);
 expect(screen.getByRole('dialog',{name:'Marcar como enviado'})).toBeTruthy();
 expect(screen.getByText('TRACK-1')).toBeTruthy();expect(screen.getByRole('button',{name:'Confirmar salida'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByLabelText('Confirmo que estos paquetes han salido del almacén'));
 fireEvent.click(screen.getByRole('button',{name:'Confirmar salida'}));expect(save).toHaveBeenCalledOnce();
});
it('keeps the reviewed selection and error visible when the server rejects a stale label',async()=>{
 render(<OrderDispatchModal orders={[{id:'one',orderNumber:'DEMO-1',trackingNumber:'TRACK-1'} as any]} onClose={()=>{}} onSave={async()=>{throw Error('La etiqueta ha cambiado')}}/>);
 fireEvent.click(screen.getByLabelText('Confirmo que estos paquetes han salido del almacén'));fireEvent.click(screen.getByRole('button',{name:'Confirmar salida'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','La etiqueta ha cambiado');expect(screen.getByText('TRACK-1')).toBeTruthy();
});
