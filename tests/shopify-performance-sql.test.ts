import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
const owner='00000000-0000-4000-8000-000000000001',shop='00000000-0000-4000-8000-000000000002';
it('batch retains period parity, store isolation and MFA; resolves timezone once',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.owner',true),'')::uuid$$;
 create function private.app_workspace_owner_id() returns uuid language sql as $$select auth.uid()$$;
 create function private.app_has_permission(text) returns boolean language sql as $$select true$$;
 create table workspaces(id uuid primary key);create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text,credential_source text,display_name text,config jsonb,external_account_id text);
 create table products(id uuid primary key,owner_id uuid,name text);create table product_price_history(id uuid,owner_id uuid,product_id uuid,price_date date,created_at timestamptz,normalized_unit_price numeric,currency text);
 create table fulfillment_orders(owner_id uuid,source_channel text,source_integration_account_id uuid,order_id text,sendcloud_id text,shipping_cost_net_amount numeric,shipping_cost_currency text,shipping_cost_recorded_at timestamptz,last_synced_at timestamptz);
 create table public.app_settings(owner_id uuid primary key,config jsonb);create table private.mfa_function_manifest(function_oid oid,implementation regprocedure,wrapper_hash text,signature text,original_definition text);create sequence tz_calls;create function private.amazon_analytics_timezone() returns text language plpgsql as $$begin perform nextval('public.tz_calls');return 'Europe/Madrid';end$$;
 create function private.amazon_rate_to_eur(text,date) returns numeric language sql as $$select case when $1='EUR' then 1 else null end::numeric$$;
 create function public.security_mfa_assert(boolean) returns void language plpgsql as $$begin if current_setting('test.mfa',true)='deny' then raise exception 'MFA_REQUIRED' using errcode='42501';end if;end$$;
 select set_config('test.owner','${owner}',false);insert into workspaces values('${owner}');insert into integration_accounts values('${shop}','${owner}','shopify',true,'connected','own','Shop','{}','shop');`);
 const base=readFileSync('supabase/migrations/20261014114444_shopify_readonly_analytics.sql','utf8');await db.exec(base.slice(0,base.indexOf('-- Definer RPCs')));
 const defs=JSON.parse(readFileSync('supabase/snapshots/20261019-shopify-performance/functions-before.json','utf8'));
 for(const name of ['shopify_analytics_owner','shopify_cost','shopify_shipping','mfa_impl_3790979','mfa_impl_3793373'])await db.exec(defs.find((d:any)=>d.proname===name).definition);
 for(const [name,impl,args] of [['shopify_analytics_summary','mfa_impl_3790979','date,date,uuid[]'],['shopify_analytics_products','mfa_impl_3793373','date,date,uuid[],text,integer,integer,text,text,boolean']]){
 const types=args.split(',');await db.exec(`create function public.${name}(${args}) returns jsonb language plpgsql security definer as $$begin perform public.security_mfa_assert(false);return private.${impl}(${types.map((_,i)=>'$'+(i+1)).join(',')});end$$;`);
 }
 await db.exec(`insert into shopify_analytics_orders(owner_id,integration_account_id,order_id,event_at,updated_at,currency,gross_sales,sales_vat,discounts,shipping_charged,financial_status,requires_shipping) values('${owner}','${shop}','one','2026-10-18T22:00:00Z',now(),'EUR',121,21,0,0,'PAID',false),('${owner}','${shop}','previous','2026-09-15T12:00Z',now(),'EUR',50,5,0,0,'PAID',false);
 insert into shopify_analytics_items values('${owner}','${shop}','one','line','EUR','SKU',null,'Product',null,2,121,100,21);`);
 await db.exec(`insert into products values('00000000-0000-4000-8000-000000000003','${owner}','Internal');insert into product_price_history values('00000000-0000-4000-8000-000000000004','${owner}','00000000-0000-4000-8000-000000000003','2026-09-01',now(),3.5,'EUR');insert into shopify_product_mappings(owner_id,integration_account_id,seller_sku,product_id) values('${owner}','${shop}','SKU','00000000-0000-4000-8000-000000000003');update shopify_analytics_orders set requires_shipping=true where order_id='one';insert into fulfillment_orders values('${owner}','shopify','${shop}','one',null,2,'EUR','2026-10-19T10:00Z',now());insert into shopify_analytics_refunds values('${owner}','${shop}','one','refund','EUR','2026-10-19T10:00Z',12.1,2.1,10);`);
 const ranges=[{id:'today',from:'2026-10-19',to:'2026-10-19'},{id:'previous',from:'2026-09-01',to:'2026-09-30'},{id:'empty',from:'2026-10-18',to:'2026-10-18'}];
 const expected=[];for(const r of ranges)expected.push((await db.query('select public.shopify_analytics_summary($1,$2,null) data',[r.from,r.to])).rows[0]);
 await db.exec(`insert into private.mfa_function_manifest(function_oid,implementation,wrapper_hash) select 'public.shopify_analytics_summary(date,date,uuid[])'::regprocedure::oid,'private.mfa_impl_3790979(date,date,uuid[])'::regprocedure,md5(pg_get_functiondef('public.shopify_analytics_summary(date,date,uuid[])'::regprocedure::oid));insert into private.mfa_function_manifest(function_oid,implementation,wrapper_hash) select 'public.shopify_analytics_products(date,date,uuid[],text,integer,integer,text,text,boolean)'::regprocedure::oid,'private.mfa_impl_3793373(date,date,uuid[],text,integer,integer,text,text,boolean)'::regprocedure,md5(pg_get_functiondef('public.shopify_analytics_products(date,date,uuid[],text,integer,integer,text,text,boolean)'::regprocedure::oid));`);
 const migration=readdirSync('supabase/migrations').find(n=>n.endsWith('_shopify_analytics_performance.sql'));
 if(migration)await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
 await expect(db.exec(`insert into app_settings values('${owner}','{"general":{"timezone":"Mars/Olympus"}}')`)).rejects.toThrow(/Zona horaria/);
 await db.exec(`insert into app_settings values('${owner}','{"general":{"timezone":"Europe/Madrid"}}')`);
 expect((await db.query('select private.amazon_analytics_timezone() tz')).rows[0].tz).toBe('Europe/Madrid');
 await db.exec(`update app_settings set config='{"general":{"timezone":"America/New_York"}}'`);
 expect((await db.query('select private.amazon_analytics_timezone() tz')).rows[0].tz).toBe('America/New_York');
 await db.exec(`update app_settings set config='{"general":{"timezone":"Europe/Madrid"}}'`);
 const exists=await db.query(`select to_regprocedure('public.shopify_analytics_summary_batch(jsonb,uuid[])') is not null present`);expect(exists.rows[0].present).toBe(true);
 await db.exec(`alter function private.amazon_analytics_timezone() rename to real_timezone_for_test;create function private.amazon_analytics_timezone() returns text language plpgsql as $$begin perform nextval('public.tz_calls');return private.real_timezone_for_test();end$$;alter sequence tz_calls restart with 1`);
 const result:any=(await db.query('select public.shopify_analytics_summary_batch($1,null) data',[JSON.stringify(ranges)])).rows[0].data;
 expect(result.map((r:any)=>({data:r.data}))).toEqual(expected);expect((await db.query('select last_value from tz_calls')).rows[0].last_value).toBe(1);
 const manifest:any=(await db.query(`select wrapper_hash=md5(pg_get_functiondef(function_oid)) valid,not has_function_privilege('authenticated',implementation,'execute') hidden from private.mfa_function_manifest where signature='public.shopify_analytics_summary_batch(jsonb,uuid[])'`)).rows[0];expect(manifest).toEqual({valid:true,hidden:true});
 const mixed:any=(await db.query('select public.shopify_analytics_summary_batch($1,null) data',[JSON.stringify([...ranges,{id:'invalid',from:'2026-10-20',to:'2026-10-19'}])])).rows[0].data;expect(mixed[0].data).toEqual(result[0].data);expect(mixed[3].error).toBeTruthy();
 const isolated:any=(await db.query('select public.shopify_analytics_summary_batch($1,$2) data',[JSON.stringify(ranges),['00000000-0000-4000-8000-000000000099']])).rows[0].data;expect(isolated[0].data.orders).toBe(0);
 await expect(db.query('select public.shopify_analytics_summary_batch($1,null)',[JSON.stringify(Array(9).fill(ranges[0]))])).rejects.toThrow();
 await db.exec(`select set_config('test.owner','00000000-0000-4000-8000-000000000099',false)`);const other:any=(await db.query('select public.shopify_analytics_summary_batch($1,null) data',[JSON.stringify(ranges)])).rows[0].data;expect(other[0].data.orders).toBe(0);await db.exec(`select set_config('test.owner','${owner}',false)`);
 await db.exec(`select set_config('test.mfa','deny',false)`);await expect(db.query('select public.shopify_analytics_summary_batch($1,null)',[JSON.stringify(ranges)])).rejects.toThrow(/MFA_REQUIRED/);
 }finally{await db.close()}
},30000);
