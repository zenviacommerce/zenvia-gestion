import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {KpiGrid} from '../src/components/KpiGrid';
import {PageHeader} from '../src/components/PageHeader';
import {StatCard} from '../src/components/StatCard';
afterEach(cleanup);
describe('shared design primitives',()=>{
 it('preserves the warning variant when rendering a KPI as a card or action',()=>{
  const {rerender}=render(<StatCard label="Pendientes" value="2" icon={<span/>} variant="warning"/>);
  expect(screen.getByText('Pendientes').closest('.stat')?.classList.contains('dashboardPendingOrders')).toBe(true);
  rerender(<StatCard label="Pendientes" value="2" icon={<span/>} variant="warning" onClick={()=>{}}/>);
  expect(screen.getByRole('button').classList.contains('dashboardPendingOrders')).toBe(true);
  rerender(<StatCard label="Pendientes" value="0" icon={<span/>}/>);
  expect(screen.getByText('Pendientes').closest('.stat')?.classList.contains('dashboardPendingOrders')).toBe(false);
 });
 it('keeps KPI information and click actions without nesting card surfaces',()=>{
  const click=vi.fn();render(<KpiGrid label="Operativa"><StatCard label="Pendientes" value="7" sub="Sin limitar por periodo" icon={<span/>} onClick={click}/></KpiGrid>);
  fireEvent.click(screen.getByRole('button',{name:/Pendientes/}));expect(click).toHaveBeenCalledTimes(1);
  const group=screen.getByRole('group',{name:'Operativa'});expect(group.querySelectorAll('.stat')).toHaveLength(1);expect(group.classList.contains('card')).toBe(false);
  expect(screen.getByText('Sin limitar por periodo')).toBeTruthy();
 });
 it('preserves multi-line currency information in a card',()=>{
  render(<KpiGrid label="Ventas"><StatCard label="Importe" value={<><span>1.234,56 EUR</span><span>987,00 USD</span></>} icon={<span/>}/></KpiGrid>);
  expect(screen.getByText('1.234,56 EUR')).toBeTruthy();expect(screen.getByText('987,00 USD')).toBeTruthy();
 });
 it('keeps all header actions, disabled state and labels',()=>{
  const click=vi.fn();render(<PageHeader title="Pedidos" eyebrow="Logística" description="Descripción" actions={<><button onClick={click}>Actualizar</button><button disabled>Generar</button></>}/>);
  expect(screen.getByRole('heading',{level:1,name:'Pedidos'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));expect(click).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button',{name:'Generar'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('region',{name:'Acciones de Pedidos'})).toBeTruthy();
 });
});
