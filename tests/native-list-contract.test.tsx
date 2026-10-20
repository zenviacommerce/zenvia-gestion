import {act,cleanup,fireEvent,render,renderHook,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {DataTable,MobileList} from '../src/components/DataTable';
import {RowActions} from '../src/components/RowActions';
import {SelectionReview,toggleListScope,useListSelection} from '../src/components/ListSelection';
afterEach(cleanup);
it('preserves hidden IDs when selecting or deselecting a different filtered scope',()=>{
 const original=new Set(['hidden','shown']);
 expect([...toggleListScope(original,[{id:'shown'}],false)]).toEqual(['hidden']);
 expect([...toggleListScope(original,[{id:'other'}],true)]).toEqual(['hidden','shown','other']);
 expect([...original]).toEqual(['hidden','shown']);
});
it('retains selection across data refresh and prunes actually removed records',()=>{
 const a={id:'a'},b={id:'b'};
 const hook=renderHook(({items})=>useListSelection(items),{initialProps:{items:[a,b]}});
 act(()=>hook.result.current[1](new Set(['a','b'])));
 hook.rerender({items:[{...a},{...b}]});expect([...hook.result.current[0]]).toEqual(['a','b']);
 hook.rerender({items:[b]});expect([...hook.result.current[0]]).toEqual(['b']);
});
it('makes hidden bulk scope visible and lets the user remove it before acting',()=>{
 let removed='',cleared=false;
 render(<SelectionReview selected={[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}]} visibleIds={new Set(['b'])} onRemove={id=>{removed=id}} onClear={()=>{cleared=true}}/>);
 expect(screen.getByText(/1 fuera de los filtros/)).toBeTruthy();
 fireEvent.click(screen.getByText('Revisar selección (2)'));
 expect(screen.getByText('Alpha · fuera de los filtros')).toBeTruthy();
 fireEvent.click(screen.getByRole('checkbox',{name:'Quitar Alpha de la selección'}));expect(removed).toBe('a');
 fireEvent.click(screen.getByRole('button',{name:'Vaciar selección'}));expect(cleared).toBe(true);
});
it('native row actions call the original callback without opening the detail row',()=>{
 let opened=0,edited=0,deleted=0;
 render(<div onClick={()=>opened++}><RowActions onEdit={()=>edited++} onDelete={()=>deleted++}/></div>);
 fireEvent.click(screen.getByRole('button',{name:'Editar'}));fireEvent.click(screen.getByRole('button',{name:'Eliminar'}));
 expect([opened,edited,deleted]).toEqual([0,1,1]);
});
it('native table and mobile list expose accessible ownership and original content',()=>{
 render(<><DataTable label="Clientes"><table><tbody><tr><td>Alpha</td></tr></tbody></table></DataTable><MobileList label="Clientes móvil"><div role="listitem">Beta</div></MobileList></>);
 expect(screen.getByRole('region',{name:'Clientes'}).hasAttribute('data-native-list')).toBe(true);
 expect(screen.getByRole('list',{name:'Clientes móvil'}).hasAttribute('data-native-list')).toBe(true);
 expect(screen.getByRole('cell').textContent).toBe('Alpha');
});
it('retains the complete selected filter value as a tooltip when visually truncated',async()=>{
 const {SelectField}=await import('../src/components/forms/SelectField');
 const {SearchableSelect}=await import('../src/components/forms/SearchableSelect');
 render(<><SelectField value="long" options={[{value:'long',label:'Todos los proveedores internacionales'}]} onChange={()=>{}} ariaLabel="Filtro simple"/><SearchableSelect value="long" options={[{value:'long',label:'Todos los proveedores internacionales'}]} onChange={()=>{}} ariaLabel="Filtro con búsqueda"/></>);
 for(const name of ['Filtro simple','Filtro con búsqueda'])expect(screen.getByRole('combobox',{name}).getAttribute('title')).toBe('Todos los proveedores internacionales');
});
it('legacy observers never inject mobile controls into a React-owned list',async()=>{
 const {UnifiedListExperience}=await import('../src/components/UnifiedListExperience');
 render(<div className="page masterPage"><DataTable label="Directorio"><table className="masterTable"><tbody><tr className="clickableRow"><td>Alpha</td><td><RowActions onEdit={()=>{}} onDelete={()=>{}}/></td></tr></tbody></table></DataTable><MobileList label="Directorio móvil"><button className="masterMobileRow">Alpha</button></MobileList><UnifiedListExperience/></div>);
 expect(document.querySelectorAll('.zenviaMasterMobileActions')).toHaveLength(0);
 expect(screen.getAllByRole('button',{name:'Editar'})).toHaveLength(1);
});
