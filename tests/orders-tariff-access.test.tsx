import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {PageHeader} from '../src/components/PageHeader';
import {OrderLabelDefaults} from '../src/components/OrderLabelDefaults';
vi.mock('../src/services/transportTariffs',()=>({listTransportTariffs:async()=>[]}));
afterEach(cleanup);
it('keeps transport tariffs reachable through PageHeader and opens the existing manager',async()=>{
 render(<><div className="ordersPage"><PageHeader title="Pedidos" actions={<><button>Informes de recogida</button><button>Impresión directa</button></>}/></div><OrderLabelDefaults/></>);
 const tariffs=await screen.findByRole('button',{name:'Abrir tarifas de transporte'});
 fireEvent.click(tariffs);expect(await screen.findByRole('heading',{name:'Tarifas de transporte'})).toBeTruthy();
 expect(screen.getByText('Subir tarifa')).toBeTruthy();expect(document.querySelector('input[type=file]')?.getAttribute('accept')).toContain('.pdf');
 fireEvent.click(screen.getByRole('button',{name:'Cerrar',exact:true}));await waitFor(()=>expect(screen.queryByRole('heading',{name:'Tarifas de transporte'})).toBeNull());
 expect(screen.getAllByRole('button',{name:'Abrir tarifas de transporte'})).toHaveLength(1);
});
it('does not add the Orders tariff action to other pages',()=>{
 render(<><div className="page"><PageHeader title="Resumen" actions={<button>Factura de gasto</button>}/></div><OrderLabelDefaults/></>);
 expect(screen.queryByRole('button',{name:'Abrir tarifas de transporte'})).toBeNull();
});
