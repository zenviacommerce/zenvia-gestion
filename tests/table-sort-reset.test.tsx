import {act,cleanup,fireEvent,render,renderHook,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import * as shared from '../src/components/SortableTableHeader';
const rows=[{id:'a',name:'Zeta',date:'2026-01-01'},{id:'b',name:'Alfa',date:'2026-02-01'}];
const accessors={name:(r:typeof rows[number])=>r.name,date:(r:typeof rows[number])=>r.date};
const defaults={key:'date',direction:'desc' as const};
afterEach(()=>{cleanup();localStorage.clear()});
it('cycles ascending, descending, then the screen default rather than another ascending override',()=>{
 const {result}=renderHook(()=>shared.useSortableTable('test',rows,accessors,defaults));
 expect(result.current.rows.map(x=>x.id)).toEqual(['b','a']);
 act(()=>result.current.toggleSort('name'));expect(result.current.sort).toEqual({key:'name',direction:'asc'});
 act(()=>result.current.toggleSort('name'));expect(result.current.sort).toEqual({key:'name',direction:'desc'});
 act(()=>result.current.toggleSort('name'));expect(result.current.sort).toEqual(defaults);
 expect(result.current.rows.map(x=>x.id)).toEqual(['b','a']);
 expect(localStorage.getItem('zenvia:table-sort:test')).toBeNull();
});
it('offers an accessible reset only for a nondefault order, keeping aria-sort accurate',()=>{
 const Reset=(shared as any).TableSortReset;expect(Reset).toBeTypeOf('function');
 function Table(){const sort=shared.useSortableTable('ui',rows,accessors,defaults);return <><Reset sorting={sort}/><table><thead><tr><shared.SortableTableHeader label="Nombre" sortKey="name" activeKey={sort.sort.key} direction={sort.sort.direction} onSort={sort.toggleSort}/></tr></thead></table></>}
 render(<Table/>);expect(screen.queryByRole('button',{name:'Restablecer orden'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Nombre'}));expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('ascending');
 fireEvent.click(screen.getByRole('button',{name:'Restablecer orden'}));expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('none');
 expect(screen.queryByRole('button',{name:'Restablecer orden'})).toBeNull();
});
it('restores a stored custom order and does not resurrect it after reset and remount',()=>{
 localStorage.setItem('zenvia:table-sort:stored',JSON.stringify({key:'name',direction:'desc'}));
 let hook=renderHook(()=>shared.useSortableTable('stored',rows,accessors,defaults));expect(hook.result.current.sort.key).toBe('name');
 act(()=> (hook.result.current as any).resetSort());hook.unmount();
 hook=renderHook(()=>shared.useSortableTable('stored',rows,accessors,defaults));expect(hook.result.current.sort).toEqual(defaults);
});
it('keeps sorting preferences isolated when a detail changes its table ID',()=>{
 localStorage.setItem('zenvia:table-sort:two',JSON.stringify({key:'name',direction:'desc'}));
 const {result,rerender}=renderHook(({id})=>shared.useSortableTable(id,rows,accessors,defaults),{initialProps:{id:'one'}});
 act(()=>result.current.toggleSort('name'));rerender({id:'two'});expect(result.current.sort).toEqual({key:'name',direction:'desc'});
 rerender({id:'one'});expect(result.current.sort).toEqual({key:'name',direction:'asc'});
});
it('starts the default descending column at ascending even with a legacy saved default',()=>{
 localStorage.setItem('zenvia:table-sort:legacy',JSON.stringify(defaults));
 const {result}=renderHook(()=>shared.useSortableTable('legacy',rows,accessors,defaults));
 act(()=>result.current.toggleSort('date'));expect(result.current.sort.direction).toBe('asc');
 act(()=>result.current.toggleSort('date'));expect(result.current.sort.direction).toBe('desc');
 act(()=>result.current.toggleSort('date'));expect(result.current.sort).toEqual(defaults);
 act(()=>result.current.toggleSort('date'));expect(result.current.sort.direction).toBe('asc');
});
it('resolves server sort parameters without persisting a new preference for server lists',()=>{
 const useTableSort=(shared as any).useTableSort;expect(useTableSort).toBeTypeOf('function');
 const {result}=renderHook(()=>useTableSort('server',['date','name'],defaults,{persist:false}));
 act(()=>result.current.toggleSort('name'));expect(result.current.sort).toEqual({key:'name',direction:'asc'});
 act(()=>result.current.toggleSort('name'));expect(result.current.sort).toEqual({key:'name',direction:'desc'});
 act(()=>result.current.toggleSort('name'));expect(result.current.sort).toEqual(defaults);
 expect(localStorage.getItem('zenvia:table-sort:server')).toBeNull();
});
