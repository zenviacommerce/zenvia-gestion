// @vitest-environment node
import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create table private.mfa_function_manifest(signature text primary key,function_oid oid,implementation regprocedure,original_definition text,wrapper_hash text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function private.app_has_permission(text) returns boolean language sql stable as $$select current_setting('test.orders',true)='yes'$$;
 create function private.app_workspace_owner_id() returns uuid language sql stable as $$select nullif(current_setting('test.owner',true),'')::uuid$$;
 create function public.security_mfa_assert(boolean) returns void language plpgsql stable as $$begin if current_setting('test.mfa',true) is distinct from 'yes' then raise exception 'MFA_REQUIRED';end if;end$$;
 create table public.business_settings(owner_id uuid,legal_name text,tax_id text,address_line1 text,address_line2 text,postal_code text,city text,province text,country_code text,email text,phone text);
 insert into business_settings values('${owner}','Synthetic sender','TEST','Test road',null,'28001','Madrid','Madrid','ES',null,null);
 `+readFileSync('tests/fixtures/orders-table-schema.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261020072636_pickup_reports.sql','utf8'));
 await db.exec(`set test.uid='${owner}';set test.owner='${owner}';set test.orders='yes';set test.mfa='yes';insert into fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,shipping_address,items,carrier_name,label_created_at,tracking_number,shipping_remote_id) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${owner}','synthetic-'||n,'SYNTHETIC-'||n,'shopify','unfulfilled','{}','[]',case when n=1 then 'MRW' else 'Correos Express' end,now(),'SYNTHETIC-'||n,'test-'||n from generate_series(1,3)n`);
 // Historical mixed snapshot is created before the additive invariant is installed.
 const legacy=(await db.query<any>('select pickup_report_create($1,$2,false,$3) report',[[id(1),id(2)],id(90),{}])).rows[0].report;
 await db.exec(`create table public.workspaces(id uuid primary key);insert into public.workspaces values('${owner}'),('${other}')`);
 await db.exec('create table private.pickup_document_state(report_id uuid primary key,status text)');
 await db.exec(readFileSync('supabase/migrations/20261022230532_pickup_report_batches.sql','utf8'));return{db,legacy}}
const create=(db:PGlite,request=id(91),counts:Record<string,number>={[id(1)]:2,[id(2)]:3})=>db.query<any>('select pickup_report_create_batch($1,$2,true,$3) reports',[[id(1),id(2)],request,counts]).then(r=>r.rows[0].reports);
it('creates exactly one numbered report per carrier atomically; retries preserve all snapshots and historical mixed documents',async()=>{const{db,legacy}=await setup();try{const reports=await create(db);expect(reports).toHaveLength(2);expect(reports.map((r:any)=>r.number)).toEqual([expect.stringMatching(/0002$/),expect.stringMatching(/0003$/)]);for(const r of reports)expect(new Set(r.items.map((i:any)=>i.carrier)).size).toBe(1);expect(reports.reduce((sum:number,r:any)=>sum+r.totalPackages,0)).toBe(5);
 await db.exec(`update fulfillment_orders set carrier_name='GLS',tracking_number='CHANGED' where id='${id(1)}'`);expect(await create(db)).toEqual(reports);expect((await db.query<any>('select snapshot from pickup_reports where id=$1',[legacy.id])).rows[0].snapshot).toEqual(legacy);await expect(create(db,id(91),{[id(1)]:4,[id(2)]:3})).rejects.toThrow('PICKUP_REQUEST_REUSED');
 }finally{await db.close()}},20000);
it('rejects future mixed snapshots and rolls back all groups on failure without spending numbers',async()=>{const{db}=await setup();try{await expect(db.query('select pickup_report_create($1,$2,true,$3)',[[id(1),id(2)],id(92),{}])).rejects.toThrow('PICKUP_SINGLE_CARRIER_REQUIRED');
 await expect(create(db,id(93),{[id(1)]:2,[id(2)]:101})).rejects.toThrow('PICKUP_INVALID_PACKAGES');expect(Number((await db.query<any>('select count(*) count from pickup_reports')).rows[0].count)).toBe(1);expect((await create(db,id(94)))[0].number).toMatch(/0002$/);
 }finally{await db.close()}},20000);
it('checks MFA and owner before returning even a previously successful batch',async()=>{const{db}=await setup();try{await create(db);await db.exec("set test.mfa='no'");await expect(create(db)).rejects.toThrow('MFA_REQUIRED');await db.exec(`set test.mfa='yes';set test.owner='${other}'`);await expect(create(db)).rejects.toThrow('PICKUP_ORDERS_UNAVAILABLE');
 const manifest=(await db.query<any>("select wrapper_hash=md5(pg_get_functiondef(function_oid)) valid from private.mfa_function_manifest where signature like '%pickup_report_create_batch%' ")).rows;expect(manifest).toEqual([{valid:true}]);
 }finally{await db.close()}},20000);
