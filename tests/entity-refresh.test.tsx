import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useState} from 'react';
import {SearchableSelect} from '../src/components/forms/SearchableSelect';
import {notifyEntityChanged} from '../src/services/entityChanges';
import {useEntityRefresh} from '../src/hooks/useEntityRefresh';
afterEach(cleanup);
it('updates retained invoice and receipt selectors after a committed client mutation',async()=>{
 let rows=[{value:'old',label:'Anterior'}];
 function Selector({name}:{name:string}){const [data,setData]=useState(rows);useEntityRefresh(['clients'],async()=>setData([...rows]));return <SearchableSelect value="" options={data} onChange={()=>{}} ariaLabel={name}/>}
 render(<><Selector name="Factura"/><Selector name="Recibo"/></>);
 rows=[...rows,{value:'new',label:'Cliente recién creado'}];
 act(()=>notifyEntityChanged('clients'));
 fireEvent.click(screen.getByRole('combobox',{name:'Factura'}));expect(await screen.findByRole('option',{name:'Cliente recién creado'})).toBeTruthy();
 fireEvent.click(screen.getByRole('option',{name:'Cliente recién creado'}));
 fireEvent.click(screen.getByRole('combobox',{name:'Recibo'}));expect(await screen.findByRole('option',{name:'Cliente recién creado'})).toBeTruthy();
 rows=[{value:'old',label:'Editado'}];act(()=>notifyEntityChanged('clients'));
 await waitFor(()=>expect(screen.queryByRole('option',{name:'Cliente recién creado'})).toBeNull());expect(screen.getByRole('option',{name:'Editado'})).toBeTruthy();
});
it('keeps the typed query when remote options arrive and refreshes on opening',async()=>{
 const opened=vi.fn(),search=vi.fn();const {rerender}=render(<SearchableSelect value="" options={[]} onChange={()=>{}} onOpen={opened} onSearch={search}/>);
 fireEvent.click(screen.getByRole('combobox'));fireEvent.change(screen.getByPlaceholderText('Buscar…'),{target:{value:'Nuevo'}});
 rerender(<SearchableSelect value="" options={[{value:'n',label:'Nuevo remoto'}]} onChange={()=>{}} onOpen={opened} onSearch={search}/>);
 expect((screen.getByPlaceholderText('Buscar…') as HTMLInputElement).value).toBe('Nuevo');expect(screen.getByRole('option',{name:'Nuevo remoto'})).toBeTruthy();expect(opened).toHaveBeenCalledTimes(1);expect(search).toHaveBeenCalledWith('Nuevo');
});
it.each(['suppliers','products','tariffs','integrations'] as const)('refreshes retained %s consumers, coalesces bursts and unsubscribes',async entity=>{
 const read=vi.fn();function Probe(){useEntityRefresh([entity],read);return null}const view=render(<Probe/>);
 act(()=>{notifyEntityChanged(entity);notifyEntityChanged(entity)});await waitFor(()=>expect(read).toHaveBeenCalledTimes(1));view.unmount();act(()=>notifyEntityChanged(entity));await new Promise(r=>setTimeout(r,10));expect(read).toHaveBeenCalledTimes(1);
});
