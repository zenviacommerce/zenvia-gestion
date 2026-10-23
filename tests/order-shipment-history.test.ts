import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema private;
 create function private.app_workspace_owner_id() returns uuid language sql as $$select nullif(current_setting('test.owner',true),'')::uuid$$;
 create function private.app_has_permission(text) returns boolean language sql as $$select true$$;
 create function private.mfa_allowed() returns boolean language sql as $$select true$$;
 create table fulfillment_orders(id uuid primary key,order_id text,owner_id uuid,pii_purged_at timestamptz,shipping_provider text,shipping_integration_account_id uuid,carrier_name text,carrier_code text,tracking_number text,shipping_remote_id text,sendcloud_parcel_id bigint,label_created_at timestamptz,label_cancelled_at timestamptz,tracking_status_code text,tracking_updated_at timestamptz);
 insert into fulfillment_orders(id,owner_id,shipping_provider,carrier_name,tracking_number,shipping_remote_id,label_created_at) values('${id}','${owner}','mrw','MRW','OLD-TRACK','OLD-REF','2026-10-22T09:00:00Z');`);
 await db.exec(readFileSync('supabase/migrations/20261023020000_order_shipment_history.sql','utf8'));
 return db;
}
it('captures the previous shipment before clearing and keeps it after relabelling and import',async()=>{const db=await fixture();try{
 await db.exec(`update fulfillment_orders set label_cancelled_at='2026-10-22T12:00:00Z',tracking_number=null,shipping_remote_id=null,label_created_at=null`);
 await db.exec(`update fulfillment_orders set label_cancelled_at=null,tracking_number='NEW-TRACK',shipping_remote_id='NEW-REF',label_created_at='2026-10-22T13:00:00Z'`);
 await db.exec(`update fulfillment_orders set carrier_name='Nuevo transportista'`);
 const rows=(await db.query<any>('select carrier,tracking_number,cancelled_at from order_shipment_history')).rows;
 expect(rows).toHaveLength(1);expect(rows[0].carrier).toBe('MRW');expect(rows[0].tracking_number).toBe('OLD-TRACK');expect(new Date(rows[0].cancelled_at).toISOString()).toBe('2026-10-22T12:00:00.000Z');
 }finally{await db.close()}});
it('captures legacy machine cancellation when a new shipment replaces it without inventing a date',async()=>{const db=await fixture();try{
 await db.exec(`update fulfillment_orders set tracking_status_code='CANCELLED',tracking_updated_at=null`);
 await db.exec(`update fulfillment_orders set tracking_status_code='READY_TO_SEND',tracking_number='NEW',shipping_remote_id='NEW',label_created_at=now()`);
 const rows=(await db.query<any>('select tracking_number,cancelled_at from order_shipment_history')).rows;expect(rows).toHaveLength(1);expect(rows[0].tracking_number).toBe('OLD-TRACK');expect(rows[0].cancelled_at).toBeNull();
 }finally{await db.close()}});
it('does not record routine tracking, deduplicates repeated cancellation, and records the next cycle',async()=>{const db=await fixture();try{
 await db.exec(`update fulfillment_orders set tracking_status_code='IN_TRANSIT'`);expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(0);
 await db.exec(`update fulfillment_orders set label_cancelled_at=now()`);await db.exec(`update fulfillment_orders set tracking_status_code='CANCELLED'`);
 expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(1);
 await db.exec(`update fulfillment_orders set label_cancelled_at=null,tracking_status_code='READY_TO_SEND',tracking_number='NEW',shipping_remote_id='NEW',label_created_at=now()`);
 await db.exec(`update fulfillment_orders set label_cancelled_at=now(),tracking_number=null,shipping_remote_id=null,label_created_at=null`);
 expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(2);
 }finally{await db.close()}});
it('restricts history to the workspace, denies client writes, and purges it with order PII',async()=>{const db=await fixture();try{
 await db.exec(`update fulfillment_orders set label_cancelled_at=now();grant select on fulfillment_orders to authenticated;grant usage on schema private to authenticated;set role authenticated;set test.owner='00000000-0000-4000-8000-000000000099'`);
 expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(0);
 await db.exec(`set test.owner='${owner}'`);expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(1);
 await expect(db.exec('delete from order_shipment_history')).rejects.toThrow(/permission denied/);
 await db.exec(`reset role;update fulfillment_orders set pii_purged_at=now()`);expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(0);
 await db.exec(`update fulfillment_orders set tracking_number='RESURRECT'`);expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(0);
 }finally{await db.close()}});
it.each([null,'envia'])('does not mistake NULL status/provider for cancellation (%s)',async provider=>{const db=await fixture();try{
 await db.query('update fulfillment_orders set shipping_provider=$1,tracking_status_code=null',[provider]);
 await db.exec(`update fulfillment_orders set carrier_name='Importación rutinaria'`);
 expect((await db.query('select * from order_shipment_history')).rows).toHaveLength(0);
 }finally{await db.close()}});
it('meets the existing MFA activation contract with four restrictive gates',async()=>{const db=await fixture();try{
 const rows=(await db.query<any>(`select polname,polpermissive from pg_policy where polrelid='public.order_shipment_history'::regclass and polname in ('mfa_select_gate','mfa_insert_gate','mfa_update_gate','mfa_delete_gate')`)).rows;
 expect(rows).toHaveLength(4);expect(rows.every(row=>row.polpermissive===false)).toBe(true);
 }finally{await db.close()}});
