import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
const owner='00000000-0000-4000-8000-000000000001';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=(name:string)=>readFileSync('supabase/migrations/'+name,'utf8');
const definition=(sql:string,name:string)=>{const match=sql.match(new RegExp('create or replace function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\$(?:function)?\\$;','i'));if(!match)throw Error('Function fixture missing '+name);return match[0]};
it('uses real manual, fiscal receipt, reopen and Shopify RPCs without changing their numbering or fiscal results',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA private;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE products(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '${owner}'::uuid$$;
 CREATE FUNCTION private.app_workspace_owner_id() RETURNS uuid LANGUAGE sql AS $$SELECT '${owner}'::uuid$$;
 CREATE FUNCTION private.app_has_permission(text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION private.app_is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION private.mfa_allowed() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION private.sales_setting_boolean(uuid,text,boolean) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION private.sales_default_due_days(uuid) RETURNS integer LANGUAGE sql AS $$SELECT 30$$;
 INSERT INTO auth.users VALUES('${owner}');`);
 const baseline=read('20260917120000_sales_module_baseline.sql');
 for(const table of ['business_settings','clients','sales_invoice_series','business_tax_registrations','sales_invoices','sales_invoice_lines','sales_payments','sales_invoice_released_numbers']){
  const match=baseline.match(new RegExp('create table if not exists public\\.'+table+' \\([\\s\\S]*?\\n\\);'));if(!match)throw Error('Missing table fixture '+table);await db.exec(match[0]);
 }
 await db.exec(`ALTER TABLE sales_invoice_series DROP CONSTRAINT sales_invoice_series_kind_check;
 ALTER TABLE sales_invoices ADD COLUMN document_kind text DEFAULT 'invoice',ADD COLUMN fiscal_treatment text DEFAULT 'taxable',ADD COLUMN fiscal_reason text;
 CREATE TABLE fulfillment_orders(id uuid PRIMARY KEY,owner_id uuid,source_channel text,source_integration_account_id uuid,order_id text,order_number text,order_created_at timestamptz,currency text,total_amount numeric,raw_payload jsonb);
 CREATE TABLE sales_receipts(id uuid PRIMARY KEY,owner_id uuid);
 ALTER TABLE sales_invoices ADD COLUMN source_order_key text,ADD COLUMN source_fulfillment_order_id uuid;
 INSERT INTO business_settings(owner_id,legal_name,tax_id,address_line1,postal_code,city,iban) VALUES('${owner}','Fixture issuer','ES-TEST','Test street','28001','Madrid','ES9121000418450200051332');
 INSERT INTO clients(id,owner_id,name,country_code) VALUES('${id(1)}','${owner}','Fixture Client','ES');
 INSERT INTO sales_invoice_series(id,owner_id,code,name,kind,year,prefix) VALUES('${id(2)}','${owner}','F','Invoices','standard',2026,'F-2026-'),('${id(3)}','${owner}','REC','Receipts','receipt',2026,'REC-2026-');`);
 await db.exec(definition(read('20260918195500_allow_missing_client_tax_id_on_issue.sql'),'public.issue_sales_invoice'));
 await db.exec(readFileSync('tests/fixtures/bank-legacy-issue-sales-receipt.sql','utf8'));
 await db.exec(definition(baseline,'public.reopen_sales_invoice'));
 await db.exec(definition(read('20260921090000_configurable_sales_behavior.sql'),'private.guard_sales_invoice_immutable'));
 await db.exec(`CREATE TRIGGER sales_invoices_immutable BEFORE UPDATE OR DELETE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION private.guard_sales_invoice_immutable();`);
 for(const fn of ['private.sales_invoice_line_calculate','private.recalculate_sales_invoice_totals'])await db.exec(definition(baseline,fn));
 await db.exec(`CREATE TRIGGER calc BEFORE INSERT OR UPDATE ON sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION private.sales_invoice_line_calculate();CREATE TRIGGER totals AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION private.recalculate_sales_invoice_totals();`);
 await db.exec(read('20261012152533_shopify_order_invoice_fiscal_defaults.sql'));
 await db.exec(read('20261013064000_sales_number_padding_preserves_digits.sql'));
 const original=(await db.query<any>(`select pg_get_functiondef('public.issue_sales_invoice(uuid)'::regprocedure) f`)).rows[0].f;
 const bankMigration=read(readdirSync('supabase/migrations').find(n=>n.endsWith('_multiple_business_bank_accounts.sql'))!);
 await db.exec(bankMigration);await db.exec(bankMigration);
 expect((await db.query<any>(`select pg_get_functiondef('public.issue_sales_invoice(uuid)'::regprocedure) f`)).rows[0].f).toBe(original);
 const account=(await db.query<any>(`select to_jsonb(public.save_business_bank_account(null,'Selected','DE89370400440532013000',null,null,false)) a`)).rows[0].a;
 const invoice=async(n:number,receipt=false)=>{
  await db.query(`insert into sales_invoices(id,client_id,series_id,document_kind,payment_method_id,bank_account_id,issue_date) values($1,$2,$3,$4,'bank_transfer',$5,'2026-10-21')`,[id(n),id(1),id(receipt?3:2),receipt?'receipt':'invoice',account.id]);
  await db.query(`insert into sales_invoice_lines(invoice_id,description,quantity,unit_price,tax_rate) values($1,'Fixture item',1,10,21)`,[id(n)]);
  return (await db.query<any>(`select to_jsonb(public.${receipt?'issue_sales_receipt':'issue_sales_invoice'}($1)) i`,[id(n)])).rows[0].i;
 };
 const manual=await invoice(10);expect(manual).toMatchObject({invoice_number:'F-2026-0001',status:'issued',bank_snapshot_source:'issued',total_amount:12.1});
 expect(manual.bank_account_snapshot.iban).toBe('DE89370400440532013000');
 const fiscalReceipt=await invoice(11,true);expect(fiscalReceipt.invoice_number).toBe('REC-2026-0001');expect(fiscalReceipt.bank_account_snapshot.iban).toBe('DE89370400440532013000');
 await db.query(`select public.reopen_sales_invoice($1)`,[id(10)]);
 await db.query(`select public.save_business_bank_account($1,'Changed','GB82WEST12345698765432',null,null,true)`,[account.id]);
 const reopened=(await db.query<any>(`select to_jsonb(public.issue_sales_invoice($1)) i`,[id(10)])).rows[0].i;
 expect(reopened.invoice_number).toBe(manual.invoice_number);expect(reopened.bank_account_snapshot).toEqual(manual.bank_account_snapshot);
 await db.exec(`INSERT INTO fulfillment_orders VALUES('${id(30)}','${owner}','shopify','${id(40)}','fixture-order','FIXTURE-30','2026-10-21','EUR',12.10,'{"taxesIncluded":false,"lineItems":{"pageInfo":{"hasNextPage":false}},"shippingLines":{"pageInfo":{"hasNextPage":false}}}');`);
 const client={name:'Shopify fixture',addressLine1:'Test road',postalCode:'28001',city:'Madrid',countryCode:'ES',bankAccountId:account.id,paymentMethodId:'bank_transfer',paymentMethod:'Transferencia bancaria'};
 const lines=[{description:'Item',quantity:1,unit:'ud',unitPrice:10,discountPercent:0,taxRate:21}];
 const saved=(await db.query<any>(`select public.save_shopify_order_invoice($1,$2::jsonb,$3,'2026-10-21',$4::jsonb,true) id`,[id(30),JSON.stringify(client),id(2),JSON.stringify(lines)])).rows[0].id;
 const shopify=(await db.query<any>('select invoice_number,status,bank_account_snapshot,bank_snapshot_source from sales_invoices where id=$1',[saved])).rows[0];
 expect(shopify).toMatchObject({invoice_number:'F-2026-0002',status:'issued',bank_snapshot_source:'issued'});expect(shopify.bank_account_snapshot.iban).toBe('GB82WEST12345698765432');
 await db.query('select public.reopen_sales_invoice($1)',[saved]);
 const noBank={...client} as Record<string,unknown>;delete noBank.bankAccountId;
 await db.query(`select public.save_shopify_order_invoice($1,$2::jsonb,$3,'2026-10-21',$4::jsonb,true)`,[id(30),JSON.stringify(noBank),id(2),JSON.stringify(lines)]);
 expect((await db.query<any>('select bank_account_snapshot from sales_invoices where id=$1',[saved])).rows[0].bank_account_snapshot).toEqual(shopify.bank_account_snapshot);
 }finally{await db.close()}
},30000);
