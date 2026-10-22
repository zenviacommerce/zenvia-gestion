import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

const migration='supabase/migrations/20261022111520_shipment_tracking_legacy_sendcloud_coverage.sql';
const read=(path:string)=>readFileSync(path,'utf8');
const owner='11111111-1111-1111-1111-111111111111';
const foreign='99999999-9999-9999-9999-999999999999';
const sc='22222222-2222-2222-2222-222222222222';
const envia='33333333-3333-3333-3333-333333333333';
async function fixture(){
 const d=new PGlite();
 await d.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
 create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);
 create table workspaces(id uuid primary key,status text);
 create table fulfillment_orders(id uuid primary key,owner_id uuid,shipping_integration_account_id uuid,shipping_provider text,tracking_number text,shipping_remote_id text,sendcloud_parcel_id bigint,label_created_at timestamptz,label_cancelled_at timestamptz,tracking_status_code text,pii_purged_at timestamptz);
 insert into workspaces values('${owner}','active'),('${foreign}','disabled');
 insert into integration_accounts values('${sc}','${owner}','sendcloud',true,'active'),('${envia}','${owner}','envia',true,'active'),('44444444-4444-4444-4444-444444444444','${foreign}','sendcloud',true,'active'),('55555555-5555-5555-5555-555555555555','${owner}','sendcloud',false,'active');`);
 for(const file of ['20261022053808_shipment_tracking_shadow.sql','20261022055814_shipment_tracking_terminal_guards.sql','20261022060055_shipment_tracking_provider_event_time.sql','20261022060645_shipment_tracking_privacy.sql','20261022095046_shipment_tracking_reprocess.sql'])await d.exec(read('supabase/migrations/'+file));
 await d.exec(`insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,tracking_number,tracking_status_code)
 select md5('legacy-'||n)::uuid,'${owner}','${sc}','LEGACY-'||n,'SHIPPED' from generate_series(1,13)n;
 insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,tracking_number,tracking_status_code)
 select md5('done-'||n)::uuid,'${owner}','${sc}','DONE-'||n,'DELIVERED' from generate_series(1,242)n;
 insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,shipping_provider,tracking_number,tracking_status_code,pii_purged_at,label_cancelled_at) values
 (md5('explicit-envia-sc-account')::uuid,'${owner}','${sc}','envia','BAD-1','SHIPPED',null,null),
 (md5('explicit-sc-envia-account')::uuid,'${owner}','${envia}','sendcloud','BAD-2','SHIPPED',null,null),
 (md5('foreign-account')::uuid,'${owner}','44444444-4444-4444-4444-444444444444',null,'BAD-3','SHIPPED',null,null),
 (md5('disabled-account')::uuid,'${owner}','55555555-5555-5555-5555-555555555555',null,'BAD-4','SHIPPED',null,null),
 (md5('inactive-workspace')::uuid,'${foreign}','44444444-4444-4444-4444-444444444444',null,'BAD-5','SHIPPED',null,null),
 (md5('purged')::uuid,'${owner}','${sc}',null,'BAD-6','SHIPPED',now(),null),
 (md5('cancelled-label')::uuid,'${owner}','${sc}',null,'BAD-7','SHIPPED',null,now()),
 (md5('empty-tracking')::uuid,'${owner}','${sc}',null,'','SHIPPED',null,null),
 (md5('returned')::uuid,'${owner}','${sc}',null,'BAD-8','RETURNED',null,null),
 (md5('cancelled')::uuid,'${owner}','${sc}',null,'BAD-9','CANCELLED',null,null);`);
 return d;
}
async function functionMetadata(d:PGlite){return (await d.query(`select proname,proacl::text,prosecdef,proconfig::text from pg_proc where oid in('public.tracking_seed_shadow()'::regprocedure,'public.tracking_reprocess_candidates()'::regprocedure) order by proname`)).rows;}
async function sourceSnapshot(d:PGlite){return (await d.query<{snapshot:string}>(`select jsonb_agg(to_jsonb(o) order by id)::text snapshot from fulfillment_orders o`)).rows[0].snapshot;}

it('covers 13 active legacy Sendcloud shipments without parcel metadata while leaving 242 delivered shipments unqueried',async()=>{
 const d=await fixture();try{
  const before=await sourceSnapshot(d),metadata=await functionMetadata(d);
  // The real old functions reproduce the production coverage hole.
  expect((await d.query<{n:number}>('select tracking_seed_shadow() n')).rows[0].n).toBe(0);
  await d.exec(read(migration));
  expect(await sourceSnapshot(d)).toBe(before);
  expect(await functionMetadata(d)).toEqual(metadata);
  expect((await d.query<{n:number}>('select tracking_seed_shadow() n')).rows[0].n).toBe(13);
  const candidates=(await d.query<{tracking_number:string,provider:string}>('select * from tracking_reprocess_candidates()')).rows;
  expect(candidates).toHaveLength(13);
  expect(candidates.every(c=>c.provider==='sendcloud'&&c.tracking_number.startsWith('LEGACY-'))).toBe(true);
  const claimed=(await d.query<{tracking_number:string}>('select * from tracking_claim($1,25)',['66666666-6666-6666-6666-666666666666'])).rows;
  expect(claimed).toHaveLength(13);
  expect(claimed.every(c=>c.tracking_number.startsWith('LEGACY-'))).toBe(true);
  expect(await sourceSnapshot(d)).toBe(before);
 }finally{await d.close()}
},20000);

it('keeps candidate account/provider/terminal/privacy/identity guards even for pre-existing shadow records',async()=>{
 const d=await fixture();try{
  await d.exec(read(migration));
  // Deliberately stale shadow rows must never bypass candidate validation.
  await d.exec(`insert into shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key)
   select o.id,o.owner_id,o.shipping_integration_account_id,a.provider,o.tracking_number,private.shipment_tracking_identity(o)
   from fulfillment_orders o join integration_accounts a on a.id=o.shipping_integration_account_id where o.tracking_number<>'';
   update shipment_tracking_state set identity_key='old-label' where tracking_number='LEGACY-12';
   update shipment_tracking_state set normalized_state='delivered' where tracking_number='LEGACY-13';`);
  const candidates=(await d.query<{tracking_number:string}>('select * from tracking_reprocess_candidates()')).rows;
  expect(candidates.map(c=>c.tracking_number).sort()).toEqual(Array.from({length:11},(_,i)=>'LEGACY-'+(i+1)).sort());
  for(const role of ['anon','authenticated'])expect((await d.query<{ok:boolean}>(`select has_function_privilege($1,'public.tracking_reprocess_candidates()','execute') ok`,[role])).rows[0].ok).toBe(false);
  expect((await d.query<{ok:boolean}>(`select has_function_privilege('service_role','public.tracking_reprocess_candidates()','execute') ok`)).rows[0].ok).toBe(true);
 }finally{await d.close()}
},20000);

it('aborts atomically when either existing provider anchor has changed',async()=>{
 const d=await fixture();try{
  const original=(await d.query<{definition:string}>(`select pg_get_functiondef('public.tracking_reprocess_candidates()'::regprocedure) definition`)).rows[0].definition;
  await d.exec(original.replace("o.sendcloud_parcel_id is not null","o.sendcloud_parcel_id > 0"));
  const seedBefore=(await d.query<{definition:string}>(`select pg_get_functiondef('public.tracking_seed_shadow()'::regprocedure) definition`)).rows[0].definition;
  await expect(d.exec(read(migration))).rejects.toThrow(/TRACKING_LEGACY_SENDCLOUD/);
  expect((await d.query<{definition:string}>(`select pg_get_functiondef('public.tracking_seed_shadow()'::regprocedure) definition`)).rows[0].definition).toBe(seedBefore);
 }finally{await d.close()}
},20000);
