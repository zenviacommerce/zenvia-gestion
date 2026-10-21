import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rows:{} as Record<string,any[]>,writes:[] as Array<{table:string;row:any;op:string}>,calls:[] as Array<{name:string;args:any}>}));
vi.mock('../src/services/supabase',()=>({supabase:{from:(table:string)=>{
 let single=false;const response=()=>({data:single?(state.rows[table]?.[0]??{id:'saved',receipt_number:'REC-2026-0001'}):(state.rows[table]??[]),error:null});
 const q:any={select:()=>q,order:()=>q,eq:()=>q,in:()=>q,is:()=>q,single:()=>{single=true;return q},maybeSingle:()=>{single=true;return q},insert:(row:any)=>{state.writes.push({table,row,op:'insert'});return q},update:(row:any)=>{state.writes.push({table,row,op:'update'});return q},delete:()=>q,then:(resolve:any)=>Promise.resolve(response()).then(resolve)};return q;
},rpc:async(name:string,args:any)=>{state.calls.push({name,args});return {data:name==='save_shopify_order_invoice'?'saved':{id:'bank',alias:args.p_alias,iban:args.p_iban,bic:args.p_bic,holder:args.p_holder,is_default:true,validation_status:'valid'},error:null}}}}));
import {createSalesInvoiceDraft,loadSalesInvoices,saveBusinessSettings} from '../src/services/sales';
import {createSalesReceipt,loadSalesReceipts,updateSalesReceipt} from '../src/services/salesReceipts';
import {saveOrderInvoice} from '../src/services/orderInvoices';
import {saveBusinessBankAccount} from '../src/services/businessBankAccounts';
import {updateSalesSeries} from '../src/services/salesConfig';
const snapshot={version:1,accountId:'bank',alias:'Chosen',iban:'DE89370400440532013000',bic:null,holder:null};
beforeEach(()=>{state.rows={};state.writes=[];state.calls=[]});
it('persists selected bank and stable method on manual invoice and internal receipt creation',async()=>{
 await createSalesInvoiceDraft({clientId:'client',seriesId:'series',issueDate:'2026-10-21',bankAccountId:'bank',paymentMethodId:'bank_transfer',paymentMethod:'Renamed transfer',lines:[]},30);
 expect(state.writes.find(x=>x.table==='sales_invoices')?.row).toMatchObject({bank_account_id:'bank',payment_method_id:'bank_transfer'});
 await createSalesReceipt({clientId:'client',receiptDate:'2026-10-21',bankAccountId:'bank',paymentMethodId:'bank_transfer',paymentMethod:'Renamed transfer',lines:[{position:1,description:'Item',quantity:1,unit:'ud',unitPrice:1,discountPercent:0,invoiceTaxRate:21}]});
 expect(state.writes.find(x=>x.table==='sales_receipts')?.row).toMatchObject({bank_account_id:'bank',payment_method_id:'bank_transfer',payment_method:'Renamed transfer'});
});
it('maps snapshots without replacing legacy data with current business settings',async()=>{
 state.rows.sales_invoices=[{id:'saved',client_id:'client',series_id:'series',status:'issued',bank_account_id:'bank',bank_account_snapshot:snapshot,bank_snapshot_source:'legacy_current_render',bank_snapshot_at:'captured'}];
 state.rows.sales_receipts=[{id:'receipt',client_id:'client',bank_account_snapshot:snapshot,bank_snapshot_source:'receipt_created',bank_snapshot_at:'captured',payment_method_id:'bank_transfer'}];
 expect((await loadSalesInvoices())[0]).toMatchObject({bankAccountId:'bank',bankAccountSnapshot:snapshot,bankSnapshotSource:'legacy_current_render',bankSnapshotAt:'captured'});
 expect((await loadSalesReceipts())[0]).toMatchObject({bankAccountSnapshot:snapshot,bankSnapshotSource:'receipt_created',paymentMethodId:'bank_transfer'});
});
it('keeps legacy business IBAN out of unrelated fiscal saves and receipt bank out of ordinary edits',async()=>{
 await saveBusinessSettings({legalName:'Issuer',countryCode:'ES',iban:'legacy-value'});
 expect(state.writes.find(x=>x.table==='business_settings')?.row).not.toHaveProperty('iban');
 await updateSalesReceipt('receipt',{clientId:'client',receiptDate:'2026-10-21',lines:[{position:1,description:'Item',quantity:1,unit:'ud',unitPrice:1,discountPercent:0,invoiceTaxRate:21}]});
 expect(state.writes.find(x=>x.table==='sales_receipts')?.row).not.toHaveProperty('bank_account_id');
});
it('passes bank and method in the existing Shopify RPC transaction and normalizes new bank saves',async()=>{
 state.rows.sales_invoices=[{id:'saved',status:'draft'}];
 await saveOrderInvoice('order',{client:{name:'Client',countryCode:'ES',paymentTermsDays:0},seriesId:'series',issueDate:'2026-10-21',lines:[],bankAccountId:'bank',paymentMethodId:'bank_transfer',paymentMethod:'Transferencia bancaria'},true);
 expect(state.calls[0]).toMatchObject({name:'save_shopify_order_invoice',args:{p_client:{bankAccountId:'bank',paymentMethodId:'bank_transfer'},p_issue:true}});
 expect(await saveBusinessBankAccount({alias:' Principal ',iban:'de89 3704 0044 0532 0130 00'})).toMatchObject({alias:'Principal',iban:'DE89370400440532013000',isDefault:true});
});
it('persists the optional default account when updating a series',async()=>{
 await updateSalesSeries('series',{code:'F',name:'Invoices',kind:'standard',year:2026,prefix:'F-',nextNumber:1,padding:4,active:true,defaultBankAccountId:'bank'});
 expect(state.writes.find(x=>x.table==='sales_invoice_series')?.row).toHaveProperty('default_bank_account_id','bank');
});
it('does not clear a frozen Shopify bank when the edit intentionally omits bank selection',async()=>{
 state.rows.sales_invoices=[{id:'saved',status:'draft',bank_snapshot_source:'issued',bank_account_id:'bank'}];
 await saveOrderInvoice('order',{client:{name:'Client',countryCode:'ES',paymentTermsDays:0},seriesId:'series',issueDate:'2026-10-21',lines:[]},false);
 expect(state.calls[0].args.p_client).not.toHaveProperty('bankAccountId');
});
