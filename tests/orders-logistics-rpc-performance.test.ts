// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {verificationFixture} from './helpers/pickupVerificationFixture';
const patch='supabase/migrations/20261023185119_orders_299_approved_cache_backfill.sql';
const summaryPatch='supabase/migrations/20261023214651_orders_operational_summary_mfa.sql';
const readBasePatch=()=>readFileSync(patch,'utf8')+readFileSync(summaryPatch,'utf8');
const readPatch=()=>readBasePatch()+readFileSync('docs/deploy/20261024-orders-purge-logistics/definitions.sql','utf8');
it('installs on a fresh schema without the optional production projection cache',async()=>{
 const{db}=await verificationFixture('legacy');try{
 await db.exec("set zenvia.logistics_release_bundle='atomic'");await db.exec(readFileSync('supabase/migrations/20261023103551_internal_logistics_state.sql','utf8'));
 expect((await db.query<any>("select to_regprocedure('private.orders_projection_stale_keys()') absent")).rows[0].absent).toBeNull();
 await db.exec(readFileSync('supabase/migrations/20261024064200_orders_purge_logistics_retention.sql','utf8'));
 await db.exec("update fulfillment_orders set order_created_at='2026-08-01',label_created_at='2026-09-05',fulfilled_at=null,tracking_updated_at=null,shipping_cost_recorded_at=null,shipping_cost_amount=12.10,shipping_cost_currency='EUR' where order_number='DEMO-1'");
 const costs=[];for(const rpc of ['orders_workbench_v1','orders_dashboard_pickup_v1'])costs.push((await db.query<any>(`select ${rpc}(p_from=>'2026-09-01',p_to=>'2026-09-30',p_state=>'all') v`)).rows[0].v.kpis.transport);
 expect(costs[0].shipments).toBe(1);expect(costs[0].total).toBe(12.10);
 await db.exec("update fulfillment_orders set source_status='Shipped',pii_purged_at=now(),label_created_at=null,tracking_number=null,shipping_remote_id=null where order_number='DEMO-1'");
 for(const [i,rpc] of ['orders_workbench_v1','orders_dashboard_pickup_v1'].entries())expect((await db.query<any>(`select ${rpc}(p_from=>'2026-09-01',p_to=>'2026-09-30',p_state=>'all') v`)).rows[0].v.kpis.transport).toEqual(costs[i]);
 expect((await db.query<any>("select private.order_logistics_state(to_jsonb(o)) s from fulfillment_orders o where order_number='DEMO-1'")).rows[0].s).toBe('shipped');
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'pending') v")).rows[0].v.rows.some((r:any)=>r.order_number==='DEMO-1')).toBe(false);
 }finally{await db.close()}
},30000);
it('repairs existing purged rows without touching pickup documents and preserves cancellation and true pending',async()=>{
 const{db}=await fixture();try{
 await db.exec(readBasePatch());await db.exec(readFileSync('supabase/migrations/20261016185733_amazon_buyer_pii_guard.sql','utf8'));
 await db.exec(JSON.parse(readFileSync('docs/deploy/20261024-orders-purge-logistics/before-functions.json','utf8')).find((f:any)=>f.signature==='private.mfa_impl_order_logistics_read(uuid[])').definition);
 await db.exec("update fulfillment_orders set source_channel='amazon',order_number='403-3333333-4444444',source_status='Shipped',fulfilled_at='2026-08-25',tracking_status_code='DELIVERED',shipping_provider='sendcloud' where order_number='DEMO-1'");
 await db.exec("select private.orders_dashboard_projection_refresh('00000000-0000-4000-8000-000000000001','shopify:DEMO-1');select private.orders_dashboard_projection_refresh('00000000-0000-4000-8000-000000000001','amazon:403-3333333-4444444')");
 const docs=(await db.query<any>('select to_jsonb(r) v from pickup_reports r order by id')).rows;
 const members=(await db.query<any>('select to_jsonb(r) v from pickup_report_items r order by order_id')).rows;
 await db.exec("update fulfillment_orders set pii_purged_at=now(),tracking_number=null,label_created_at=null,shipping_remote_id=null where order_number='403-3333333-4444444'");
 expect((await db.query<any>("select private.order_logistics_state(to_jsonb(o)) s from fulfillment_orders o where order_number='403-3333333-4444444'")).rows[0].s).toBe('pending');
 await db.exec(readFileSync('docs/deploy/20261024-orders-purge-logistics/definitions.sql','utf8'));
 await expect(db.exec('BEGIN;'+readFileSync('docs/deploy/20261024-orders-purge-logistics/repair.sql','utf8')+'COMMIT;')).rejects.toThrow('RETENTION_RECOUNT_REQUIRED');await db.exec('ROLLBACK');
 await db.exec('select private.order_logistics_store_retention(to_jsonb(o)) from fulfillment_orders o where pii_purged_at is not null');
 await db.exec('select private.orders_dashboard_projection_reconcile(100)');
 await db.exec("select private.orders_dashboard_projection_refresh('00000000-0000-4000-8000-000000000001','amazon:403-3333333-4444444')");
 const repaired=(await db.query<any>("select order_state,dispatched_day from private.orders_dashboard_projection where order_number='403-3333333-4444444'")).rows[0];expect(repaired.order_state).toBe('shipped');expect(repaired.dispatched_day).not.toBeNull();
 expect((await db.query<any>('select to_jsonb(r) v from pickup_reports r order by id')).rows).toEqual(docs);
 expect((await db.query<any>('select to_jsonb(r) v from pickup_report_items r order by order_id')).rows).toEqual(members);
 await db.exec("update fulfillment_orders set source_status='Cancelled',fulfilled_at='2026-08-25',label_created_at=null,sendcloud_parcel_id=null,shipping_remote_id=null,pii_purged_at=now() where order_number='DEMO-2'");
 expect((await db.query<any>("select private.order_logistics_state(to_jsonb(o)) s from fulfillment_orders o where order_number='DEMO-2'")).rows[0].s).toBe('cancelled');
 expect((await db.query<any>("select dispatched_at from private.order_logistics_retention r join fulfillment_orders o on o.id=r.order_id where o.order_number='DEMO-2'")).rows[0].dispatched_at).toBeNull();
 await db.exec("update fulfillment_orders set source_status='Unshipped',fulfilled_at=null,label_created_at=null,sendcloud_parcel_id=null,shipping_remote_id=null,tracking_status_code=null where order_number='DEMO-3'");
 expect((await db.query<any>("select private.order_logistics_state(to_jsonb(o)) s from fulfillment_orders o where order_number='DEMO-3'")).rows[0].s).toBe('pending');
 await db.exec("update fulfillment_orders set label_created_at=now(),tracking_number='MUST-BE-ERASED',shipping_remote_id='MUST-BE-ERASED' where order_number='403-3333333-4444444'");
 await db.exec('select private.orders_dashboard_projection_reconcile(100)');
 expect((await db.query<any>("select order_state,dispatched_day from private.orders_dashboard_projection where order_number='403-3333333-4444444'")).rows[0]).toEqual(repaired);
 expect((await db.query<any>("select tracking_number,shipping_remote_id from fulfillment_orders where order_number='403-3333333-4444444'")).rows[0]).toEqual({tracking_number:null,shipping_remote_id:null});
 expect((await db.query<any>("select has_table_privilege('authenticated','private.order_logistics_retention','SELECT') allowed")).rows[0].allowed).toBe(false);
 expect((await db.query<any>("select has_function_privilege('authenticated','private.order_logistics_store_retention(jsonb)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
 }finally{await db.close()}
},30000);
it('keeps a purged fulfilled Amazon order shipped across projection, RPCs and later updates',async()=>{
 const{db}=await fixture();try{
 await db.exec(readBasePatch());
 await db.exec(readFileSync('supabase/migrations/20261016185733_amazon_buyer_pii_guard.sql','utf8'));
 await db.exec(JSON.parse(readFileSync('docs/deploy/20261024-orders-purge-logistics/before-functions.json','utf8')).find((f:any)=>f.signature==='private.mfa_impl_order_logistics_read(uuid[])').definition);
 await db.exec(readFileSync('docs/deploy/20261024-orders-purge-logistics/definitions.sql','utf8'));
 await db.exec("update fulfillment_orders set source_channel='amazon',order_number='403-1111111-2222222',source_status='Shipped',fulfilled_at='2026-08-25T06:54:00Z',tracking_status_code='DELIVERED',tracking_updated_at='2026-08-28T12:00:00Z',shipping_provider='sendcloud',shipping_cost_amount=12.10,shipping_cost_currency='EUR' where order_number='DEMO-1'");
 const old=(await db.query<any>("select orders_dashboard_pickup_v1(p_state=>'all') v")).rows[0].v;
 const row=(await db.query<any>("select id from fulfillment_orders where order_number='403-1111111-2222222'")).rows[0];
 await db.exec(JSON.parse(readFileSync('docs/deploy/20261024-orders-purge-logistics/before-functions.json','utf8')).find((f:any)=>f.signature==='private.shipment_tracking_purge_order()').definition);
 await db.exec("create trigger test_privacy_tracking_cleanup after update of pii_purged_at on fulfillment_orders for each row execute function private.shipment_tracking_purge_order()");
 await db.exec("insert into shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key,normalized_state,event_at,movement_at) select id,owner_id,'10000000-0000-4000-8000-000000000055','sendcloud',tracking_number,private.shipment_tracking_identity(o),'delivered','2026-08-28','2026-08-26' from fulfillment_orders o where order_number='403-1111111-2222222'");
 expect((await db.query<any>('select count(*) n from shipment_tracking_state where order_id=$1',[row.id])).rows[0].n).toBe(1);
 await db.exec("update fulfillment_orders set pii_purged_at=now(),label_created_at=null,tracking_number=null,shipping_remote_id=null where order_number='403-1111111-2222222'");
 expect((await db.query<any>('select count(*) n from shipment_tracking_state where order_id=$1',[row.id])).rows[0].n).toBe(0);
 expect((await db.query<any>("select private.order_logistics_state(to_jsonb(o)) state from fulfillment_orders o where id=$1",[row.id])).rows[0].state).toBe('shipped');
 await db.exec('select private.orders_dashboard_projection_reconcile(100)');
 const projected=(await db.query<any>("select order_state,dispatched_day from private.orders_dashboard_projection where id=$1",[row.id])).rows[0];expect(projected.order_state).toBe('shipped');expect(projected.dispatched_day).not.toBeNull();
 const meta=(await db.query<any>('select order_logistics_read($1) v',[[row.id]])).rows[0].v[0];expect(meta.logistics_state).toBe('shipped');expect(meta.logistics.historical).toBe(true);
 for(const rpc of ['orders_workbench_v1','orders_dashboard_pickup_v1']){
  const pending=(await db.query<any>(`select ${rpc}(p_state=>'pending') v`)).rows[0].v;expect(pending.rows.some((r:any)=>r.id===row.id)).toBe(false);
  const shipped=(await db.query<any>(`select ${rpc}(p_state=>'shipped') v`)).rows[0].v;const r=shipped.rows.find((r:any)=>r.id===row.id);expect(r).toBeDefined();expect(r.logistics.historical).toBe(true);expect(r.customer_name).toBeNull();expect(r.tracking_number).toBeNull();
 }
 const next=(await db.query<any>("select orders_dashboard_pickup_v1(p_state=>'all') v")).rows[0].v;
 expect(next.kpis.transport.total).toBe(old.kpis.transport.total);expect(next.kpis.transport.shipments).toBe(old.kpis.transport.shipments);expect(next.kpis.transport.mrw).toBe(old.kpis.transport.mrw);
 expect((await db.query<any>('select count(*) n from private.orders_projection_stale_keys()')).rows[0].n).toBe(0);
 await db.exec("update fulfillment_orders set fulfilled_at=null,source_status='Unshipped',tracking_status_code=null where id='"+row.id+"'");
 await db.exec('select private.orders_dashboard_projection_reconcile(100)');
 expect((await db.query<any>("select order_state,dispatched_day from private.orders_dashboard_projection where id=$1",[row.id])).rows[0]).toEqual(projected);
 }finally{await db.close()}
},30000);
it('restores the exact production functions with emergency rollback without restoring erased PII',async()=>{
 const{db}=await fixture();try{
 await db.exec(readBasePatch());
 const originals=[...JSON.parse(readFileSync('docs/deploy/20261024-orders-purge-logistics/before-functions.json','utf8')),...JSON.parse(readFileSync('docs/deploy/20261024-orders-purge-logistics/before-fallback.json','utf8'))].filter((f:any)=>['private.order_logistics_evidence(','private.order_logistics_state(','private.mfa_impl_order_logistics_read(','private.orders_projection_stale_keys(','private.orders_dashboard_projection_refresh(','private.orders_classified_fallback(','private.mfa_impl_orders_workbench_v1(','private.mfa_impl_orders_dashboard_pickup_v1('].some(n=>f.signature.startsWith(n)));
 for(const f of originals)await db.exec(f.definition);
 const signatures=originals.map((f:any)=>f.signature);
 const hashes=()=>db.query<any>("select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) hash from pg_proc where oid=any(select unnest($1::text[])::regprocedure) order by 1",[signatures]);
 const before=(await hashes()).rows;
 await db.exec(readFileSync('docs/deploy/20261024-orders-purge-logistics/definitions.sql','utf8'));
 await db.exec("update fulfillment_orders set pii_purged_at=now(),tracking_number=null,label_created_at=null,shipping_remote_id=null where order_number='DEMO-1'");
 expect((await db.query<any>('select count(*) n from private.order_logistics_retention')).rows[0].n).toBe(1);
 await db.exec(readFileSync('docs/deploy/20261024-orders-purge-logistics/rollback.sql','utf8'));
 expect((await hashes()).rows).toEqual(before);
 expect((await db.query<any>('select count(*) n from private.order_logistics_retention')).rows[0].n).toBe(1);
 expect((await db.query<any>("select count(*) n from pg_trigger where tgname='zzzzb_order_logistics_retention'")).rows[0].n).toBe(0);
 expect((await db.query<any>("select tracking_number,shipping_remote_id from fulfillment_orders where order_number='DEMO-1'")).rows[0]).toEqual({tracking_number:null,shipping_remote_id:null});
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'all') v")).rows[0].v.total).toBe(3);
 }finally{await db.close()}
},30000);
it('upgrades the emergency projected state/date read without reverting it or failing the source guard',async()=>{
 const {db}=await fixture();try{
 const expected=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 for(const name of ['mfa_impl_orders_workbench_v1','mfa_impl_orders_dashboard_pickup_v1']){
  const src=(await db.query<any>(`select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=$1`,[name])).rows[0].definition;
  await db.exec(src.replace('private.order_logistics_state(to_jsonb(p)) AS order_state','p.order_state').replace("(coalesce(nullif(private.order_logistics_evidence(to_jsonb(p))->>'dispatchedAt',''),nullif(private.order_logistics_evidence(to_jsonb(p))->>'historicalDate',''))::timestamptz AT TIME ZONE 'Europe/Madrid')::date AS dispatched_day",'p.dispatched_day'));
 }
 await db.exec(readPatch());
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value).toEqual(expected);
 }finally{await db.close()}
},20000);

it('returns aggregate operational totals across periods without downloading any order metadata',async()=>{
 const{db}=await fixture();try{
 await db.exec(readPatch());
 const manifest=(await db.query<any>("select m.signature,m.wrapper_hash=md5(pg_get_functiondef(m.function_oid)) valid,m.implementation::text implementation from private.mfa_function_manifest m where m.function_oid='public.orders_operational_summary_v1(date,date)'::regprocedure")).rows;
 expect(manifest).toHaveLength(1);expect(manifest[0].valid).toBe(true);expect(manifest[0].implementation).toBe('private.mfa_impl_orders_operational_summary_v1(date,date)');
 expect((await db.query<any>("select has_function_privilege('anon','public.orders_operational_summary_v1(date,date)','execute') anon,has_function_privilege('authenticated','private.mfa_impl_orders_operational_summary_v1(date,date)','execute') impl")).rows[0]).toEqual({anon:false,impl:false});
 const data=(await db.query<any>("select orders_operational_summary_v1() value")).rows[0].value;
 expect(data).toEqual({orders:3,pending:0,shipped:0,cancelled:0,amazon:0,shopify:3});
 const empty=(await db.query<any>("select orders_operational_summary_v1('2000-01-01','2000-12-31') value")).rows[0].value;
 expect(empty).toEqual({...data,orders:0,shopify:0});
 await db.exec("select order_logistics_mark_sent(jsonb_build_array(jsonb_build_object('id',o.id,'identity',private.shipment_tracking_identity(o)))) from fulfillment_orders o where order_number='DEMO-1'");
 const dispatched=(await db.query<any>('select orders_operational_summary_v1() value')).rows[0].value;
 expect(dispatched.shipped).toBe(1);expect(dispatched.orders).toBe(3);
 await db.exec(readFileSync('supabase/rollback/20261023_orders_cached_logistics_read.sql','utf8'));
 expect((await db.query<any>('select orders_operational_summary_v1() value')).rows[0].value).toEqual(dispatched);
 await db.exec("set test.owner='00000000-0000-4000-8000-000000000002'");
 expect((await db.query<any>('select orders_operational_summary_v1() value')).rows[0].value.orders).toBe(0);
 await db.exec("set test.mfa='no'");await expect(db.exec('select orders_operational_summary_v1()')).rejects.toThrow('MFA_REQUIRED');
 }finally{await db.close()}
},20000);
async function fixture(){
 const f=await verificationFixture('active');await f.db.exec(readFileSync('tests/fixtures/logistics-production-generation.sql','utf8'));
 for(const r of JSON.parse(readFileSync('supabase/snapshots/20261023-internal-logistics-rollback-functions.json','utf8')))await f.db.exec(r.definition);
 await f.db.exec("set zenvia.logistics_release_bundle='atomic'");await f.db.exec(readFileSync('supabase/migrations/20261023103551_internal_logistics_state.sql','utf8'));await f.db.exec(readFileSync('supabase/migrations/20261023131000_logistics_projection_cutover.sql','utf8'));await f.db.exec('select private.orders_dashboard_projection_reconcile(100)');await f.db.exec(JSON.parse(readFileSync('docs/deploy/20261024-orders-purge-logistics/before-functions.json','utf8')).find((x:any)=>x.signature==='private.mfa_impl_order_logistics_read(uuid[])').definition);return f;
}
it.each(['orders_workbench_v1','orders_dashboard_pickup_v1'])('serves valid cached %s without reclassifying every unpaged shipment',async rpc=>{
 const {db}=await fixture();try{
 const baseline=(await db.query<any>(`select ${rpc}(p_state=>'all',p_page_size=>1) value`)).rows[0].value;
 await db.exec(readPatch());
 // Make redundant state classification observable without time-sensitive limits.
 const original=(await db.query<any>("select pg_get_functiondef('private.order_logistics_state(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(original.replace('FUNCTION private.order_logistics_state(','FUNCTION private.test_original_logistics_state('));
 await db.exec(`create or replace function private.order_logistics_state(p_row jsonb) returns text language plpgsql stable security definer set search_path='' as $$begin perform set_config('test.state_calls',(coalesce(nullif(current_setting('test.state_calls',true),''),'0')::int+1)::text,false);return private.test_original_logistics_state(p_row);end$$;`);
 await db.exec("set test.state_calls='0'");
 const actual=(await db.query<any>(`select ${rpc}(p_state=>'all',p_page_size=>1) value`)).rows[0].value;
 expect(actual).toEqual(baseline);
 expect((await db.query<any>("select current_setting('test.state_calls')::int calls")).rows[0].calls).toBeLessThanOrEqual(1);
 }finally{await db.close()}
},20000);
it('preserves complete result parity through pending groups, disabled cache, selection and tracking filters',async()=>{
 const{db}=await fixture();try{
 const options=["p_state=>'all'","p_state=>'labelled',p_query=>'DEMO',p_page_size=>1","p_state=>'shipped',p_from=>'2026-01-01'::date,p_to=>'2026-12-31'::date","p_state=>'issues'","p_state=>'all',p_selection_ids_only=>true","p_state=>'all',p_tracking=>'transit',p_country=>'ES'","p_state=>'all',p_pickup_report=>'in'"];
 const before=[];for(const args of options)before.push((await db.query<any>(`select orders_workbench_v1(${args}) value`)).rows[0].value);
 await db.exec(readPatch());
 for(const condition of ['cached','dirty','disabled']){
 if(condition==='dirty')await db.exec("insert into private.orders_projection_dirty(owner_id,group_key) select owner_id,group_key from private.orders_projection_groups limit 1");
 if(condition==='disabled')await db.exec('update private.orders_projection_control set read_enabled=false where singleton');
 for(let i=0;i<options.length;i++)expect((await db.query<any>(`select orders_workbench_v1(${options[i]}) value`)).rows[0].value).toEqual(before[i]);
 }
 }finally{await db.close()}
},20000);
it('recomputes only a dirty group instead of reclasifying the entire workspace',async()=>{
 const {db}=await fixture();try{
 await db.exec(readPatch());
 const original=(await db.query<any>("select pg_get_functiondef('private.order_logistics_state(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(original.replace('FUNCTION private.order_logistics_state(','FUNCTION private.test_original_logistics_state('));
 await db.exec(`create or replace function private.order_logistics_state(p_row jsonb) returns text language plpgsql stable security definer set search_path='' as $$begin perform set_config('test.state_calls',(coalesce(nullif(current_setting('test.state_calls',true),''),'0')::int+1)::text,false);return private.test_original_logistics_state(p_row);end$$;`);
 await db.exec("insert into private.orders_projection_dirty(owner_id,group_key) select owner_id,group_key from private.orders_projection_groups order by group_key limit 1;set test.state_calls='0'");
 const value=(await db.query<any>("select orders_workbench_v1(p_state=>'all',p_page_size=>1) value")).rows[0].value;
 expect(value.total).toBe(3);expect((await db.query<any>("select current_setting('test.state_calls')::int calls")).rows[0].calls).toBeLessThanOrEqual(2);
 }finally{await db.close()}
},20000);
it.each(['lost_enqueue','delete','move_key','move_owner','pii','generation','tracking_version'])('keeps hybrid and full fallback identical after %s',async condition=>{
 const {db}=await fixture();try{await db.exec(readPatch());
 // Deliberately simulate recorder loss; source xids/tuple versions remain real.
 await db.exec('alter table fulfillment_orders disable trigger user');
 if(condition==='lost_enqueue')await db.exec("update fulfillment_orders set customer_name='Changed customer' where order_number='DEMO-1'");
 if(condition==='delete')await db.exec("delete from fulfillment_orders where order_number='DEMO-1'");
 if(condition==='move_key')await db.exec("update fulfillment_orders set order_number='RENAMED' where order_number='DEMO-1'");
 if(condition==='move_owner')await db.exec("update fulfillment_orders set owner_id='00000000-0000-4000-8000-000000000002' where order_number='DEMO-1'");
 if(condition==='pii')await db.exec("update fulfillment_orders set pii_purged_at=now() where order_number='DEMO-1'");
 if(condition==='generation')await db.exec('update private.orders_projection_classifier set required_generation=3 where singleton');
 if(condition==='tracking_version')await db.exec("alter table shipment_tracking_state disable trigger user;insert into shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key,normalized_state,last_checked_at) select id,owner_id,'10000000-0000-4000-8000-000000000055','mrw',tracking_number,private.shipment_tracking_identity(o),'pre_transit',now() from fulfillment_orders o where order_number='DEMO-1'");
 const actual=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 await db.exec('update private.orders_projection_control set read_enabled=false where singleton');
 const fallback=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 expect(actual).toEqual(fallback);
 if(condition==='pii'){const purged=actual.rows.find((r:any)=>r.order_number==='DEMO-1');expect(purged.customer_name).toBeNull();expect(purged.shipping_address).toEqual({});}
 }finally{await db.close()}
},20000);
it('still rejects another workspace and MFA denial at the unchanged public wrapper',async()=>{
 const {db}=await fixture();try{await db.exec(readPatch());await db.exec("set test.mfa='no'");await expect(db.exec('select orders_workbench_v1()')).rejects.toThrow('MFA_REQUIRED');await db.exec("set test.mfa='yes';set test.owner='00000000-0000-4000-8000-000000000002'");expect((await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value.total).toBe(0);}finally{await db.close()}
},20000);
it('merges all siblings of a dirty canonical group and restores exact behavior with rollback',async()=>{
 const{db}=await fixture();try{await db.exec(readPatch());
 await db.exec("insert into fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,customer_name,shipping_address,items,order_created_at) select '10000000-0000-4000-8000-000000000999',owner_id,'new-copy',order_number,source_channel,source_status,'Merged sibling','{}','[]',now()+interval '1 minute' from fulfillment_orders where order_number='DEMO-1'");
 const hybrid=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 await db.exec('update private.orders_projection_control set read_enabled=false where singleton');
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value).toEqual(hybrid);
 await db.exec(readFileSync('supabase/rollback/20261023_orders_cached_logistics_read.sql','utf8'));
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value).toEqual(hybrid);
 expect(hybrid.total).toBe(3);expect(hybrid.rows.filter((r:any)=>r.order_number==='DEMO-1')).toHaveLength(1);
 }finally{await db.close()}
},20000);

it.each(['dispatch','history'])('detects lost %s evidence invalidation without source or tracking changes',async kind=>{
 const {db}=await fixture();try{await db.exec(readPatch());
 if(kind==='dispatch')await db.exec("alter table private.order_dispatch_evidence disable trigger order_dispatch_projection_changed;insert into private.order_dispatch_evidence(owner_id,order_id,identity_key,dispatched_at,cause) select owner_id,id,private.shipment_tracking_identity(o),'2026-10-23T08:00:00Z','manual' from fulfillment_orders o where order_number='DEMO-1'");
 else await db.exec("alter table private.order_logistics_legacy disable trigger order_legacy_projection_changed;insert into private.order_logistics_legacy(owner_id,order_id,identity_key,historical_date,basis) select owner_id,id,private.shipment_tracking_identity(o),'2026-09-01T08:00:00Z','pre_cutover_label_without_evidence' from fulfillment_orders o where order_number='DEMO-1'");
 for(const rpc of ['orders_workbench_v1','orders_dashboard_pickup_v1']){
 const actual=(await db.query<any>(`select ${rpc}(p_state=>'all') value`)).rows[0].value;
 await db.exec('update private.orders_projection_control set read_enabled=false where singleton');
 const fallback=(await db.query<any>(`select ${rpc}(p_state=>'all') value`)).rows[0].value;
 expect(actual).toEqual(fallback);await db.exec('update private.orders_projection_control set read_enabled=true where singleton');
 }
 }finally{await db.close()}
},20000);

it('batches current page evidence without reconstructing a JSON order for every visible row',async()=>{
 const{db}=await fixture();try{await db.exec(readPatch());
 const baseline=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 const original=(await db.query<any>("select pg_get_functiondef('private.order_logistics_evidence(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(original.replace('FUNCTION private.order_logistics_evidence(','FUNCTION private.test_original_logistics_evidence('));
 await db.exec(`create or replace function private.order_logistics_evidence(p_row jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform set_config('test.evidence_calls',(coalesce(nullif(current_setting('test.evidence_calls',true),''),'0')::int+1)::text,false);return private.test_original_logistics_evidence(p_row);end$$;set test.evidence_calls='0';`);
 const actual=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 expect(actual).toEqual(baseline);expect((await db.query<any>("select current_setting('test.evidence_calls')::int calls")).rows[0].calls).toBe(0);
 }finally{await db.close()}
},20000);

it('ignores missing, obsolete-format and tuple-mismatched fragments, including misleading cached data',async()=>{
 const{db}=await fixture();try{await db.exec(readPatch());const baseline=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 for(const condition of ['format','tuple','missing']){
  if(condition==='format')await db.exec("update private.orders_projection_payloads set format_generation=0,row_payload=jsonb_build_object('customer_name','STALE_FRAGMENT'),tariff_payload='{}'");
  if(condition==='tuple')await db.exec("update private.orders_projection_payloads set format_generation=1,projection_version='not-current'");
  if(condition==='missing')await db.exec('delete from private.orders_projection_payloads');
  for(const rpc of ['orders_workbench_v1','orders_dashboard_pickup_v1']){
   const actual=(await db.query<any>(`select ${rpc}(p_state=>'all') value`)).rows[0].value;
   if(rpc==='orders_workbench_v1')expect(actual).toEqual(baseline);
   expect(JSON.stringify(actual)).not.toContain('STALE_FRAGMENT');expect(actual.rows.length).toBe(3);
  }
 }
 }finally{await db.close()}
},20000);
it('refreshes fragments atomically and detects a lost fragment update by its projection tuple token',async()=>{
 const{db}=await fixture();try{await db.exec(readPatch());
 const target=(await db.query<any>('select owner_id,projection_group_key,id from private.orders_dashboard_projection order by id limit 1')).rows[0];
 await db.query("update private.orders_dashboard_projection set customer_name='Canonical refresh' where id=$1",[target.id]);
 const token=(await db.query<any>('select c.projection_version=p.xmin::text||\':\'||p.ctid::text as current,c.row_payload->>\'customer_name\' as name from private.orders_projection_payloads c join private.orders_dashboard_projection p on p.owner_id=c.owner_id and p.projection_group_key=c.group_key where p.id=$1',[target.id])).rows[0];expect(token).toEqual({current:true,name:'Canonical refresh'});
 await db.exec('alter table private.orders_dashboard_projection disable trigger orders_projection_payload_changed');
 await db.query("update private.orders_dashboard_projection set customer_name='New tuple without fragment' where id=$1",[target.id]);
 const actual=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;expect(actual.rows.find((r:any)=>r.id===target.id).customer_name).toBe('New tuple without fragment');
 }finally{await db.close()}
},20000);
it('serializes dates and identities live when the reader timezone differs from the fragment writer',async()=>{
 const{db}=await fixture();try{
 await db.exec("set timezone='UTC'");await db.exec(readPatch());
 await db.exec("set timezone='Europe/Madrid'");
 for(const rpc of ['orders_workbench_v1','orders_dashboard_pickup_v1']){
  const hybrid=(await db.query<any>(`select ${rpc}(p_state=>'all') value`)).rows[0].value;
  await db.exec('update private.orders_projection_control set read_enabled=false where singleton');
  const fallback=(await db.query<any>(`select ${rpc}(p_state=>'all') value`)).rows[0].value;
  expect(hybrid).toEqual(fallback);
  await db.exec('update private.orders_projection_control set read_enabled=true where singleton');
 }
 }finally{await db.close()}
},20000);
it('cascades removed projection fragments and denies direct client reads and fallback execution',async()=>{
 const{db}=await fixture();try{await db.exec(readPatch());
 const baseline=(await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value;
 await db.exec('delete from private.orders_dashboard_projection where id=(select id from private.orders_dashboard_projection order by id limit 1)');
 expect((await db.query<any>('select count(*)::int n from private.orders_projection_payloads')).rows[0].n).toBe(2);
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'all') value")).rows[0].value).toEqual(baseline);
 await db.exec('set role authenticated');await expect(db.query('select * from private.orders_projection_payloads')).rejects.toThrow('permission denied');await expect(db.query("select * from private.orders_classified_fallback(null)")).rejects.toThrow('permission denied');
 }finally{await db.close()}
},20000);

