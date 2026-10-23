// @vitest-environment node
import {expect,it} from 'vitest';import {readFileSync} from 'node:fs';
import {verificationFixture,id,owner,other} from './helpers/pickupVerificationFixture';
const migration='supabase/migrations/20261023103551_internal_logistics_state.sql';
const signatureInput=(ids:string[],revision=0,packages=ids.length)=>({carrier:'MRW',driverName:'Test',identifier:'TEST',receivedAt:new Date().toISOString(),packages,signatureHash:'a'.repeat(64),inputHash:'b'.repeat(64),verifiedOrderIds:ids,reportRevision:revision});
it('rejects a standalone schema installation without the atomic release bundle',async()=>{
 const {db}=await verificationFixture();try{await expect(db.exec(readFileSync(migration,'utf8'))).rejects.toThrow('LOGISTICS_ATOMIC_RELEASE_REQUIRED');expect((await db.query<any>("select to_regclass('private.order_dispatch_evidence')::text name")).rows[0].name).toBeNull()}finally{await db.close()}
},20000);
it('can replay the schema on an empty new tenant without a historical data migration',async()=>{
 const {db}=await verificationFixture();try{await db.exec('truncate fulfillment_orders cascade');await db.exec(readFileSync(migration,'utf8'));expect((await db.query('select * from private.order_dispatch_evidence')).rows).toHaveLength(0)}finally{await db.close()}
},20000);
it('the exact release bundle aborts safely when the approved data count has changed',async()=>{
 const {db}=await verificationFixture('active');try{await expect(db.exec(readFileSync('docs/deploy/20261023-logistics-atomic-release.sql','utf8'))).rejects.toThrow('LOGISTICS_BACKFILL_CHANGED_RECOUNT_REQUIRED');await db.exec('rollback');expect((await db.query<any>("select to_regclass('private.order_dispatch_evidence')::text name")).rows[0].name).toBeNull();expect((await db.query('select * from fulfillment_orders')).rows).toHaveLength(3)}finally{await db.close()}
},20000);
async function setup(mode='legacy') {const f=await verificationFixture(mode==='production'?'active':mode);if(mode==='production')await f.db.exec(readFileSync('tests/fixtures/logistics-production-generation.sql','utf8'));if(mode==='production')for(const r of JSON.parse(readFileSync('supabase/snapshots/20261023-internal-logistics-rollback-functions.json','utf8')))await f.db.exec(r.definition);await f.db.exec("set zenvia.logistics_release_bundle='atomic'");await f.db.exec(readFileSync(migration,'utf8'));return f}
async function items(db:any,ids=[id(1)]) {return (await db.query('select jsonb_agg(jsonb_build_object(\'id\',id,\'identity\',private.shipment_tracking_identity(o))) value from fulfillment_orders o where id=any($1)',[ids])).rows[0].value}
it('metadata reads are scoped by workspace and the unchanged Orders/MFA gates',async()=>{
 const {db}=await setup();try{
 await db.query("insert into fulfillment_orders(id,owner_id,sendcloud_id,source_channel,source_status) values($1,$2,'foreign','shopify','unfulfilled')",[id(500),other]);
 await db.exec('set role authenticated');
 const rows=(await db.query<any>('select order_logistics_read($1) value',[[id(1),id(500)]] )).rows[0].value;expect(rows.map((r:any)=>r.id)).toEqual([id(1)]);
 await db.exec("set test.mfa='no'");await expect(db.query('select order_logistics_read($1)',[[id(1)]])).rejects.toThrow('MFA_REQUIRED');await db.exec("set test.mfa='yes';reset role;set role anon");await expect(db.query('select order_logistics_read($1)',[[id(1)]])).rejects.toThrow('permission denied');await db.exec('reset role');
 expect((await db.query<any>('select bool_and(wrapper_hash=md5(pg_get_functiondef(function_oid))) valid from private.mfa_function_manifest')).rows[0].valid).toBe(true);
 }finally{await db.close()}
},20000);
it.each(['normalized','legacy'])('rejects %s cancellation on a stale manual confirmation',async(mode)=>{
 const {db}=await setup();try{
 if(mode==='normalized')await db.query("insert into shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key,normalized_state) select id,owner_id,$1,'mrw',tracking_number,private.shipment_tracking_identity(o),'cancelled' from fulfillment_orders o where id=$2",[id(55),id(1)]);
 else await db.query("update fulfillment_orders set tracking_status_code='CANCELLED' where id=$1",[id(1)]);
 await expect(db.query('select order_logistics_mark_sent($1)',[await items(db)])).rejects.toThrow('LOGISTICS_LABEL_INACTIVE');
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'labelled') value")).rows[0].value.rows.some((r:any)=>r.id===id(1))).toBe(false);
 }finally{await db.close()}
},20000);
it('preserves a pre-cutover imported history without inventing physical dispatch or inheriting it on a new label',async()=>{
 const {db}=await setup();try{
 await db.query("update fulfillment_orders set label_created_at=null,shipping_remote_id=null,source_status='shipped' where id=$1",[id(1)]);
 await db.query('insert into private.order_logistics_legacy(owner_id,identity_key,order_id,historical_date) select owner_id,private.shipment_tracking_identity(o),id,order_created_at from fulfillment_orders o where id=$1',[id(1)]);
 let row=(await db.query<any>('select private.order_logistics_state(to_jsonb(o)) state,private.order_logistics_evidence(to_jsonb(o)) evidence from fulfillment_orders o where id=$1',[id(1)])).rows[0];
 expect(row.state).toBe('shipped');expect(row.evidence).toMatchObject({historical:true});expect(row.evidence.dispatchedAt).toBeUndefined();
 await expect(db.query('select order_logistics_mark_sent($1)',[await items(db)])).rejects.toThrow('LOGISTICS_LABEL_INACTIVE');
 await db.query("update fulfillment_orders set label_created_at=now(),shipping_remote_id='new' where id=$1",[id(1)]);
 expect((await db.query<any>('select private.order_logistics_state(to_jsonb(o)) state from fulfillment_orders o where id=$1',[id(1)])).rows[0].state).toBe('labelled');
 }finally{await db.close()}
},20000);
it('backfill distinguishes proven carrier facts from channel history and rollback retains both',async()=>{
 const {db}=await setup('production');try{
 await db.query("update fulfillment_orders set source_status='shipped',shipping_provider='sendcloud',tracking_status_code='DELIVERED',tracking_updated_at=now() where id=$1",[id(1)]);
 await db.query("update fulfillment_orders set source_status='shipped',label_created_at=null,shipping_remote_id=null where id=$1",[id(2)]);
 await db.exec('create temp table candidates as '+readFileSync('supabase/backfill/20261023_logistics_candidates.sql','utf8'));
 const candidates=(await db.query<any>('select * from candidates order by order_id')).rows;expect(candidates).toHaveLength(2);expect(candidates[0]).toMatchObject({order_id:id(1),candidate_type:'dispatch',basis:'legacy_carrier_status'});expect(candidates[1]).toMatchObject({order_id:id(2),candidate_type:'historical'});
 for(let n=0;n<2;n++)await db.exec("insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,evidence_basis) select owner_id,identity_key,order_id,evidence_at,cause,basis from candidates where candidate_type='dispatch' on conflict do nothing;insert into private.order_logistics_legacy(owner_id,identity_key,order_id,historical_date) select owner_id,identity_key,order_id,evidence_at from candidates where candidate_type='historical' on conflict do nothing;");
 expect((await db.query<any>("select orders_workbench_v1(p_state=>'shipped') value")).rows[0].value.total).toBe(2);
 await db.exec('select private.orders_dashboard_projection_refresh(owner_id,private.orders_dashboard_group_key(source_channel,order_number,id)) from fulfillment_orders;select private.orders_dashboard_projection_reconcile(100)');expect((await db.query<any>('select private.orders_dashboard_projection_usable() usable')).rows[0].usable).toBe(true);
 await db.exec(readFileSync('supabase/rollback/20261023_internal_logistics_state.sql','utf8'));
 expect((await db.query<any>('select private.orders_dashboard_projection_usable() usable')).rows[0].usable).toBe(false);
 expect((await db.query('select * from private.order_dispatch_evidence')).rows).toHaveLength(1);expect((await db.query('select * from private.order_logistics_legacy')).rows).toHaveLength(1);
 }finally{await db.close()}
},20000);
it('rejects signing after a replacement between prepare and complete, with no signature or dispatch committed',async()=>{
 const {db}=await setup();try{
 const report=(await db.query<any>('select pickup_report_create_batch($1,$2,true,$3) value',[[id(1)],id(95),{}])).rows[0].value[0];
 await db.query('select pickup_document_prepare($1,$2,$3,$4,$5,$6)',[owner,owner,report.id,id(96),id(97),signatureInput([id(1)])]);
 await db.query("update fulfillment_orders set label_created_at=label_created_at+interval '1 hour' where id=$1",[id(1)]);
 await expect(db.query('select pickup_document_complete($1,$2,$3,$4,$5,$6)',[owner,owner,report.id,id(96),id(97),{pdfHash:'c'.repeat(64),stampPath:`${owner}/${report.id}/${id(96)}/stamp.png`}])).rejects.toThrow('LOGISTICS_REPORT_LABEL_CHANGED');
 expect((await db.query('select * from private.pickup_document_signatures')).rows).toHaveLength(0);
 }finally{await db.close()}
},20000);
it('allows an unchanged pre-migration unsigned report without rewriting its immutable snapshot',async()=>{
 const {db,report}=await setup();try{
 await db.query('select pickup_document_prepare($1,$2,$3,$4,$5,$6)',[owner,owner,report.id,id(96),id(97),signatureInput([id(1),id(2),id(3)],0,6)]);
 await db.query('select pickup_document_complete($1,$2,$3,$4,$5,$6)',[owner,owner,report.id,id(96),id(97),{pdfHash:'c'.repeat(64),stampPath:`${owner}/${report.id}/${id(96)}/stamp.png`}]);
 expect((await db.query('select * from private.order_dispatch_evidence')).rows).toHaveLength(3);
 expect((await db.query<any>('select snapshot from pickup_reports where id=$1',[report.id])).rows[0].snapshot).toEqual(report);
 }finally{await db.close()}
},20000);
it('only normalized physical movement dispatches, preserves its first cause and rejects an old generation',async()=>{
 const {db}=await setup();try{
 await db.query('update fulfillment_orders set shipping_provider=\'mrw\',shipping_integration_account_id=$1 where id=$2',[id(55),id(1)]);
 const old=(await items(db))[0].identity;
 await db.query(`insert into shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key,normalized_state,observed_at) values($1,$2,$3,'mrw','SYNTHETIC-1',$4,'pre_transit',now())`,[id(1),owner,id(55),old]);
 expect((await db.query('select * from private.order_dispatch_evidence')).rows).toHaveLength(0);
 await db.query("update shipment_tracking_state set normalized_state='in_transit',event_at='2026-10-23T09:00:00Z' where order_id=$1",[id(1)]);
 const first=(await db.query<any>('select * from private.order_dispatch_evidence')).rows[0];expect(first.cause).toBe('tracking');
 await db.query('select order_logistics_mark_sent($1)',[await items(db)]);
 expect((await db.query<any>('select * from private.order_dispatch_evidence')).rows[0]).toEqual(first);
 await db.query("update fulfillment_orders set label_created_at=label_created_at+interval '1 hour' where id=$1",[id(1)]);
 await db.query("update shipment_tracking_state set normalized_state='delivered' where order_id=$1",[id(1)]);
 expect((await db.query<any>('select private.order_logistics_state(to_jsonb(o)) state from fulfillment_orders o where id=$1',[id(1)])).rows[0].state).toBe('labelled');
 }finally{await db.close()}
},20000);
it('a verified signature dispatches only effective lines and an old report cannot dispatch a replacement',async()=>{
 const {db}=await setup();try{
 const report=(await db.query<any>('select pickup_report_create_batch($1,$2,true,$3) value',[[id(1),id(2)],id(95),{}])).rows[0].value[0];
 await db.query('select pickup_document_exclude_item($1,$2,$3,$4,$5)',[owner,owner,report.id,id(2),'No entregado']);
 const input={carrier:'MRW',driverName:'Test',identifier:'TEST',receivedAt:new Date().toISOString(),packages:1,signatureHash:'a'.repeat(64),inputHash:'b'.repeat(64),verifiedOrderIds:[id(1)],reportRevision:1};
 await db.query('select pickup_document_prepare($1,$2,$3,$4,$5,$6)',[owner,owner,report.id,id(96),id(97),input]);
 await db.query('select pickup_document_complete($1,$2,$3,$4,$5,$6)',[owner,owner,report.id,id(96),id(97),{pdfHash:'c'.repeat(64),stampPath:`${owner}/${report.id}/${id(96)}/stamp.png`}]);
 const rows=(await db.query<any>('select * from private.order_dispatch_evidence')).rows;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({order_id:id(1),cause:'signed_report',report_id:report.id});
 expect((await db.query<any>('select private.order_logistics_state(to_jsonb(o)) state from fulfillment_orders o where id=$1',[id(2)])).rows[0].state).toBe('labelled');
 }finally{await db.close()}
},20000);
it('manual bulk dispatch is atomic, audited, idempotent and fenced by label generation and permissions',async()=>{
 const {db}=await setup();try{
 const selection=await items(db,[id(1),id(2)]);
 await expect(db.query('select order_logistics_mark_sent($1)',[[...selection,{id:id(999),identity:'invalid'}]])).rejects.toThrow('LOGISTICS_SELECTION_CHANGED');
 expect((await db.query('select * from private.order_dispatch_evidence')).rows).toHaveLength(0);
 await db.query('select order_logistics_mark_sent($1)',[selection]);await db.query('select order_logistics_mark_sent($1)',[selection]);
 expect((await db.query("select * from audit_logs where action='mark_shipped'")).rows).toHaveLength(2);
 await db.query("update fulfillment_orders set label_created_at=label_created_at+interval '1 minute',shipping_remote_id='replacement',tracking_status_code='CREATED' where id=$1",[id(1)]);
 expect((await db.query<any>('select private.order_logistics_state(to_jsonb(o)) state from fulfillment_orders o where id=$1',[id(1)])).rows[0].state).toBe('labelled');
 await expect(db.query('select order_logistics_mark_sent($1)',[selection])).rejects.toThrow('LOGISTICS_LABEL_CHANGED');
 await db.exec("set test.mfa='no'");await expect(db.query('select order_logistics_mark_sent($1)',[await items(db)])).rejects.toThrow('MFA_REQUIRED');
 await db.exec("set test.mfa='yes';set test.orders='no'");await expect(db.query('select order_logistics_mark_sent($1)',[await items(db)])).rejects.toThrow('PICKUP_ORDERS_PERMISSION_REQUIRED');
 }finally{await db.close()}
},20000);
it.each(['legacy','active','production'])('%s counters, rows, date and selection share the dispatch evidence',async(mode)=>{
 const {db}=await setup(mode);try{
 await db.query("update fulfillment_orders set source_status='shipped'");
 const read=async(state:string)=>(await db.query<any>('select orders_workbench_v1(p_state=>$1,p_selection_all=>true) value',[state])).rows[0].value;
 expect((await read('labelled')).total).toBe(3);
 await db.query('select order_logistics_mark_sent($1)',[await items(db)]);
 const labelled=await read('labelled'),shipped=await read('shipped');expect(labelled.total).toBe(2);expect(shipped.total).toBe(1);
 expect(shipped.rows[0].logistics).toMatchObject({cause:'manual'});expect(shipped.rows[0].logistics_identity).toBeTruthy();
 if(mode==='active') {await db.exec('select private.orders_dashboard_projection_reconcile(100)');expect((await read('labelled')).total).toBe(2);expect((await read('shipped')).total).toBe(1)}
 }finally{await db.close()}
},20000);
it('installs generation-scoped dispatch and never derives it from marketplace confirmation',async()=>{
 const {db}=await verificationFixture();try{
 await db.exec("set zenvia.logistics_release_bundle='atomic'");await db.exec(readFileSync(migration,'utf8'));
 expect((await db.query<any>("select to_regprocedure('private.order_logistics_state(jsonb)')::text name")).rows[0].name).not.toBeNull();
 await db.query("update fulfillment_orders set source_status='shipped' where id=$1",[id(1)]);
 expect((await db.query<any>('select private.order_logistics_state(to_jsonb(o)) state from fulfillment_orders o where id=$1',[id(1)])).rows[0].state).toBe('labelled');
 }finally{await db.close()}
},20000);
it('registers both additive public RPCs with the existing MFA integrity manifest',async()=>{const{db}=await setup();try{for(const name of ['order_logistics_read','order_logistics_mark_sent']){const rows=(await db.query<any>("select m.wrapper_hash=md5(pg_get_functiondef(p.oid)) valid,pg_get_functiondef(p.oid) definition,has_function_privilege('authenticated',m.implementation,'EXECUTE') implementation_exposed from pg_proc p join pg_namespace n on n.oid=p.pronamespace join private.mfa_function_manifest m on m.function_oid=p.oid where n.nspname='public' and p.proname=$1",[name])).rows;expect(rows).toHaveLength(1);expect(rows[0].valid).toBe(true);expect(rows[0].definition).toContain('security_mfa_assert(false)');expect(rows[0].implementation_exposed).toBe(false)}}finally{await db.close()}},20000);
it('retains an explicitly declared package discrepancy in the signature and its PDF bundle',async()=>{const{db,report}=await setup();try{const result=(await db.query<any>('select pickup_document_prepare($1,$2,$3,$4,$5,$6) value',[owner,owner,report.id,id(96),id(97),signatureInput([id(1),id(2),id(3)],0,4)])).rows[0].value;expect(result.bundle.report.totalPackages).toBe(6);await db.query('select pickup_document_complete($1,$2,$3,$4,$5,$6)',[owner,owner,report.id,id(96),id(97),{pdfHash:'c'.repeat(64),stampPath:`${owner}/${report.id}/${id(96)}/stamp.png`}]);expect((await db.query<any>('select packages from private.pickup_document_signatures')).rows[0].packages).toBe(4)}finally{await db.close()}},20000);
