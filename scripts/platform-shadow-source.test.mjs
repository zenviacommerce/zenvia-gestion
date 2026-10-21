import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create table workspaces(id uuid primary key);create table app_users(user_id uuid primary key,workspace_id uuid,active boolean);create table amazon_accounts(id uuid primary key,owner_id uuid,status text);create table fulfillment_orders(id uuid primary key,owner_id uuid,order_created_at timestamptz);create table support_tickets(id uuid primary key,owner_id uuid,ticket_number text,subject text,type text,status text,priority text,assigned_to uuid,last_author_role text,created_at timestamptz default now(),updated_at timestamptz default now(),last_activity_at timestamptz default now());insert into workspaces values('${a}'),('${b}');`);
 const file=(await readdir('supabase/migrations')).find(x=>x.endsWith('_platform_projection_shadow_source.sql'));
 await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 for(const fix of (await readdir('supabase/migrations')).filter(x=>x.endsWith('_platform_shadow_capture_safety.sql')).sort())await db.exec(await readFile('supabase/migrations/'+fix,'utf8'));
 await db.exec(`update private.platform_shadow_source_config set enabled=true,source_project_ref='source',generation='${a}',key_id='source-v1',drain_lease='${a}',drain_until=now()+interval '60 seconds',period_start=date_trunc('month',now());insert into private.platform_shadow_source_workspaces(workspace_id) values('${a}');`);return db;
}
test('transactional source captures only scoped real changes and rollback leaves no event',async()=>{
 const db=await fixture();try{
 await db.exec(`begin;insert into app_users values('${a}','${a}',true);rollback;`);
 assert.equal((await db.query('select count(*)::int n from private.platform_shadow_outbox')).rows[0].n,0);
 await db.exec(`insert into app_users values('${a}','${a}',true),('${b}','${b}',true);update app_users set active=active;`);
 assert.equal((await db.query('select count(*)::int n from private.platform_shadow_outbox')).rows[0].n,1);
 const e=(await db.query(`select public.platform_shadow_source_claim('${a}') e`)).rows[0].e;
 assert.equal(e.workspace_id,a);assert.equal(e.payload.users_active,1);assert.equal(e.payload.monthly_orders,0);
 await db.exec(`insert into amazon_accounts values('${a}','${a}','active');`);
 assert.equal((await db.query(`select public.platform_shadow_source_ack('${e.event_id}','${b}',true,null) ok`)).rows[0].ok,false);
 assert.equal((await db.query(`select public.platform_shadow_source_ack('${e.event_id}','${a}',true,null) ok`)).rows[0].ok,true);
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from private.platform_shadow_outbox'),/permission denied/);await assert.rejects(db.query(`select public.platform_shadow_source_claim('${a}')`),/permission denied/);
 }finally{await db.close();}
});
test('source freezes retry bodies, retains tombstones and snapshot cursor uses tie-break ID',async()=>{
 const db=await fixture();try{
 await db.exec(`insert into support_tickets(id,owner_id,ticket_number,subject,type,status,priority,last_author_role) values('${b}','${a}','T1','A ticket','incident','open','normal','user');`);
 const e=(await db.query(`select public.platform_shadow_source_claim('${a}') e`)).rows[0].e;
 await db.exec(`update support_tickets set subject='New subject' where id='${b}';select public.platform_shadow_source_ack('${e.event_id}','${a}',false,'TEST_FAILURE');update private.platform_shadow_outbox set available_at=now()-interval '1 second';`);
 const retry=(await db.query(`select public.platform_shadow_source_claim('${a}') e`)).rows[0].e;
 assert.deepEqual(retry,e);
 await db.exec(`delete from support_tickets where id='${b}';`);
 const page=(await db.query(`select public.platform_shadow_source_snapshot(null,null,now()+interval '1 minute',100) p`)).rows[0].p;
 assert.ok(page.events.some(x=>x.entity_type==='ticket'&&x.deleted===true));assert.equal(page.workspaces.length,0);
 }finally{await db.close();}
});

test('source handles equal timestamps, cold metrics refresh, month rollover and expired leases',async()=>{
 const db=await fixture();try{
 await db.exec(`select public.platform_shadow_source_bootstrap();insert into support_tickets(id,owner_id,ticket_number,subject,type,status,priority,last_author_role) values('${a}','${a}','T1','First ticket','incident','open','normal','user'),('${b}','${a}','T2','Second ticket','incident','open','normal','user');update private.platform_shadow_versions set updated_at='2026-10-01T00:00:00Z';`);
 const first=(await db.query(`select public.platform_shadow_source_snapshot(null,null,now(),1) p`)).rows[0].p;
 assert.equal(first.events.filter(e=>e.entity_type==='ticket').length,1);assert.equal(first.events.filter(e=>e.entity_type==='metrics').length,1);
 const second=(await db.query('select public.platform_shadow_source_snapshot($1,$2,now(),1) p',[first.cursor.updated_at,first.cursor.id])).rows[0].p;
 assert.notEqual(second.events.find(e=>e.entity_type==='ticket').entity_id,first.events.find(e=>e.entity_type==='ticket').entity_id);
 await db.exec(`update private.platform_shadow_source_config set period_start='2026-09-01',drain_until=now()-interval '1 second';`);
 assert.equal((await db.query(`select public.platform_shadow_source_drain_lease('${a}') ok`)).rows[0].ok,true);
 assert.equal((await db.query(`select public.platform_shadow_source_drain_lease('${b}') ok`)).rows[0].ok,false);
 const e=(await db.query(`select public.platform_shadow_source_claim('${a}') e`)).rows[0].e;
 await db.query(`update private.platform_shadow_outbox set attempts=10,lease_until=now()-interval '1 second' where event_id=$1`,[e.event_id]);
 await db.query(`select public.platform_shadow_source_claim('${a}')`);
 assert.ok((await db.query('select failed_at from private.platform_shadow_outbox where event_id=$1',[e.event_id])).rows[0].failed_at);
 }finally{await db.close();}
});

test('authoritative repair gates bootstrap and recovers late/uncaptured changes without resurrecting deletes',async()=>{
 const db=await fixture();try{
 let page=(await db.query(`select public.platform_shadow_source_snapshot(null,null,now()) p`)).rows[0].p;
 assert.deepEqual(page.workspaces,[]);
 await db.exec(`insert into support_tickets(id,owner_id,subject,status) values('${b}','${a}','Original ticket','open');select public.platform_shadow_source_bootstrap();`);
 await db.exec(`update private.platform_shadow_source_config set enabled=false;delete from support_tickets where id='${b}';update private.platform_shadow_source_config set enabled=true;select public.platform_shadow_source_bootstrap();`);
 page=(await db.query(`select public.platform_shadow_source_snapshot(null,null,now()+interval '1 minute') p`)).rows[0].p;
 assert.equal(page.workspaces.length,1);assert.equal(page.events.find(e=>e.entity_type==='ticket').deleted,true);
 await db.exec(`select public.platform_shadow_source_bootstrap();`);
 assert.equal((await db.query('select deleted from private.platform_shadow_versions where entity_type=\'ticket\'')).rows[0].deleted,true);
 }finally{await db.close();}
});

test('expired global drain lease cannot claim another event',async()=>{const db=await fixture();try{
 await db.exec(`insert into app_users values('${a}','${a}',true);update private.platform_shadow_source_config set drain_until=now()-interval '1 second';`);
 assert.equal((await db.query(`select public.platform_shadow_source_claim('${a}') e`)).rows[0].e,null);
 assert.equal((await db.query('select attempts from private.platform_shadow_outbox')).rows[0].attempts,0);
 }finally{await db.close();}});

test('500 workspaces / 5000 tickets full inventory has no client-wide payload and rollback stops capture',async()=>{
 const db=await fixture();try{
 await db.exec(`update private.platform_shadow_source_config set enabled=false;insert into workspaces select md5('workspace-'||n)::uuid from generate_series(1,500) n;insert into private.platform_shadow_source_workspaces(workspace_id) select id from workspaces on conflict do nothing;insert into support_tickets(id,owner_id,subject,status) select md5('ticket-'||n)::uuid,md5('workspace-'||((n-1)%500+1))::uuid,'Scale rehearsal','open' from generate_series(1,5000) n;update private.platform_shadow_source_config set enabled=true;`);
 const started=performance.now();await db.exec('select public.platform_shadow_source_bootstrap()');const elapsed=performance.now()-started;
 assert.equal((await db.query("select count(*)::int n from private.platform_shadow_versions where entity_type='ticket'")).rows[0].n,5000);
 const page=(await db.query('select public.platform_shadow_source_snapshot(null,null,now()+interval \'1 minute\') p')).rows[0].p;assert.equal(page.events.length,125);assert.equal(page.has_more,true);assert.equal(page.workspaces.length,502);
 let after=null,id=null,metricsAfter=null,total=0,metrics=0;for(let n=0;n<100;n++){const page=(await db.query('select public.platform_shadow_source_snapshot($1,$2,now()+interval \'1 minute\',100,$3) p',[after,id,metricsAfter])).rows[0].p;total+=page.events.filter(e=>e.entity_type==='ticket').length;metrics+=page.events.filter(e=>e.entity_type==='metrics').length;after=page.cursor?.updated_at||after;id=page.cursor?.id||id;metricsAfter=page.metrics_has_more?page.metrics_cursor:'ffffffff-ffff-ffff-ffff-ffffffffffff';if(!page.has_more&&!page.metrics_has_more)break;}assert.equal(total,5000);assert.equal(metrics,502);
 console.log(JSON.stringify({rehearsal:'isolated-pglite',workspaces:500,tickets:5000,repair_ms:Math.round(elapsed),page_bytes:JSON.stringify(page).length}));
 await db.exec(`update private.platform_shadow_source_config set enabled=false;`);const before=(await db.query('select count(*)::int n from private.platform_shadow_outbox')).rows[0].n;await db.exec(`delete from support_tickets;`);assert.equal((await db.query('select count(*)::int n from private.platform_shadow_outbox')).rows[0].n,before);
 }finally{await db.close();}
});

const envelopeKeys=['protocol','source_project_ref','generation','event_id','workspace_id','entity_type','entity_id','revision','observed_at','deleted','payload'].sort();
const metricKeys=['users_active','amazon_accounts','monthly_orders','period_start','period_end'].sort();
const ticketKeys=['ticket_number','type','status','priority','assigned_to','last_author_role','created_at','updated_at','last_activity_at'].sort();
test('capture failure cannot abort committed business UPDATE, even if failure logging also fails',async()=>{const db=await fixture();try{
 await db.exec(`insert into fulfillment_orders values('${a}','${a}',now());alter table private.platform_shadow_outbox add constraint forced_capture_error check(false) not valid;`);
 await db.exec(`begin;update fulfillment_orders set order_created_at=order_created_at-interval '1 day' where id='${a}';commit;`);
 assert.equal((await db.query("select count(*)::int n from private.platform_shadow_capture_failures where error_code='23514' and source_table='fulfillment_orders' and operation='UPDATE'")).rows[0].n,1);
 assert.ok((await db.query(`select order_created_at<now()-interval '23 hours' as committed from fulfillment_orders where id='${a}'`)).rows[0].committed);
 await db.exec(`alter table private.platform_shadow_capture_failures add constraint forced_logger_error check(false) not valid;begin;update fulfillment_orders set order_created_at=order_created_at-interval '1 day' where id='${a}';commit;`);
 assert.ok((await db.query(`select order_created_at<now()-interval '47 hours' as committed from fulfillment_orders where id='${a}'`)).rows[0].committed);
 }finally{await db.close();}});
test('capture and events use explicit field allowlists; buyer data and ticket text never leave source',async()=>{const db=await fixture();try{
 for(const table of ['fulfillment_orders','support_tickets','app_users','amazon_accounts'])await db.exec(`alter table ${table} add column buyer_email text default 'PII_SENTINEL';alter table ${table} add column raw_payload jsonb default '{"secret":"PII_SENTINEL"}';`);
 await db.exec(`insert into fulfillment_orders(id,owner_id,order_created_at) values('${a}','${a}',now());insert into app_users(user_id,workspace_id,active) values('${a}','${a}',true);insert into amazon_accounts(id,owner_id,status) values('${a}','${a}','active');insert into support_tickets(id,owner_id,subject,ticket_number,type,status,priority) values('${b}','${a}','PII_SENTINEL','T1','incident','open','normal');`);
 const page=(await db.query(`select public.platform_shadow_source_snapshot(null,null,now()+interval '1 minute') p`)).rows[0].p;
 for(const e of page.events){assert.deepEqual(Object.keys(e).sort(),envelopeKeys);assert.deepEqual(Object.keys(e.payload).sort(),e.entity_type==='metrics'?metricKeys:ticketKeys);}
 const out=(await db.query(`select public.platform_shadow_source_claim('${a}') e`)).rows[0].e;assert.ok(!JSON.stringify({page,out}).includes('PII_SENTINEL'));
 const fn=(await db.query("select pg_get_functiondef('private.platform_shadow_capture()'::regprocedure) def")).rows[0].def;assert.doesNotMatch(fn,/to_jsonb\s*\(\s*(?:old|new)\s*\)/i);
 }finally{await db.close();}});
