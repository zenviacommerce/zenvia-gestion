import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFile,readdir} from 'node:fs/promises';
it('executes service-only receipts, scoped trace, leases, retry timing and atomic stale snapshot protection',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table public.workspaces(id uuid primary key,status text);create table public.integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text,credential_source text,config jsonb,last_success_at timestamptz,last_error text,updated_at timestamptz);create table public.fulfillment_orders(id int primary key,source_channel text,order_updated_at timestamptz,total_amount numeric);`);
 const path=(await readdir('supabase/migrations')).find(x=>x.endsWith('_shopify_order_freshness.sql'))!;
 await db.exec(await readFile('supabase/migrations/'+path,'utf8'));
 const owner='00000000-0000-4000-8000-000000000001',store='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',token='00000000-0000-4000-8000-000000000004',token2='00000000-0000-4000-8000-000000000005';
 await db.exec(`insert into workspaces values('${owner}','active');insert into integration_accounts(id,owner_id,provider,enabled,status,credential_source) values('${store}','${owner}','shopify',true,'connected','vault');`);
 await db.exec(`select shopify_record_order_ingestion('${owner}','${store}','123','2026-10-20T12:53:27Z','operational','webhook','2026-10-20T12:53:28Z');select shopify_record_order_ingestion('${owner}','${store}','123','2026-10-20T12:53:27Z','analytics','webhook','2026-10-20T12:53:28Z');`);
 const before=(await db.query<any>('select * from shopify_order_ingestion_trace')).rows[0];
 await db.exec(`select shopify_record_order_ingestion('${owner}','${store}','123','2026-10-20T12:53:27Z','operational','cron',null);`);
 const after=(await db.query<any>('select * from shopify_order_ingestion_trace')).rows[0];expect(after.operational_imported_at).toEqual(before.operational_imported_at);expect(after.operational_source).toBe('webhook');expect(after.analytics_imported_at).toBeTruthy();
 await expect(db.exec(`select shopify_record_order_ingestion('${other}','${store}','123',null,'analytics','webhook',null)`)).rejects.toThrow('Invalid Shopify scope');
 const acquire=(lease:string,poll:boolean)=>db.query<any>(`select shopify_order_sync_acquire('${owner}','${store}','${lease}',${poll}) as acquired`);
 expect((await acquire(token,true)).rows[0].acquired).toBe(true);expect((await acquire(token2,false)).rows[0].acquired).toBe(false);
 await db.exec(`select shopify_order_sync_release('${owner}','${store}','${token2}',true);`);expect((await acquire(token2,false)).rows[0].acquired).toBe(false);
 await db.exec(`select shopify_order_sync_release('${owner}','${store}','${token}',false);`);expect((await acquire(token2,true)).rows[0].acquired).toBe(false);expect((await acquire(token2,false)).rows[0].acquired).toBe(true);
 await db.exec(`insert into shopify_order_events(owner_id,integration_account_id,delivery_id,order_id,topic) values('${owner}','${store}','delivery','123','orders/create') on conflict do nothing;insert into shopify_order_events(owner_id,integration_account_id,delivery_id,order_id,topic) values('${owner}','${store}','delivery','123','orders/create') on conflict do nothing;`);
 expect((await db.query<any>('select count(*)::int n from shopify_order_events')).rows[0].n).toBe(1);
 await db.exec(`insert into fulfillment_orders values(1,'shopify','2026-10-20T13:00Z',10);update fulfillment_orders set order_updated_at='2026-10-20T12:59Z',total_amount=999 where id=1;`);expect((await db.query<any>('select total_amount from fulfillment_orders')).rows[0].total_amount).toBe('10');
 await db.exec(`update integration_accounts set config='{"syncOrders":true,"manualSetting":"preserve"}' where id='${store}';`);
 expect((await db.query<any>(`select shopify_commit_orders_cursor('${owner}','${store}',clock_timestamp()-interval '1 minute') as committed`)).rows[0].committed).toBe(true);
 const cursor=(await db.query<any>(`select config from integration_accounts where id='${store}'`)).rows[0].config;
 await db.exec(`select shopify_commit_orders_cursor('${owner}','${store}',clock_timestamp()-interval '5 minutes');`);
 expect((await db.query<any>(`select config from integration_accounts where id='${store}'`)).rows[0].config).toEqual(cursor);expect(cursor.manualSetting).toBe('preserve');
 await db.exec(`update integration_accounts set enabled=false where id='${store}';`);
 expect((await db.query<any>(`select shopify_commit_orders_cursor('${owner}','${store}',clock_timestamp()) as committed`)).rows[0].committed).toBe(false);
 expect((await db.query<any>(`select shopify_commit_orders_cursor('${other}','${store}',clock_timestamp()) as committed`)).rows[0].committed).toBe(false);
 await db.exec('set role authenticated');await expect(db.exec('select * from shopify_order_events')).rejects.toThrow('permission denied');await expect(db.exec(`select shopify_order_sync_acquire('${owner}','${store}','${token}',false)`)).rejects.toThrow('permission denied');
 }finally{await db.close();}
},30000);
