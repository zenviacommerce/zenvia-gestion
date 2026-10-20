import {useState} from 'react';
import {createPortal} from 'react-dom';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {PageTabs} from '../src/components/PageTabs';
import {FilterBar} from '../src/components/FilterBar';
import {PageHeader} from '../src/components/PageHeader';
afterEach(cleanup);
it('shares tab selection and arrow-key focus without dropping labels or descriptions',()=>{
 function Fixture(){const [tab,setTab]=useState<'bills'|'receipts'>('bills');return <PageTabs label="Ventas" value={tab} onChange={setTab} items={[{id:'bills',label:'Facturas',description:'Cobros y rectificativas'},{id:'receipts',label:'Recibos',description:'Pendiente de facturar'}]}/>}
 render(<Fixture/>);const bills=screen.getByRole('tab',{name:/Facturas/}),receipts=screen.getByRole('tab',{name:/Recibos/});
 expect(bills.getAttribute('aria-selected')).toBe('true');fireEvent.keyDown(bills,{key:'ArrowRight'});expect(receipts.getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(receipts);
 fireEvent.keyDown(receipts,{key:'Home'});expect(bills.getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(bills);expect(screen.getByText('Cobros y rectificativas')).toBeTruthy();
});
it('FilterBar keeps native field behavior and accessible grouping',()=>{
 function Fixture(){const [value,setValue]=useState('');return <FilterBar label="Filtros"><label>Buscar<input value={value} onChange={e=>setValue(e.target.value)}/></label></FilterBar>}
 render(<Fixture/>);fireEvent.change(screen.getByLabelText('Buscar'),{target:{value:'DEMO'}});expect((screen.getByLabelText('Buscar') as HTMLInputElement).value).toBe('DEMO');expect(screen.getByRole('region',{name:'Filtros'})).toBeTruthy();
});
it('header detects late portal actions and removes the overflow hint at the scroll end',async()=>{
 const view=render(<PageHeader title="Facturación" actions={<button>Series</button>}/>);const row=screen.getByRole('region',{name:'Acciones de Facturación'});
 Object.defineProperties(row,{clientWidth:{value:200},scrollWidth:{value:400},scrollLeft:{value:0,writable:true}});
 view.rerender(<><PageHeader title="Facturación" actions={<button>Series</button>}/>{createPortal(<button>Importar facturas</button>,row)}</>);
 await waitFor(()=>expect(document.querySelector('.dsActionsScrollHint')).toBeTruthy());expect(screen.getByRole('button',{name:'Importar facturas'})).toBeTruthy();
 row.scrollLeft=200;fireEvent.scroll(row);await waitFor(()=>expect(document.querySelector('.dsActionsScrollHint')).toBeNull());
});
