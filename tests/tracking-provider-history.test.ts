// @vitest-environment node
import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const read=(name:string)=>readFileSync('supabase/migrations/'+name,'utf8');
const setup=async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create table integration_accounts(id uuid primary key,owner_id uuid,provider text,enabled boolean,status text);create table workspaces(id uuid primary key,status text);`+readFileSync('tests/fixtures/orders-table-schema.sql','utf8')+`alter table fulfillment_orders add primary key(id);`);
 for(const name of ['20261022053808_shipment_tracking_shadow.sql','20261022055814_shipment_tracking_terminal_guards.sql','20261022060055_shipment_tracking_provider_event_time.sql','20261022060645_shipment_tracking_privacy.sql','20261022095709_shipment_tracking_finish_account_guard.sql'])await db.exec(read(name));
 await db.exec(`insert into workspaces values(md5('owner')::uuid,'active');insert into integration_accounts values(md5('account')::uuid,md5('owner')::uuid,'mrw',true,'active');insert into fulfillment_orders(id,owner_id,shipping_integration_account_id,sendcloud_id,source_status,tracking_number,shipping_provider,label_created_at,order_created_at,tracking_status_code,items,shipping_address,raw_payload) values(md5('order')::uuid,md5('owner')::uuid,md5('account')::uuid,'1','SHIPPED','T1','mrw',now(),now(),'SHIPPED','[]','{}','{}');select tracking_seed_shadow();select tracking_claim(md5('run')::uuid,25);`);
 return db;
};
const apply=async(db:PGlite)=>{await db.exec(read('20261022100754_shipment_tracking_provider_history.sql'))};
const events=[
 {state:'pre_transit',code:'100',message:'Creado',eventAt:'2026-10-20T08:00:00Z'},
 {state:'in_transit',code:'200',message:'En tránsito',eventAt:'2026-10-21T08:00:00Z'},
 {state:'out_for_delivery',code:'300',message:'En reparto',eventAt:'2026-10-22T08:00:00Z',eventTimeRaw:'2026-10-22 08:00:00'},
];
const finish=async(db:PGlite,event:any,identity?:string,error:string|null=null)=>(await db.query<any>(`select tracking_finish(md5('order')::uuid,md5('run')::uuid,coalesce($2,(select identity_key from shipment_tracking_state where order_id=md5('order')::uuid)),$1::jsonb,now(),$3) applied`,[JSON.stringify(event),identity||null,error])).rows[0].applied;
const allEvents=async(db:PGlite)=>(await db.query<any>('select * from shipment_tracking_events order by event_at,raw_code')).rows;

it('persists three provider events once across repeated polls and ignores non-tracking fields',async()=>{
 const db=await setup();try{
  const before=(await db.query<any>(`select to_jsonb(o) orders from fulfillment_orders o`)).rows[0].orders;
  const contract=(await db.query<any>(`select oid,prosecdef,proacl::text acl,proconfig from pg_proc where oid='tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure`)).rows[0];
  await apply(db);expect(await allEvents(db)).toHaveLength(0);
  expect((await db.query<any>(`select oid,prosecdef,proacl::text acl,proconfig from pg_proc where oid='tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure`)).rows[0]).toEqual(contract);
  const spoof={owner_id:'PRIVATE OWNER',order_id:'PRIVATE ORDER',identity_key:'PRIVATE IDENTITY',recipient:'PRIVATE RECIPIENT',PersonaEntrega:'PRIVATE PERSON',history:[{message:'PRIVATE NESTED'}],warningCode:'PRIVATE WARNING'};
  expect(await finish(db,{...events[2],observedAt:'2026-10-22T09:00:00Z',history:[events[0],events[1],events[1],events[2]].map(e=>({...spoof,...e}))})).toBe(true);
  const first=await allEvents(db);expect(first).toHaveLength(3);expect(first.map(e=>e.raw_code)).toEqual(['100','200','300']);expect(JSON.stringify(first)).not.toContain('PRIVATE');
  await db.exec(`select tracking_claim(md5('run')::uuid,25)`);
  // Different key order, observation times and equivalent event instants cannot
  // create another provider movement or another event for the latest state.
  expect(await finish(db,{...spoof,...events[2],observedAt:'2026-10-22T10:00:00Z',history:events.map(e=>({...spoof,...e,eventAt:e.eventAt.replace('08:00:00Z','10:00:00+02:00'),observedAt:'2026-10-22T10:00:00Z'}))})).toBe(true);
  expect(await allEvents(db)).toEqual(first);
  expect((await db.query<any>(`select normalized_state,raw_code,raw_event_time from shipment_tracking_state`)).rows[0]).toEqual({normalized_state:'out_for_delivery',raw_code:'300',raw_event_time:'2026-10-22 08:00:00'});
  expect((await db.query<any>(`select to_jsonb(o) orders from fulfillment_orders o`)).rows[0].orders).toEqual(before);
 }finally{await db.close()}
},20000);

it('bounds untrusted history, retains current state, and deduplicates legacy event keys',async()=>{
 const db=await setup();try{
  await apply(db);
  await db.exec(`insert into shipment_tracking_events(order_id,owner_id,account_id,identity_key,event_key,normalized_state,raw_code,raw_message,event_at) select order_id,owner_id,account_id,identity_key,'legacy-observation-key','pre_transit','100','Creado','2026-10-20T08:00:00Z' from shipment_tracking_state`);
  expect(await finish(db,{...events[2],history:events})).toBe(true);expect(await allEvents(db)).toHaveLength(3);
  await db.exec(`select tracking_claim(md5('run')::uuid,25);delete from shipment_tracking_events`);
  expect(await finish(db,{...events[2],code:'CURRENT',history:Array.from({length:205},(_,i)=>({...events[0],code:'H'+i}))})).toBe(true);
  const bounded=await allEvents(db);expect(bounded).toHaveLength(201);expect(bounded.some(e=>e.raw_code==='CURRENT')).toBe(true);expect(bounded.some(e=>e.raw_code==='H200')).toBe(false);
 }finally{await db.close()}
},20000);

it('applies account/identity/PII guards before any history persistence and purges the complete history',async()=>{
 const db=await setup();try{
  await apply(db);const identity=(await db.query<any>('select identity_key from shipment_tracking_state')).rows[0].identity_key;
  await db.exec('update integration_accounts set enabled=false');expect(await finish(db,{...events[2],history:events})).toBe(false);expect(await allEvents(db)).toHaveLength(0);
  await db.exec(`update integration_accounts set enabled=true;update fulfillment_orders set tracking_number='OTHER'`);expect(await finish(db,{...events[2],history:events},identity)).toBe(false);expect(await allEvents(db)).toHaveLength(0);
  await db.exec(`update fulfillment_orders set tracking_number='T1'`);expect(await finish(db,{...events[2],history:events})).toBe(true);expect(await allEvents(db)).toHaveLength(3);
  await db.exec(`update fulfillment_orders set pii_purged_at=now()`);expect(await allEvents(db)).toHaveLength(0);expect(await finish(db,{...events[2],history:events},identity)).toBe(false);expect(await allEvents(db)).toHaveLength(0);
 }finally{await db.close()}
},20000);

it('accepts safe unknown-status warnings without discarding delivered history or increasing failures',async()=>{
 const db=await setup();try{
  await apply(db);await db.exec(`update shipment_tracking_state set normalized_state='in_transit',raw_code='200',failures=2`);
  const unknown={state:'in_transit',code:'999',message:'Estado MRW no reconocido',eventAt:'2026-10-22T08:00:00Z'};
  const unknownHistory={...unknown,state:null};
  expect(await finish(db,{...unknown,history:[events[0],unknownHistory]},undefined,'MRW_UNKNOWN_STATUS_999')).toBe(true);
  expect((await db.query<any>('select normalized_state,raw_code,failures,last_error,last_checked_at is not null checked from shipment_tracking_state')).rows[0]).toEqual({normalized_state:'in_transit',raw_code:'999',failures:0,last_error:'MRW_UNKNOWN_STATUS_999',checked:true});
  expect(await allEvents(db)).toHaveLength(2);expect((await allEvents(db))[1].normalized_state).toBeNull();
  await db.exec(`select tracking_claim(md5('run')::uuid,25)`);
  // A real failure still preserves both the last movement and its history.
  expect(await finish(db,{...events[2],history:events},undefined,'MRW_UNKNOWN_STATUS_PRIVATE')).toBe(true);
  expect((await db.query<any>('select normalized_state,raw_code,failures,last_error from shipment_tracking_state')).rows[0]).toEqual({normalized_state:'in_transit',raw_code:'999',failures:1,last_error:'MRW_UNKNOWN_STATUS_PRIVATE'});
  expect(await allEvents(db)).toHaveLength(2);
  await db.exec(`select tracking_claim(md5('run')::uuid,25)`);
  const delivered={state:'delivered',code:'00',message:'Entregado',eventAt:'2026-10-22T12:00:00Z'};
  expect(await finish(db,{...delivered,history:[events[0],unknownHistory,delivered]},undefined,'MRW_UNKNOWN_STATUS_UNKNOWN')).toBe(true);
  expect((await db.query<any>('select normalized_state,raw_code,failures,last_error from shipment_tracking_state')).rows[0]).toEqual({normalized_state:'delivered',raw_code:'00',failures:0,last_error:'MRW_UNKNOWN_STATUS_UNKNOWN'});
  expect(await allEvents(db)).toHaveLength(3);
 }finally{await db.close()}
},20000);
