import {useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {OrdersWorkbenchFilters,type OrdersWorkbenchFilterValues} from '../src/components/OrdersWorkbenchFilters';
afterEach(cleanup);
const defaults:OrdersWorkbenchFilterValues={query:'',channel:'all',country:'all',carrier:'all',pickupReport:'all',tracking:'all'};
const options={countries:[{value:'ES',label:'España'}],carriers:[{value:'mrw',label:'MRW'}]};
function Fixture({tab='shipped',initial={}}:{tab?:string;initial?:Partial<OrdersWorkbenchFilterValues>}){const [values,setValues]=useState({...defaults,...initial});return <OrdersWorkbenchFilters tab={tab} values={values} onChange={patch=>setValues(current=>({...current,...patch}))} {...options}/>}
it('starts compact, adds one accessible field and removable chip, and resets all filters',async()=>{
 render(<Fixture/>);expect(screen.getByRole('textbox',{name:'Buscar pedidos'})).toBeTruthy();expect(screen.queryByRole('combobox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));fireEvent.click(screen.getByRole('button',{name:'Destino'}));
 fireEvent.click(screen.getByRole('combobox',{name:'Filtrar por país de destino'}));fireEvent.click(await screen.findByRole('option',{name:'España'}));
 expect(screen.getByRole('button',{name:'Quitar filtro Destino: España'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Quitar filtro Destino: España'}));expect(screen.queryByText('Destino: España')).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'Buscar pedidos'}),{target:{value:'ABC'}});fireEvent.click(screen.getByRole('button',{name:'Limpiar filtros'}));expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
});
it('closes the popover on Escape or outside click and returns focus',()=>{
 render(<Fixture/>);const add=screen.getByRole('button',{name:'Añadir filtro'});fireEvent.click(add);expect(screen.getByRole('dialog',{name:'Añadir filtro'})).toBeTruthy();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(add);
 fireEvent.click(add);fireEvent.pointerDown(document.body);expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(add);
});
it.each(['pending','cancelled'])('limits available filters and clears disallowed tracking for %s',async tab=>{
 const change=vi.fn();render(<OrdersWorkbenchFilters {...options} tab={tab} values={{...defaults,tracking:'delivered',pickupReport:'in'}} onChange={change}/>);
 await waitFor(()=>expect(change).toHaveBeenCalledWith(tab==='pending'?{pickupReport:'all',tracking:'all'}:{tracking:'all'}));fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));expect(screen.queryByRole('button',{name:'Seguimiento'})).toBeNull();if(tab==='pending')expect(screen.queryByRole('button',{name:'Informe de recogida'})).toBeNull();
});
it('issues permits active tracking states and excludes terminal tracking options',async()=>{
 render(<Fixture tab="issues"/>);fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));fireEvent.click(screen.getByRole('button',{name:'Seguimiento'}));fireEvent.click(screen.getByRole('combobox',{name:'Filtrar por seguimiento'}));expect(await screen.findByRole('option',{name:'En tránsito'})).toBeTruthy();expect(screen.queryByRole('option',{name:'Entregado'})).toBeNull();expect(screen.queryByRole('option',{name:'Devuelto'})).toBeNull();expect(screen.queryByRole('option',{name:'Cancelado'})).toBeNull();
});
it('provides the advanced all orders action and lets reports own their toolbar',()=>{
 const showAll=vi.fn();const view=render(<OrdersWorkbenchFilters {...options} tab="pending" values={defaults} onChange={()=>{}} onShowAll={showAll}/>);fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));fireEvent.click(screen.getByRole('button',{name:'Ver todos los pedidos'}));expect(showAll).toHaveBeenCalledOnce();
 view.rerender(<OrdersWorkbenchFilters {...options} tab="reports" values={defaults} onChange={()=>{}}/>);expect(screen.queryByRole('textbox')).toBeNull();
});
it('clears filters when switching tabs while preserving the search and allowed filters',async()=>{
 function SwitchFixture(){const [tab,setTab]=useState('shipped');const [values,setValues]=useState<OrdersWorkbenchFilterValues>({...defaults,query:'ABC',country:'ES',tracking:'delivered',pickupReport:'in'});return <><button onClick={()=>setTab('pending')}>Cambiar a pendientes</button><OrdersWorkbenchFilters {...options} tab={tab} values={values} onChange={patch=>setValues(current=>({...current,...patch}))}/></>}
 render(<SwitchFixture/>);expect(screen.getByRole('button',{name:'Quitar filtro Seguimiento: Entregado'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Cambiar a pendientes'}));await waitFor(()=>expect(screen.queryByRole('button',{name:/Quitar filtro Seguimiento/})).toBeNull());expect(screen.queryByRole('button',{name:/Quitar filtro Informe/})).toBeNull();expect(screen.getByRole('button',{name:'Quitar filtro Destino: España'})).toBeTruthy();expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('ABC');fireEvent.click(screen.getByRole('button',{name:'Limpiar filtros'}));expect(screen.queryByRole('button',{name:/Quitar filtro/})).toBeNull();
});
it('counts channels without losing the stored manual/API value',async()=>{
 const change=vi.fn();render(<OrdersWorkbenchFilters {...options} tab="all" values={defaults} onChange={change} channelCounts={{amazon:5,shopify:4,manual:3}}/>);fireEvent.click(screen.getByRole('button',{name:'Añadir filtro'}));fireEvent.click(screen.getByRole('button',{name:'Canal'}));fireEvent.click(screen.getByRole('combobox',{name:'Filtrar por canal'}));fireEvent.click(await screen.findByRole('option',{name:'Manual / API (3)'}));expect(change).toHaveBeenCalledWith({channel:'other'});
});
