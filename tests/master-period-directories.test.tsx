import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Clients} from '../src/pages/Clients';
import {Suppliers} from '../src/pages/Suppliers';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import type {Supplier} from '../src/types';

const state=vi.hoisted(()=>({context:{} as any}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>state.context}));
vi.mock('../src/services/sales',()=>({
 loadClients:async()=>[
  {id:'recent',name:'A Reciente',countryCode:'ES'},
  {id:'old',name:'B Anterior',countryCode:'ES'},
  {id:'never',name:'C Sin actividad',countryCode:'ES'},
 ],
 loadSalesInvoices:async()=>[
  {id:'recent-invoice',clientId:'recent',issueDate:'2026-10-12',status:'issued',invoiceType:'standard',totalAmount:100,paidAmount:0},
  {id:'old-invoice',clientId:'old',issueDate:'2025-01-12',status:'paid',invoiceType:'standard',totalAmount:300,paidAmount:300},
 ],addClient:vi.fn(),deleteClient:vi.fn(),updateClient:vi.fn(),
}));
vi.mock('../src/services/repository',()=>({loadAppData:async()=>({categories:[],invoices:[
 {id:'recent-invoice',supplierId:'recent',supplierName:'A Reciente',invoiceDate:'2026-10-12',total:100},
 {id:'old-invoice',supplierId:'old',supplierName:'B Anterior',invoiceDate:'2025-01-12',total:300},
]})}));
const suppliers=[{id:'recent',name:'A Reciente'},{id:'old',name:'B Anterior'},{id:'never',name:'C Sin actividad'}] as Supplier[];
afterEach(cleanup);
beforeEach(()=>{localStorage.clear();state.context={settings:structuredClone(DEFAULT_APP_SETTINGS),preferences:{...structuredClone(DEFAULT_USER_PREFERENCES),defaultPeriod:'all',pageSize:50,rememberFilters:false},patchPreferences:vi.fn()};});
function range(){fireEvent.change(screen.getByLabelText('Desde'),{target:{value:'2026-10-01'}});fireEvent.change(screen.getByLabelText('Hasta'),{target:{value:'2026-10-31'}});}
function rows(key:string){return within(document.querySelector(`table[data-preference-table="${key}"]`)! as HTMLElement).getAllByRole('row').slice(1)}
async function choose(label:string,option:string){fireEvent.click(screen.getByRole('combobox',{name:label}));fireEvent.click(await screen.findByRole('option',{name:option}));}
function kpi(label:string){return screen.getAllByText(label).find(element=>element.closest('.stat'))?.closest('.stat')?.querySelector('.statContent strong')?.textContent;}
describe('master directories already separate membership from period metrics',()=>{
 it('keeps all clients by default and respects explicit period activity filters',async()=>{
  render(<Clients/>);await waitFor(()=>expect(rows('clients')).toHaveLength(3));
  range();expect(rows('clients')).toHaveLength(3);expect(kpi('Clientes con actividad')).toBe('1');expect(kpi('Facturado')).toMatch(/100,00/);
  expect(rows('clients')[2].textContent).toContain('C Sin actividad');
  await choose('Filtrar clientes por situación','Con actividad en el periodo');
  expect(rows('clients')).toHaveLength(1);expect(rows('clients')[0].textContent).toContain('A Reciente');
  await choose('Filtrar clientes por situación','Sin actividad en el periodo');
  expect(rows('clients')).toHaveLength(2);expect(rows('clients')[0].textContent).toContain('B Anterior');
  fireEvent.click(screen.getByRole('button',{name:'Todo'}));expect(rows('clients')).toHaveLength(1);expect(rows('clients')[0].textContent).toContain('C Sin actividad');
 });
 it('keeps all suppliers by default and respects explicit period activity filters',async()=>{
  render(<Suppliers suppliers={suppliers} onAdd={()=>{}} onEdit={()=>{}} onDelete={async()=>{}}/>);
  await waitFor(()=>expect(kpi('Facturas recibidas')).toBe('2'));
  range();expect(rows('suppliers')).toHaveLength(3);expect(kpi('Proveedores con actividad')).toBe('1');expect(kpi('Gasto del periodo')).toMatch(/100,00/);
  expect(rows('suppliers')[2].textContent).toContain('C Sin actividad');
  await choose('Filtrar proveedores por actividad','Con facturas en el periodo');
  expect(rows('suppliers')).toHaveLength(1);expect(rows('suppliers')[0].textContent).toContain('A Reciente');
  await choose('Filtrar proveedores por actividad','Sin facturas en el periodo');
  expect(rows('suppliers')).toHaveLength(2);expect(rows('suppliers')[0].textContent).toContain('B Anterior');
  fireEvent.click(screen.getByRole('button',{name:'Todo'}));expect(rows('suppliers')).toHaveLength(1);expect(rows('suppliers')[0].textContent).toContain('C Sin actividad');
 });
});
