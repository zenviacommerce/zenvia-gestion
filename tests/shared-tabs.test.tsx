import {useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Tabs} from '../packages/ui/src/Tabs';
afterEach(()=>{cleanup();delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView});
it('owns card tabs, semantic badges, unique ids and active visibility at every viewport',()=>{
 const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
 function Fixture(){const [value,set]=useState('pending');return <Tabs label="Pedidos" panelId="panel" value={value} onChange={set} items={[{id:'pending',label:'Pendientes',badge:0},{id:'issues',label:'Incidencias',badge:2,badgeTone:'danger'},{id:'reports',label:'Informes de recogida'}]}/>}
 render(<Fixture/>);const tabs=screen.getAllByRole('tab');expect(screen.getByRole('tablist').classList.contains('dsTabs')).toBe(true);
 expect(tabs[0].getAttribute('aria-controls')).toBe('panel');expect(tabs[0].id).toBe('panel-tab-pending');expect(tabs[0].querySelector('[data-tone="neutral"]')?.textContent).toBe('0');expect(tabs[1].querySelector('[data-tone="danger"]')?.textContent).toBe('2');
 fireEvent.keyDown(tabs[0],{key:'ArrowLeft'});expect(tabs[2].getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(tabs[2]);
 fireEvent.keyDown(tabs[2],{key:'Home'});expect(document.activeElement).toBe(tabs[0]);fireEvent.keyDown(tabs[0],{key:'End'});expect(document.activeElement).toBe(tabs[2]);expect(tabs[0].tabIndex).toBe(-1);expect(scroll).toHaveBeenCalled();
});
it('retains the current value and focus when asynchronous dirty-form guard vetoes',async()=>{
 const guard=vi.fn(async()=>false);render(<Tabs label="Ajustes" value="one" onChange={guard} items={[{id:'one',label:'General'},{id:'two',label:'Integraciones'}]}/>);
 const first=screen.getByRole('tab',{name:'General'});first.focus();fireEvent.keyDown(first,{key:'ArrowRight'});await waitFor(()=>expect(guard).toHaveBeenCalledWith('two'));expect(document.activeElement).toBe(first);expect(first.getAttribute('aria-selected')).toBe('true');
});
it('generates independent tab ids without a supplied panel id',()=>{
 for(const label of ['Uno','Dos'])render(<Tabs label={label} value="one" onChange={()=>{}} items={[{id:'one',label:'General'}]}/>);
 const tabs=screen.getAllByRole('tab');expect(tabs[0].id).not.toBe(tabs[1].id);
});
it('restores the selected tab focus when a click is vetoed',async()=>{
 render(<Tabs label="Ajustes" value="one" onChange={async()=>false} items={[{id:'one',label:'General'},{id:'two',label:'Integraciones'}]}/>);
 const tabs=screen.getAllByRole('tab');tabs[1].focus();fireEvent.click(tabs[1]);await waitFor(()=>expect(document.activeElement).toBe(tabs[0]));
});
it('reveals the current tab again when Home is pressed after manually scrolling the rail',()=>{
 const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
 render(<Tabs label="Pedidos" value="one" onChange={()=>{}} items={[{id:'one',label:'Pendientes'},{id:'two',label:'Enviados'}]}/>);
 scroll.mockClear();fireEvent.keyDown(screen.getByRole('tab',{name:'Pendientes'}),{key:'Home'});expect(scroll).toHaveBeenCalled();
});
