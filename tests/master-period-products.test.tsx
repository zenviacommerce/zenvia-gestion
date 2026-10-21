import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Products} from '../src/pages/Products';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import type {Product} from '../src/types';

const context=vi.hoisted(()=>({value:{} as any}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>context.value}));
vi.mock('../src/services/productEditor',()=>({loadProductSalesMap:async()=>new Map([
 ['in',{salePrice:20,salesTaxRate:21,invoiceDescription:'',ean:'EAN-IN'}],
 ['out',{salePrice:90,salesTaxRate:10,invoiceDescription:'',ean:'EAN-OUT'}],
 ['none',{salePrice:null,salesTaxRate:21,invoiceDescription:'',ean:''}],
])}));
const products:Product[]=[
 {id:'in',name:'A Dentro',supplier:'Proveedor A',category:'Comida',unit:'ud',lastPrice:10,previousPrice:8,lastPurchaseDate:'2026-10-12'},
 {id:'out',name:'B Fuera',supplier:'Proveedor B',category:'Comida',unit:'ud',lastPrice:30,previousPrice:40,lastPurchaseDate:'2025-02-01'},
 {id:'none',name:'C Sin actividad',supplier:'Proveedor A',category:'Otros',unit:'ud',lastPrice:null,lastPurchaseDate:null},
];
afterEach(cleanup);
beforeEach(()=>{
 localStorage.clear();
 context.value={settings:structuredClone(DEFAULT_APP_SETTINGS),preferences:{...structuredClone(DEFAULT_USER_PREFERENCES),defaultPeriod:'all',pageSize:2,rememberFilters:false},patchPreferences:vi.fn()};
});
function mount(){return render(<Products products={products} onAdd={()=>{}} onEdit={()=>{}} onDelete={async()=>{}}/>)}
function table(){return document.querySelector('table[data-preference-table="products"]')! as HTMLElement}
function rows(){return within(table()).getAllByRole('row').slice(1)}
function range(from='2026-10-01',to='2026-10-31'){
 fireEvent.change(screen.getByLabelText('Desde'),{target:{value:from}});
 fireEvent.change(screen.getByLabelText('Hasta'),{target:{value:to}});
}
function kpi(label:string){return screen.getByText(label).closest('.stat')!.querySelector('.statContent strong')! as HTMLElement}
async function choose(label:string,option:string){fireEvent.click(screen.getByRole('combobox',{name:label}));fireEvent.click(await screen.findByRole('option',{name:option}));}

describe('Products master membership versus period indicators',()=>{
 it('keeps out-of-period and undated products on their page while period KPIs change',async()=>{
  mount();await waitFor(()=>expect(kpi('Con precio de venta').textContent).toContain('2'));
  fireEvent.click(screen.getByRole('button',{name:/Siguiente/}));
  expect(rows()[0].textContent).toContain('C Sin actividad');
  fireEvent.click(within(rows()[0]).getByRole('checkbox',{name:'Seleccionar C Sin actividad'}));
  range();
  expect(screen.getByText('Página 2 de 2')).toBeTruthy();
  expect(rows()[0].textContent).toContain('C Sin actividad');
  expect((within(rows()[0]).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(kpi('Productos en periodo').textContent).toBe('1');
  expect(kpi('Con precio de venta').textContent).toBe('1');
  expect(kpi('Margen medio').textContent).toBe('100,0 %');
  expect(kpi('Margen bajo').textContent).toBe('0');
  expect(kpi('Subidas de coste').textContent).toBe('1');
  expect(kpi('Coste medio').textContent).toMatch(/10,00/);
  fireEvent.click(screen.getByRole('button',{name:/Anterior/}));
  expect(rows().map(row=>row.textContent).join(' ')).toContain('B Fuera');
  fireEvent.click(screen.getByRole('button',{name:'Todo'}));
  expect(kpi('Productos en periodo').textContent).toBe('3');
  expect(kpi('Margen medio').textContent).toBe('150,0 %');
  expect(kpi('Coste medio').textContent).toMatch(/20,00/);
 });
 it('applies search and own filters to the whole catalogue and to period KPI intersection',async()=>{
  mount();await waitFor(()=>expect(kpi('Con precio de venta').textContent).toContain('2'));range();
  await choose('Filtrar por categoría','Comida');
  expect(rows()).toHaveLength(2);
  expect(kpi('Productos en periodo').textContent).toContain('1');
  await choose('Filtrar por proveedor','Proveedor B');
  expect(rows()).toHaveLength(1);expect(rows()[0].textContent).toContain('B Fuera');
  expect(kpi('Productos en periodo').textContent).toContain('0');
  expect(kpi('Coste medio').textContent).toContain('—');
  await choose('Filtrar por IVA de venta','10 %');await choose('Filtrar productos','Con precio de venta');
  fireEvent.change(screen.getByPlaceholderText('Buscar producto, SKU, EAN o proveedor…'),{target:{value:'EAN-OUT'}});
  expect(rows()).toHaveLength(1);expect(rows()[0].textContent).toContain('B Fuera');
  fireEvent.click(rows()[0]);expect(screen.getByRole('heading',{name:'B Fuera'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Todo'}));
  expect(kpi('Productos en periodo').textContent).toContain('1');
  expect(kpi('Coste medio').textContent).toMatch(/30,00/);
 });
 it('preserves sort and zero-activity entries when custom period has no matches',async()=>{
  mount();await waitFor(()=>expect(kpi('Con precio de venta').textContent).toContain('2'));
  fireEvent.click(screen.getByRole('button',{name:'Producto'}));
  fireEvent.click(screen.getByRole('button',{name:'Producto'}));
  range('2020-01-01','2020-01-31');
  expect(rows()[0].textContent).toContain('C Sin actividad');
  expect(kpi('Productos en periodo').textContent).toContain('0');
  expect(kpi('Con precio de venta').textContent).toContain('0');
  expect(kpi('Margen medio').textContent).toContain('—');
 });
});
