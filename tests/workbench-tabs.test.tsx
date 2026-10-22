import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PageTabs} from '@zenvia/ui';
afterEach(cleanup);
it('renders accessible workbench counts, panel association and roving horizontal navigation',()=>{
 const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
 function Fixture(){const [value,setValue]=useState('pending');return <PageTabs label="Pedidos" panelId="orders-panel" value={value} onChange={setValue} items={[{id:'pending',label:'Pendientes',badge:12},{id:'issues',label:'Incidencias',badge:3},{id:'reports',label:'Informes',badge:0}]}/>}
 render(<Fixture/>);const tabs=screen.getAllByRole('tab');
 expect(screen.getByRole('tablist').classList.contains('dsTabs')).toBe(true);
 expect(tabs[0].getAttribute('aria-controls')).toBe('orders-panel');expect(tabs[0].textContent).toContain('12');
 expect(screen.getByRole('tab',{name:/Pendientes.*12/})).toBeTruthy();
 fireEvent.keyDown(tabs[0],{key:'ArrowRight'});expect(tabs[1].getAttribute('aria-selected')).toBe('true');expect(tabs[1].tabIndex).toBe(0);expect(tabs[0].tabIndex).toBe(-1);expect(document.activeElement).toBe(tabs[1]);
 fireEvent.keyDown(tabs[1],{key:'End'});expect(document.activeElement).toBe(tabs[2]);fireEvent.keyDown(tabs[2],{key:'Home'});expect(document.activeElement).toBe(tabs[0]);expect(scroll).toHaveBeenCalled();
 delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
it('uses the same card presentation for every screen and handles missing scrollIntoView',()=>{
 render(<PageTabs label="Legacy" value="one" onChange={()=>{}} items={[{id:'one',label:'One',badge:2,description:'Description'}]}/>);
 expect(screen.getByRole('tablist').classList.contains('dsTabs')).toBe(true);expect(screen.getByText('Description')).toBeTruthy();
});
