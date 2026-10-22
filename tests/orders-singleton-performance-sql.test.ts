import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

it('preserves complete RPC results while avoiding singleton JSON array merges, including purge, duplicate and tenant cases',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA private;CREATE SCHEMA auth;
 CREATE TABLE private.mfa_function_manifest(signature text primary key,function_oid oid not null,implementation regprocedure not null,original_definition text not null,wrapper_hash text not null);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT current_setting('test.owner')::uuid$$;
 CREATE FUNCTION private.mfa_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT current_setting('test.mfa',true)='yes'$$;
 CREATE FUNCTION private.app_has_permission(text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
 CREATE FUNCTION private.app_workspace_owner_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT current_setting('test.owner')::uuid$$;
 CREATE FUNCTION public.security_mfa_assert(boolean) RETURNS void LANGUAGE plpgsql STABLE AS $$BEGIN IF current_setting('test.mfa',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'MFA_REQUIRED';END IF;END$$;
 CREATE TABLE public.business_settings(owner_id uuid,legal_name text,tax_id text,address_line1 text,address_line2 text,postal_code text,city text,province text,country_code text,email text,phone text,iban text);
 `+readFileSync('tests/fixtures/orders-table-schema.sql','utf8'));
 await db.exec(`ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA private TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON fulfillment_orders TO authenticated,service_role;
 CREATE POLICY tenant ON fulfillment_orders TO authenticated USING(owner_id=private.app_workspace_owner_id()) WITH CHECK(owner_id=private.app_workspace_owner_id());
 SET test.owner='00000000-0000-4000-8000-000000000001';SET test.mfa='yes';
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,source_channel,order_number,source_status,order_created_at,shipping_address,items,raw_payload,customer_name,customer_email,currency,pii_purged_at,total_amount)
 SELECT md5(n::text)::uuid,CASE WHEN n=25 THEN '00000000-0000-4000-8000-000000000002'::uuid ELSE current_setting('test.owner')::uuid END,n::text,'shopify',CASE WHEN n in(2,3) THEN 'duplicate' ELSE n::text END,CASE WHEN n%4=0 THEN 'shipped' ELSE 'unfulfilled' END,'2026-10-01'::timestamptz+n*interval '1 hour',
 CASE WHEN n%3=0 THEN '{"country_code":"ES","address_line_1":"PRIVATE"}'::jsonb ELSE '{}'::jsonb END,
 CASE WHEN n%2=0 THEN '[{"quantity":2,"title":"PRIVATE","unit_price":3}]'::jsonb ELSE '[]'::jsonb END,
 CASE WHEN n%5=0 THEN '{"shipping_details":{"measurement":{"weight":{"value":"invalid","unit":"kg"}}}}'::jsonb WHEN n%3=0 THEN '{"shipping_details":{"measurement":{"weight":{"value":2,"unit":"kg"}}},"_zenvia_tracking":{"state":"transit"}}'::jsonb ELSE '{}'::jsonb END,
 CASE WHEN n%2=0 THEN '' ELSE 'PRIVATE' END,'',CASE WHEN n%2=0 THEN '' ELSE 'EUR' END,CASE WHEN n in(3,7) THEN now() END,n FROM generate_series(1,25)n;`);
 for(const f of ['20261019143018_orders_dashboard_tariff_kpi_parity.sql','20261020072636_pickup_reports.sql','20261020095712_pickup_dashboard_membership.sql','20261020102813_pickup_report_sort.sql'])await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`UPDATE fulfillment_orders SET items='{}',pii_purged_at=now() WHERE sendcloud_id='7'`);
 const cases=["p_state=>'all',p_page_size=>100","p_state=>'pending'","p_tracking=>'issue'","p_query=>'PRIVATE'","p_state=>'all',p_page=>1,p_page_size=>3","p_state=>'all',p_sort_key=>'weight'","p_selection_ids_only=>true","p_country=>'ES'","p_from=>'2026-10-01',p_to=>'2026-10-01'"];
 const snapshot=async()=>{const results=[];await db.exec('SET ROLE authenticated');for(const fn of ['orders_dashboard_page_v1','orders_dashboard_pickup_v1'])for(const args of cases)results.push((await db.query<any>(`SELECT public.${fn}(${args}) data`)).rows[0].data);await db.exec('RESET ROLE');return results;};
 const before=await snapshot();
 await db.exec(readFileSync('supabase/migrations/20261022064741_orders_singleton_merge_fast_path.sql','utf8'));
 expect(await snapshot()).toEqual(before);
 const source=(await db.query<any>(`select prosrc from pg_proc where oid='public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure`)).rows[0].prosrc;
 expect(source).toContain('singleton_count');
 const pageSignature='public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])';
 const pickupSignature='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)';
 for(const [signature,name] of [[pageSignature,'public.orders_reference_page'],[pickupSignature,'public.orders_reference_pickup']]){
  const def=(await db.query<any>(`select pg_get_functiondef($1::regprocedure) def`,[signature])).rows[0].def;
  await db.exec(def.replace(/FUNCTION (public.orders_dashboard_page_v1|private.mfa_impl_orders_dashboard_pickup_v1)\(/,`FUNCTION ${name}(`));
 }
 // Stub only the scheduler API, so registration is verified without a real daemon.
 await db.exec(`CREATE SCHEMA cron;CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY,jobname text,schedule text,command text);
 CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid$$;`);
 await db.exec(readFileSync('supabase/migrations/20261022065250_orders_incremental_classified_projection.sql','utf8'));
 const job=(await db.query<any>(`SELECT * FROM cron.job`)).rows[0];expect(job.jobname).toBe('orders-dashboard-projection');expect(job.schedule).toBe('* * * * *');
 expect(job.command).toContain('orders_dashboard_projection_cleanup(100); COMMIT; BEGIN;');expect(job.command).toContain('orders_dashboard_projection_reconcile(100)');
 expect((await db.query<any>(`select prosrc from pg_proc where oid='public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure`)).rows[0].prosrc).toBe(source);
 await db.exec(readFileSync('supabase/migrations/20261022070148_orders_incremental_projection_activate.sql','utf8'));
 expect(await snapshot()).toEqual(before);
 // A projection write failure must not roll back a real business UPDATE.
 await db.exec(`CREATE FUNCTION private.force_projection_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'forced projection failure';END$$;
 CREATE TRIGGER force_projection_failure BEFORE INSERT OR UPDATE ON private.orders_dashboard_projection FOR EACH ROW EXECUTE FUNCTION private.force_projection_failure();
 SET ROLE authenticated;UPDATE fulfillment_orders SET source_status='shipped' WHERE sendcloud_id='1';RESET ROLE;`);
 expect((await db.query<any>(`SELECT source_status FROM fulfillment_orders WHERE sendcloud_id='1'`)).rows[0].source_status).toBe('shipped');
 expect(Number((await db.query<any>(`SELECT count(*) n FROM private.orders_projection_dirty`)).rows[0].n)).toBeGreaterThan(0);
 await db.exec(`SELECT private.orders_dashboard_projection_reconcile(1)`);
 expect(Number((await db.query<any>(`SELECT count(*) n FROM private.orders_projection_failures`)).rows[0].n)).toBe(1);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(false);
 const fallback=(await db.query<any>(`SELECT orders_dashboard_pickup_v1(p_state=>'all') actual,orders_reference_pickup(p_state=>'all') reference`)).rows[0];
 expect(fallback.actual).toEqual(fallback.reference);
 await db.exec(`DROP TRIGGER force_projection_failure ON private.orders_dashboard_projection;SELECT private.orders_dashboard_projection_reconcile(100);`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 expect((await db.query<any>(`SELECT count(*)::int n FROM private.orders_projection_dirty`)).rows[0].n).toBe(0);
 // Storage cleanup remains active even when both operational switches are off.
 await db.exec(`UPDATE private.orders_projection_control SET maintenance_enabled=false,read_enabled=false;
 UPDATE fulfillment_orders SET pii_purged_at=now(),customer_name=NULL WHERE sendcloud_id='1';
 SELECT private.orders_dashboard_projection_cleanup(1);`);
 expect((await db.query<any>(`SELECT count(*)::int n FROM private.orders_dashboard_projection WHERE projection_group_key='shopify:1'`)).rows[0].n).toBe(0);
 await db.exec(`UPDATE private.orders_projection_control SET maintenance_enabled=true,read_enabled=true;SELECT private.orders_dashboard_projection_reconcile(100)`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 // A deleted duplicate member must be physically evicted even if its group survives.
 await db.exec(`CREATE TEMP TABLE saved_duplicate AS SELECT * FROM fulfillment_orders WHERE sendcloud_id='2';
 UPDATE private.orders_projection_control SET maintenance_enabled=false;DELETE FROM fulfillment_orders WHERE sendcloud_id='2';
 SELECT private.orders_dashboard_projection_cleanup(100);`);
 expect((await db.query<any>(`SELECT count(*)::int n FROM private.orders_dashboard_projection WHERE projection_group_key='shopify:duplicate'`)).rows[0].n).toBe(0);
 await db.exec(`UPDATE private.orders_projection_control SET maintenance_enabled=true;INSERT INTO fulfillment_orders SELECT * FROM saved_duplicate;DROP TABLE saved_duplicate;SELECT private.orders_dashboard_projection_reconcile(100)`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 // Missing/extra projection rows cannot be mistaken for a complete cache.
 await db.exec(`DELETE FROM private.orders_dashboard_projection WHERE projection_group_key='shopify:1'`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(false);
 await db.exec(`SELECT private.orders_dashboard_projection_repair_enqueue(current_setting('test.owner')::uuid,1);SELECT private.orders_dashboard_projection_reconcile(1)`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 await db.exec(`INSERT INTO private.orders_dashboard_projection SELECT (jsonb_populate_record(NULL::private.orders_dashboard_projection,to_jsonb(p)||'{"projection_group_key":"unexpected"}'::jsonb)).* FROM private.orders_dashboard_projection p LIMIT 1`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(false);
 await db.exec(`SELECT private.orders_dashboard_projection_repair_enqueue(current_setting('test.owner')::uuid,1);SELECT private.orders_dashboard_projection_reconcile(1)`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 // Even queue AND failure-ledger failures do not abort business DML or expose stale PII.
 await db.exec(`CREATE TRIGGER fail_queue BEFORE INSERT ON private.orders_projection_dirty FOR EACH ROW EXECUTE FUNCTION private.force_projection_failure();
 CREATE TRIGGER fail_ledger BEFORE INSERT ON private.orders_projection_failures FOR EACH ROW EXECUTE FUNCTION private.force_projection_failure();
 SET ROLE authenticated;UPDATE fulfillment_orders SET pii_purged_at=now(),customer_name=NULL WHERE sendcloud_id='1';RESET ROLE;`);
 expect((await db.query<any>(`SELECT pii_purged_at IS NOT NULL purged FROM fulfillment_orders WHERE sendcloud_id='1'`)).rows[0].purged).toBe(true);
 expect((await db.query<any>(`SELECT count(*)::int n FROM private.orders_projection_dirty`)).rows[0].n).toBe(0);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(false);
 await db.exec(`SET ROLE authenticated`);
 expect((await db.query<any>(`SELECT count(*)::int n FROM private.orders_dashboard_projection`)).rows[0].n).toBe(0);
 const loggingFailure=(await db.query<any>(`SELECT orders_dashboard_pickup_v1(p_state=>'all') actual,orders_reference_pickup(p_state=>'all') reference`)).rows[0];expect(loggingFailure.actual).toEqual(loggingFailure.reference);
 await db.exec(`RESET ROLE;DROP TRIGGER fail_queue ON private.orders_projection_dirty;DROP TRIGGER fail_ledger ON private.orders_projection_failures;
 SELECT private.orders_dashboard_projection_repair_enqueue(current_setting('test.owner')::uuid,1);SELECT private.orders_dashboard_projection_reconcile(1)`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 await expect(db.query(`SELECT private.orders_dashboard_projection_reconcile(1001)`)).rejects.toThrow('INVALID_PROJECTION_BATCH_LIMIT');
 // xmin alone is insufficient: a second UPDATE in the same transaction has a new ctid.
 await db.exec(`BEGIN;UPDATE fulfillment_orders SET total_amount=total_amount+1 WHERE sendcloud_id='1';SELECT private.orders_dashboard_projection_reconcile(100);
 CREATE TRIGGER fail_queue BEFORE INSERT ON private.orders_projection_dirty FOR EACH ROW EXECUTE FUNCTION private.force_projection_failure();
 UPDATE fulfillment_orders SET total_amount=total_amount+1 WHERE sendcloud_id='1';`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(false);
 const sameTransaction=(await db.query<any>(`SELECT orders_dashboard_pickup_v1(p_state=>'all') actual,orders_reference_pickup(p_state=>'all') reference`)).rows[0];expect(sameTransaction.actual).toEqual(sameTransaction.reference);
 await db.exec(`DROP TRIGGER fail_queue ON private.orders_projection_dirty;COMMIT;SELECT private.orders_dashboard_projection_repair_enqueue(current_setting('test.owner')::uuid,100);SELECT private.orders_dashboard_projection_reconcile(100)`);
 // Both switches are immediate operational controls; paused writes force fallback even without a queue entry.
 await db.exec(`UPDATE private.orders_projection_control SET maintenance_enabled=false;UPDATE fulfillment_orders SET source_status='unfulfilled' WHERE sendcloud_id='1';UPDATE private.orders_projection_control SET maintenance_enabled=true;`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(false);
 const paused=(await db.query<any>(`SELECT orders_dashboard_pickup_v1(p_state=>'all') actual,orders_reference_pickup(p_state=>'all') reference`)).rows[0];expect(paused.actual).toEqual(paused.reference);
 await db.exec(`UPDATE private.orders_projection_control SET read_enabled=false`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(false);
 await db.exec(`UPDATE private.orders_projection_control SET read_enabled=true;
 SELECT private.orders_dashboard_projection_repair_enqueue(current_setting('test.owner')::uuid,100);SELECT private.orders_dashboard_projection_reconcile(100)`);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 await db.exec(`UPDATE fulfillment_orders SET source_channel='amazon',source_status='Pending' WHERE sendcloud_id='4';SELECT private.orders_dashboard_projection_reconcile(100)`);
 expect((await db.query<any>(`SELECT has_row FROM private.orders_projection_groups WHERE group_key='amazon:4'`)).rows[0].has_row).toBe(false);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 const excluded=(await db.query<any>(`SELECT orders_dashboard_pickup_v1(p_state=>'all') actual,orders_reference_pickup(p_state=>'all') reference`)).rows[0];expect(excluded.actual).toEqual(excluded.reference);
 await db.exec(`UPDATE fulfillment_orders SET source_status='Unshipped' WHERE sendcloud_id='4';SELECT private.orders_dashboard_projection_reconcile(100)`);
 expect((await db.query<any>(`SELECT has_row FROM private.orders_projection_groups WHERE group_key='amazon:4'`)).rows[0].has_row).toBe(true);
 expect((await db.query<any>(`SELECT private.orders_dashboard_projection_usable() usable`)).rows[0].usable).toBe(true);
 for(const mutation of [
  `UPDATE fulfillment_orders SET items='{}',pii_purged_at=now() WHERE sendcloud_id='5'`,
  `UPDATE fulfillment_orders SET source_channel='amazon',source_status='Unshipped' WHERE sendcloud_id='4'`,
  `UPDATE fulfillment_orders SET source_status='Pending' WHERE sendcloud_id='4'`,
  `UPDATE fulfillment_orders SET source_status='Unshipped' WHERE sendcloud_id='4'`,
  `UPDATE fulfillment_orders SET order_number='changed-group',source_status='shipped' WHERE sendcloud_id='2'`,
  `UPDATE fulfillment_orders SET pii_purged_at=now() WHERE sendcloud_id='1'`,
  `DELETE FROM fulfillment_orders WHERE sendcloud_id='3'`,
  `INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,source_channel,source_status,order_created_at) VALUES(md5('new')::uuid,current_setting('test.owner')::uuid,'new','manual','pending',now())`,
 ]){
  await db.exec('SET ROLE authenticated');
  await db.exec(mutation);
  for(const [actual,reference] of [['orders_dashboard_page_v1','orders_reference_page'],['orders_dashboard_pickup_v1','orders_reference_pickup']])for(const args of cases){
   const r=(await db.query<any>(`SELECT ${actual}(${args}) actual,${reference}(${args}) reference`)).rows[0];expect(r.actual).toEqual(r.reference);
  }
  await db.exec('RESET ROLE');
 }
 expect((await db.query<any>('select wrapper_hash=md5(pg_get_functiondef(function_oid)) valid from private.mfa_function_manifest')).rows.every((r:any)=>r.valid)).toBe(true);
 await db.exec(`SET ROLE authenticated;SET test.mfa='no';`);await expect(db.query(`select orders_dashboard_pickup_v1()`)).rejects.toThrow('MFA_REQUIRED');
 await db.exec(`SET test.mfa='yes';SET test.owner='00000000-0000-4000-8000-000000000002';`);expect((await db.query<any>(`select orders_dashboard_pickup_v1(p_state=>'all') data`)).rows[0].data.total).toBe(1);
 await db.exec('RESET ROLE');await db.exec(readFileSync('supabase/rollback/20261022_orders_incremental_classified_projection.sql','utf8'));await db.exec(readFileSync('supabase/rollback/20261022_orders_singleton_merge_fast_path.sql','utf8'));
 }finally{await db.close()}
},30000);
