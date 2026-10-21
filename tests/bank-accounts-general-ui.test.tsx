import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES} from '../src/services/settingsSchema';
import {SettingsPage} from '../src/pages/Settings';
const state=vi.hoisted(()=>({rows:[] as any[],save:vi.fn(),confirm:vi.fn()}));
vi.mock('../src/context/SettingsContext',()=>({useSettings:()=>({settings:DEFAULT_APP_SETTINGS,preferences:DEFAULT_USER_PREFERENCES,warnings:[],error:null,loading:false,updateSection:async()=>{}})}));
vi.mock('../src/services/sales',async original=>({...await original<any>(),loadBusinessSettings:async()=>({legalName:'Empresa prueba',countryCode:'ES',iban:'LEGADO NO EDITAR'})}));
vi.mock('../src/services/companyBranding',async original=>({...await original<any>(),loadCompanyBranding:async()=>({logoPath:null,logoDataUrl:null})}));
vi.mock('../src/services/actionDialog',()=>({confirmAction:(...args:any[])=>state.confirm(...args)}));
vi.mock('../src/services/businessBankAccounts',async original=>({...await original<any>(),
 loadBusinessBankAccounts:async()=>state.rows,
 saveBusinessBankAccount:async(input:any)=>{state.save(input);const row={...input,id:input.id||`account-${state.rows.length+1}`,isDefault:input.isDefault||!state.rows.length,validationStatus:'valid',archivedAt:null};if(row.isDefault)state.rows=state.rows.map(item=>({...item,isDefault:false}));state.rows=[...state.rows.filter(item=>item.id!==row.id),row];return row},
 setDefaultBusinessBankAccount:async(id:string)=>{state.rows=state.rows.map(item=>({...item,isDefault:item.id===id}));return state.rows.find(item=>item.id===id)},
 archiveBusinessBankAccount:async(id:string)=>{state.rows=state.rows.filter(item=>item.id!==id);if(state.rows.length&&!state.rows.some(item=>item.isDefault))state.rows[0].isDefault=true},
}));
afterEach(cleanup);beforeEach(()=>{state.rows=[];state.save.mockReset();state.confirm.mockReset().mockResolvedValue(true)});
function mount(){return render(<SettingsPage isAdmin access={{} as any}/>)}
function account(alias:string){return screen.getByRole('article',{name:`Cuenta ${alias}`})}
async function idle(){await waitFor(()=>expect((screen.getByRole('button',{name:/^(Añadir cuenta|Guardar cuenta)$/}) as HTMLButtonElement).disabled).toBe(false))}
it('manages two bank accounts in General without an independent legacy IBAN editor',async()=>{
 mount();expect(await screen.findByRole('heading',{name:'Cuentas bancarias'})).toBeTruthy();await idle();
 expect(screen.queryByDisplayValue('LEGADO NO EDITAR')).toBeNull();
 fireEvent.change(screen.getByLabelText('Alias de la cuenta'),{target:{value:'Principal'}});fireEvent.change(screen.getByLabelText('IBAN de la cuenta'),{target:{value:'ES9121000418450200051332'}});
 fireEvent.click(screen.getByRole('button',{name:'Añadir cuenta'}));expect(await screen.findByRole('article',{name:'Cuenta Principal'})).toBeTruthy();expect(account('Principal').textContent).toContain('Predeterminada');await idle();
 fireEvent.change(screen.getByLabelText('Alias de la cuenta'),{target:{value:'Ventas'}});fireEvent.change(screen.getByLabelText('IBAN de la cuenta'),{target:{value:'DE89370400440532013000'}});fireEvent.click(screen.getByRole('button',{name:'Añadir cuenta'}));
 expect(await screen.findByRole('article',{name:'Cuenta Ventas'})).toBeTruthy();await idle();fireEvent.click(within(account('Ventas')).getByRole('button',{name:'Usar por defecto'}));
 await waitFor(()=>expect(account('Ventas').textContent).toContain('Predeterminada'));expect(account('Principal').textContent).not.toContain('Predeterminada');await idle();
 fireEvent.click(within(account('Ventas')).getByRole('button',{name:'Editar'}));fireEvent.change(screen.getByLabelText('Alias de la cuenta'),{target:{value:'Canal web'}});fireEvent.click(screen.getByRole('button',{name:'Guardar cuenta'}));expect(await screen.findByRole('article',{name:'Cuenta Canal web'})).toBeTruthy();await idle();
 fireEvent.click(within(account('Principal')).getByRole('button',{name:'Eliminar'}));await waitFor(()=>expect(screen.queryByRole('article',{name:'Cuenta Principal'})).toBeNull());expect(account('Canal web')).toBeTruthy();
});
it('keeps invalid legacy bank data visible for correction and rejects an invalid new IBAN',async()=>{
 state.rows=[{id:'legacy',alias:'Cuenta principal',iban:'LEGADO INVÁLIDO',bic:null,holder:null,isDefault:true,archivedAt:null,validationStatus:'needs_review'}];
 mount();expect(await screen.findByText('LEGADO INVÁLIDO')).toBeTruthy();expect(screen.getByText('Pendiente de revisión')).toBeTruthy();await idle();
 fireEvent.change(screen.getByLabelText('Alias de la cuenta'),{target:{value:'No válida'}});fireEvent.change(screen.getByLabelText('IBAN de la cuenta'),{target:{value:'ES000000'}});fireEvent.click(screen.getByRole('button',{name:'Añadir cuenta'}));
 expect(await screen.findByRole('alert')).toBeTruthy();expect(state.save).not.toHaveBeenCalled();expect(account('Cuenta principal')).toBeTruthy();
});

it('does not clear unsaved company edits when the independent bank editor saves',async()=>{
 const dirty:boolean[]=[];const listener=(event:Event)=>dirty.push((event as CustomEvent).detail.dirty);window.addEventListener('zenvia:settings-dirty',listener);
 try{
  mount();await screen.findByRole('heading',{name:'Cuentas bancarias'});await idle();fireEvent.change(screen.getByLabelText('Razón social'),{target:{value:'Cambio pendiente'}});
  fireEvent.change(screen.getByLabelText('Alias de la cuenta'),{target:{value:'Principal'}});fireEvent.change(screen.getByLabelText('IBAN de la cuenta'),{target:{value:'ES9121000418450200051332'}});fireEvent.click(screen.getByRole('button',{name:'Añadir cuenta'}));
  await screen.findByRole('article',{name:'Cuenta Principal'});await idle();expect(dirty.at(-1)).toBe(true);expect((screen.getByLabelText('Razón social') as HTMLInputElement).value).toBe('Cambio pendiente');
 }finally{window.removeEventListener('zenvia:settings-dirty',listener)}
});

it('opens General when a new initial-section request arrives on an already mounted Settings page',async()=>{
 const view=mount();await screen.findByRole('heading',{name:'Cuentas bancarias'});
 fireEvent.click(screen.getByRole('tab',{name:/Preferencias/}));
 view.rerender(<SettingsPage isAdmin access={{} as any} initialSection="general"/>);
 expect(await screen.findByRole('heading',{name:'Cuentas bancarias'})).toBeTruthy();
});
it('honors unsaved-change confirmation before following a new section request',async()=>{
 state.confirm.mockResolvedValue(false);const view=mount();await screen.findByRole('heading',{name:'Cuentas bancarias'});
 fireEvent.change(screen.getByLabelText('Razón social'),{target:{value:'Pendiente'}});
 view.rerender(<SettingsPage isAdmin access={{} as any} initialSection="integrations"/>);
 await waitFor(()=>expect(state.confirm).toHaveBeenCalled());expect(screen.getByRole('heading',{name:'Cuentas bancarias'})).toBeTruthy();
});
it('updates an open account editor after another account becomes the default',async()=>{
 state.rows=[{id:'a',alias:'Principal',iban:'ES9121000418450200051332',bic:null,holder:null,isDefault:true,archivedAt:null,validationStatus:'valid'},{id:'b',alias:'Ventas',iban:'DE89370400440532013000',bic:null,holder:null,isDefault:false,archivedAt:null,validationStatus:'valid'}];
 mount();await screen.findByRole('heading',{name:'Cuentas bancarias'});await idle();
 fireEvent.click(within(account('Principal')).getByRole('button',{name:'Editar'}));
 expect((screen.getByRole('checkbox',{name:'Usar por defecto'}) as HTMLInputElement).checked).toBe(true);
 fireEvent.click(within(account('Ventas')).getByRole('button',{name:'Usar por defecto'}));await waitFor(()=>expect(account('Ventas').textContent).toContain('Predeterminada'));await idle();
 expect((screen.getByRole('checkbox',{name:'Usar por defecto'}) as HTMLInputElement).checked).toBe(false);
 fireEvent.change(screen.getByLabelText('Alias de la cuenta'),{target:{value:'Principal editada'}});fireEvent.click(screen.getByRole('button',{name:'Guardar cuenta'}));
 await screen.findByRole('article',{name:'Cuenta Principal editada'});await idle();expect(account('Ventas').textContent).toContain('Predeterminada');
});
