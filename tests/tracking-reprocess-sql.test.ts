import {it,expect} from 'vitest';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(p,'utf8');
it('reprocess SQL is read-only on preview and revalidates an approved bounded set without mutating orders or terminals',async()=>{const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;grant usage on schema private to service_role;create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);create table workspaces(id uuid primary key,status text);`+read('tests/fixtures/orders-table-schema.sql')+`alter table fulfillment_orders add primary key(id);`);
 for(const file of ['20261022053808_shipment_tracking_shadow.sql','20261022055814_shipment_tracking_terminal_guards.sql','20261022060055_shipment_tracking_provider_event_time.sql','20261022060645_shipment_tracking_privacy.sql'])await db.exec(read('supabase/migrations/'+file));
 await db.exec(`grant select on fulfillment_orders,integration_accounts,workspaces to service_role;insert into workspaces values('11111111-1111-1111-1111-111111111111','active');insert into integration_accounts values('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','sendcloud',true,'active');insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,sendcloud_id,source_status,tracking_number,shipping_provider,sendcloud_parcel_id,label_created_at,order_created_at,tracking_status_code,items,shipping_address,raw_payload) select md5(n::text)::uuid,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',n::text,'SHIPPED','T'||n,'sendcloud',n,now(),now(),'SHIPPED','[]','{}','{}' from generate_series(1,40)n;select tracking_seed_shadow();update shipment_tracking_state set normalized_state='exception',next_poll_at=now()+interval '2 hours';`);
 const before=(await db.query<any>('select md5(jsonb_agg(to_jsonb(s) order by order_id)::text) hash from shipment_tracking_state s')).rows[0].hash;
 const migration=read('supabase/migrations/20261022095046_shipment_tracking_reprocess.sql');
 expect(migration).toMatch(/set lock_timeout\s*=\s*'25ms'/i);expect(migration).toMatch(/exception when lock_not_available/i);expect(migration).toMatch(/limit 1001/i);
 await db.exec(migration);
 expect((await db.query<any>('select md5(jsonb_agg(to_jsonb(s) order by order_id)::text) hash from shipment_tracking_state s')).rows[0].hash).toBe(before);
 const orders=(await db.query<any>('select md5(jsonb_agg(to_jsonb(o) order by id)::text) hash from fulfillment_orders o')).rows[0].hash;
 const candidates=(await db.query<any>('select * from tracking_reprocess_candidates()')).rows;expect(candidates).toHaveLength(40);
 expect((await db.query<any>('select md5(jsonb_agg(to_jsonb(s) order by order_id)::text) hash from shipment_tracking_state s')).rows[0].hash).toBe(before);
 const approved=candidates.map(r=>({order_id:r.order_id,version:r.version}));
 await db.exec(`update shipment_tracking_state set normalized_state='delivered' where order_id='${approved[0].order_id}';update fulfillment_orders set tracking_number='changed' where id='${approved[1].order_id}';update shipment_tracking_state set raw_code='changed' where order_id='${approved[2].order_id}';`);
 expect((await db.query<any>('select tracking_reprocess_enqueue($1::jsonb,99) n',[JSON.stringify(approved)])).rows[0].n).toBe(22);
 // Only the first 25 approved entries can be considered; unsafe entries are never replaced by later entries.
 expect((await db.query<any>('select count(*)::int n from shipment_tracking_state where next_poll_at<=now()')).rows[0].n).toBe(22);
 expect((await db.query<any>(`select next_poll_at>now() intact from shipment_tracking_state where order_id='${approved[0].order_id}'`)).rows[0].intact).toBe(true);
 expect((await db.query<any>('select tracking_reprocess_enqueue($1::jsonb,25) n',[JSON.stringify(approved)])).rows[0].n).toBe(0);
 // Current eligibility is checked again for every changing order/account/workspace field.
 const target=approved[30].order_id;
 for(const [change,restore] of [
  [`update fulfillment_orders set pii_purged_at=now() where id='${target}'`,``],
 ]){ // Purging removes state via the established lifecycle trigger.
  await db.exec(change);expect((await db.query<any>('select * from tracking_reprocess_candidates()')).rows.some(r=>r.order_id===target)).toBe(false);
 }
 const remaining=approved[31].order_id;
 for(const [change,restore] of [
  [`update fulfillment_orders set label_cancelled_at=now() where id='${remaining}'`,`update fulfillment_orders set label_cancelled_at=null where id='${remaining}'`],
  [`update fulfillment_orders set tracking_status_code='DELIVERED' where id='${remaining}'`,`update fulfillment_orders set tracking_status_code='SHIPPED' where id='${remaining}'`],
  [`update integration_accounts set enabled=false`,`update integration_accounts set enabled=true`],
  [`update integration_accounts set status='disabled'`,`update integration_accounts set status='active'`],
  [`update integration_accounts set owner_id='33333333-3333-3333-3333-333333333333'`,`update integration_accounts set owner_id='11111111-1111-1111-1111-111111111111'`],
  [`update integration_accounts set provider='envia'`,`update integration_accounts set provider='sendcloud'`],
  [`update workspaces set status='disabled'`,`update workspaces set status='active'`],
 ]){
  await db.exec(change);expect((await db.query<any>('select * from tracking_reprocess_candidates()')).rows.some(r=>r.order_id===remaining)).toBe(false);
  expect((await db.query<any>('select tracking_reprocess_enqueue($1::jsonb,25) n',[JSON.stringify([approved[31]])])).rows[0].n).toBe(0);await db.exec(restore);
 }
 // Account pauses, row leases and failure backoff cannot be bypassed by approval.
 for(const [change,restore] of [
  [`update shipment_tracking_state set lease_until=now()+interval '1 hour' where order_id='${remaining}'`,`update shipment_tracking_state set lease_until=null where order_id='${remaining}'`],
  [`update shipment_tracking_state set failures=1,next_poll_at=now()+interval '1 hour' where order_id='${remaining}'`,`update shipment_tracking_state set failures=0 where order_id='${remaining}'`],
  [`insert into shipment_tracking_account_health(account_id,owner_id,provider,paused_until) values('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','sendcloud',now()+interval '1 hour')`,`delete from shipment_tracking_account_health`],
 ]){
  await db.exec(change);const fresh=(await db.query<any>('select * from tracking_reprocess_candidates()')).rows.find(r=>r.order_id===remaining);
  expect((await db.query<any>('select tracking_reprocess_enqueue($1::jsonb,25) n',[JSON.stringify([{order_id:fresh.order_id,version:fresh.version}])])).rows[0].n).toBe(0);await db.exec(restore);
 }
 // Restore the intentional PII test edits solely for order snapshot comparison.
 await db.exec(`update fulfillment_orders set pii_purged_at=null where id='${target}'`);
 await db.exec(`set role authenticated`);await expect(db.query('select * from tracking_reprocess_candidates()')).rejects.toThrow('permission denied');await expect(db.query("select tracking_reprocess_enqueue('[]',25)")).rejects.toThrow('permission denied');await db.exec('reset role');
 // Restore intentional identity edit to compare all order data; apply never changes any order.
 await db.exec(`update fulfillment_orders set tracking_number='T'||sendcloud_id where id='${approved[1].order_id}'`);
 expect((await db.query<any>('select md5(jsonb_agg(to_jsonb(o) order by id)::text) hash from fulfillment_orders o')).rows[0].hash).toBe(orders);
expect((await db.query<any>("select proconfig from pg_proc where proname='tracking_reprocess_enqueue'")).rows[0].proconfig).toContain('lock_timeout=25ms');
 // The service-only read RPC returns at most 1001, reserving the last as sentinel.
 await db.exec(`insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,sendcloud_id,source_status,tracking_number,shipping_provider,sendcloud_parcel_id,label_created_at,order_created_at,tracking_status_code,items,shipping_address,raw_payload) select md5(n::text)::uuid,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',n::text,'SHIPPED','T'||n,'sendcloud',n,now(),now(),'SHIPPED','[]','{}','{}' from generate_series(41,1042)n;select tracking_seed_shadow();`);
 expect((await db.query<any>('select * from tracking_reprocess_candidates()')).rows).toHaveLength(1001);
 const envelope=(await db.query<any>('select tracking_reprocess_preview_candidates() data')).rows[0].data;
 expect(envelope.rows).toHaveLength(1000);expect(envelope.truncated).toBe(true);
 await db.exec('set role authenticated');await expect(db.query('select tracking_reprocess_preview_candidates()')).rejects.toThrow('permission denied');await db.exec('reset role');
}finally{await db.close()}},20000);
