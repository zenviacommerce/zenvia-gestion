import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({rows:[] as any[],filters:[] as string[],failure:false}));
vi.mock('../src/services/supabase',()=>({supabase:{from:(table:string)=>{
 let mode='read',input:any,query='',id='';
 const q:any={select:()=>q,eq:(key:string,v:string)=>{if(key==='id')id=v;return q},order:()=>q,limit:()=>q,or:(v:string)=>{query=v;db.filters.push(v);return q},insert:(v:any)=>{mode='insert';input=v;return q},single:()=>q,update:(v:any)=>{mode='update';input=v;return q},delete:()=>{mode='delete';return q},then:(ok:any)=>{
  if(db.failure)return Promise.resolve({error:{message:'network'},data:null}).then(ok);
  if(table==='clients'){
   if(mode==='insert'){const row={id:'created',...input};db.rows.push(row);return Promise.resolve({data:row,error:null}).then(ok)}
   if(mode==='update')db.rows=db.rows.map(r=>r.id===id?{...r,...input}:r);
   if(mode==='delete')db.rows=db.rows.filter(r=>r.id!==id);
   return Promise.resolve({data:query?db.rows.filter(r=>r.name.includes(query.split('%')[1])):db.rows,error:null}).then(ok);
  }
  return Promise.resolve({data:[],error:null}).then(ok);
 }};return q;
}}}));
vi.mock('../src/context/SettingsContext',async()=>{const {DEFAULT_APP_SETTINGS,DEFAULT_USER_PREFERENCES}=await import('../src/services/settingsSchema');return {useSettings:()=>({settings:DEFAULT_APP_SETTINGS,preferences:DEFAULT_USER_PREFERENCES})}});
import {InvoiceModal} from '../src/pages/SalesInvoicesCore';
import {ReceiptModal} from '../src/pages/SalesReceipts';
import {addClient,updateClient,deleteClient} from '../src/services/sales';
beforeEach(()=>{db.rows=[{id:'old',name:'Cliente anterior'}];db.failure=false;db.filters=[]});afterEach(cleanup);
it.each(['invoice','receipt'])('creates a client via the real service then selects it in retained %s without reload',async kind=>{
 const props={clients:[{id:'old',name:'Cliente anterior'}],products:[],onClose:()=>{},onSaved:async()=>{}};
 render(kind==='invoice'?<InvoiceModal {...props} open invoice={null}/>:<ReceiptModal {...props} receipt={null}/>);
 fireEvent.change(screen.getByPlaceholderText(kind==='invoice'?'Observaciones visibles en la factura':'Observaciones internas o para el cliente…'),{target:{value:'Borrador conservado'}});
 await act(async()=>{await addClient({name:'Nuevo cliente sin recargar',countryCode:'ES'})});
 fireEvent.click(screen.getByRole('combobox',{name:kind==='invoice'?'Cliente de la factura':'Cliente del recibo'}));
 const option=await screen.findByRole('option',{name:'Nuevo cliente sin recargar'});fireEvent.click(option);
 expect(screen.getByRole('combobox',{name:kind==='invoice'?'Cliente de la factura':'Cliente del recibo'}).textContent).toContain('Nuevo cliente sin recargar');
 expect((screen.getByPlaceholderText(kind==='invoice'?'Observaciones visibles en la factura':'Observaciones internas o para el cliente…') as HTMLTextAreaElement).value).toBe('Borrador conservado');
});
it('searches the server for a client absent from the initial list',async()=>{
 render(<ReceiptModal clients={[]} products={[]} receipt={null} onClose={()=>{}} onSaved={async()=>{}}/>);
 await act(async()=>{});db.rows.push({id:'remote',name:'Remoto exclusivamente'});
 fireEvent.click(screen.getByRole('combobox',{name:'Cliente del recibo'}));fireEvent.change(screen.getByPlaceholderText('Buscar cliente…'),{target:{value:'Remoto'}});
 expect(await screen.findByRole('option',{name:'Remoto exclusivamente'})).toBeTruthy();expect(db.filters.at(-1)).toContain('name.ilike.%Remoto%');
});

it('publishes updates and deletes only after successful service writes',async()=>{
 render(<ReceiptModal clients={[]} products={[]} receipt={null} onClose={()=>{}} onSaved={async()=>{}}/>);
 await act(async()=>{});fireEvent.click(screen.getByRole('combobox',{name:'Cliente del recibo'}));
 await act(async()=>{await updateClient('old',{name:'Cliente editado',countryCode:'ES'})});
 expect(await screen.findByRole('option',{name:'Cliente editado'})).toBeTruthy();
 db.failure=true;await expect(deleteClient('old')).rejects.toBeTruthy();expect(screen.getByRole('option',{name:'Cliente editado'})).toBeTruthy();
 db.failure=false;await act(async()=>{await deleteClient('old')});await waitFor(()=>expect(screen.queryByRole('option',{name:'Cliente editado'})).toBeNull());
});
it('refreshes an unchanged dropdown after five seconds without losing its draft',async()=>{
 const now=vi.spyOn(Date,'now').mockReturnValue(100000);
 render(<ReceiptModal clients={[]} products={[]} receipt={null} onClose={()=>{}} onSaved={async()=>{}}/>);
 await act(async()=>{});db.rows.push({id:'external',name:'Creado en otra pantalla'});now.mockReturnValue(106000);
 fireEvent.click(screen.getByRole('combobox',{name:'Cliente del recibo'}));expect(await screen.findByRole('option',{name:'Creado en otra pantalla'})).toBeTruthy();now.mockRestore();
});
it('keeps the selected client and notes when another client arrives in the invoice modal',async()=>{
 render(<InvoiceModal clients={[{id:'old',name:'Cliente anterior'}]} products={[]} invoice={null} open onClose={()=>{}} onSaved={async()=>{}}/>);
 await act(async()=>{});fireEvent.change(screen.getByPlaceholderText('Observaciones visibles en la factura'),{target:{value:'No perder'}});
 await act(async()=>{await addClient({name:'Otro cliente',countryCode:'ES'})});
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'Cliente de la factura'}).textContent).toContain('Cliente anterior'));
 expect((screen.getByPlaceholderText('Observaciones visibles en la factura') as HTMLTextAreaElement).value).toBe('No perder');
});
