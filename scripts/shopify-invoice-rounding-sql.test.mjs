import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('Shopify included-tax invoice #1023 totals 40.98; manual, Amazon and receipts keep their previous rules',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create function private.app_workspace_owner_id() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000099'::uuid$$;create function private.app_has_permission(text) returns boolean language sql as $$select true$$;create table fulfillment_orders(id uuid primary key,owner_id uuid,source_channel text,raw_payload jsonb);create table sales_invoices(id uuid primary key,owner_id uuid,invoice_type text,document_kind text,fiscal_treatment text,source_fulfillment_order_id uuid);create table sales_invoice_lines(invoice_id uuid,quantity numeric,unit_price numeric,discount_percent numeric,tax_rate numeric,line_net numeric,tax_amount numeric,line_total numeric);`);
 for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).sort()){
 const sql=await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 const definition=sql.match(/create or replace function private\.sales_invoice_line_calculate\(\)[\s\S]*?\$(?:function)?\$;/i)?.[0];
 if(name.endsWith('_shopify_invoice_tax_rounding.sql'))await db.exec(sql);else if(definition)await db.exec(definition);
 }
 await db.exec(`create trigger calc before insert or update on sales_invoice_lines for each row execute function private.sales_invoice_line_calculate();insert into fulfillment_orders values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','shopify','{"taxesIncluded":true}'),('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000099','amazon','{"taxesIncluded":true}');`);
 const insert=async(id,kind='invoice',source=null,rate=21)=>{
 await db.query('insert into sales_invoices values($1,$2,$3,$4,$5,$6)',[id,'00000000-0000-0000-0000-000000000099','standard',kind,kind==='receipt'?'exempt':'standard',source]);
 return (await db.query('insert into sales_invoice_lines(invoice_id,quantity,unit_price,discount_percent,tax_rate) values($1,1,23.1322,0,$2),($1,1,10.7355,0,$2) returning line_net,tax_amount,line_total',[id,rate])).rows;
 };
 const shopify=await insert('10000000-0000-0000-0000-000000000001','invoice','00000000-0000-0000-0000-000000000001');
 assert.deepEqual(shopify.map(x=>Number(x.tax_amount)),[4.86,2.25]);
 assert.equal(Math.round(shopify.reduce((s,x)=>s+Number(x.line_total),0)*100),4098);
 for(const [id,source] of [['10000000-0000-0000-0000-000000000002',null],['10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002']]){
 const rows=await insert(id,'invoice',source);assert.deepEqual(rows.map(x=>Number(x.tax_amount)),[4.86,2.26]);
 }
 await db.exec('grant usage on schema private to authenticated;grant select on sales_invoices to authenticated;grant insert,select on sales_invoice_lines to authenticated;set role authenticated');
 await assert.rejects(()=>db.query('select * from fulfillment_orders'),/permission denied/);
 const restricted=(await db.query("insert into sales_invoice_lines(invoice_id,quantity,unit_price,discount_percent,tax_rate) values('10000000-0000-0000-0000-000000000001',1,10.7355,0,21) returning line_total")).rows;
 assert.equal(Number(restricted[0].line_total),12.99,'sales-only user cannot read orders but keeps fiscal rounding');
 await db.exec('reset role');
 await db.exec("insert into sales_invoices values('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000088','standard','invoice','standard','00000000-0000-0000-0000-000000000001')");
 assert.equal((await db.query("select private.sales_shopify_tax_included('10000000-0000-0000-0000-000000000006') included")).rows[0].included,false,'foreign workspace cannot inspect a fiscal flag');
 const receipt=await insert('10000000-0000-0000-0000-000000000004','receipt',null,0);assert.deepEqual(receipt.map(x=>Number(x.tax_amount)),[0,0]);
 await assert.rejects(()=>insert('10000000-0000-0000-0000-000000000005','receipt',null,21),/IVA 0/);
 // Exercise real receipt creation, numbering and totals in the isolated database.
 const receiptSql=await readFile(new URL('../supabase/migrations/20260928133000_sales_receipts.sql',import.meta.url),'utf8');
 await db.exec('create table sales_receipt_counters(owner_id uuid,year integer,next_number integer,primary key(owner_id,year));create table sales_receipts(id uuid primary key,owner_id uuid,receipt_date date,receipt_number text,total_amount numeric default 0);create table sales_receipt_lines(receipt_id uuid,quantity numeric,unit_price numeric,discount_percent numeric,invoice_tax_rate numeric,line_total numeric);');
 for(const name of ['assign_sales_receipt_number','sales_receipt_line_calculate','recalculate_sales_receipt_total'])await db.exec(receiptSql.match(new RegExp('create or replace function private\\.'+name+'\\(\\)[\\s\\S]*?\\$\\$;','i'))[0]);
 await db.exec('create trigger number before insert on sales_receipts for each row execute function private.assign_sales_receipt_number();create trigger receipt_calc before insert or update on sales_receipt_lines for each row execute function private.sales_receipt_line_calculate();create trigger receipt_total after insert or update or delete on sales_receipt_lines for each row execute function private.recalculate_sales_receipt_total();begin;');
 const receiptId='20000000-0000-0000-0000-000000000001';
 await db.query("insert into sales_receipts(id,owner_id,receipt_date) values($1,'00000000-0000-0000-0000-000000000099','2026-10-21')",[receiptId]);
 await db.query('insert into sales_receipt_lines(receipt_id,quantity,unit_price,discount_percent,invoice_tax_rate) values($1,2,12.99,10,21)',[receiptId]);
 const created=(await db.query('select receipt_number,total_amount from sales_receipts where id=$1',[receiptId])).rows[0];
 assert.equal(created.receipt_number,'REC-2026-0001');assert.equal(Number(created.total_amount),23.38,'receipt retains future invoice rate but does not add VAT');
 await db.exec('rollback');assert.equal((await db.query('select count(*)::int n from sales_receipts')).rows[0].n,0);
 }finally{await db.close()}
});
