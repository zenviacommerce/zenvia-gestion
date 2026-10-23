import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

it('enqueues one unchanged group, both moved groups, and keeps fail-open recovery',async()=>{
 const db=new PGlite();try{
 const original=readFileSync('supabase/migrations/20261022065250_orders_incremental_classified_projection.sql','utf8');
 const trigger=original.slice(original.indexOf('CREATE FUNCTION private.orders_dashboard_projection_changed()'),original.indexOf('REVOKE ALL ON FUNCTION private.orders_dashboard_projection_changed()'));
 await db.exec(`CREATE SCHEMA private;CREATE TABLE private.orders_projection_control(singleton boolean,maintenance_enabled boolean);INSERT INTO private.orders_projection_control VALUES(true,true);
 CREATE TABLE private.orders_projection_dirty(owner_id uuid,group_key text);CREATE TABLE private.orders_projection_failures(sqlstate text,owner_id uuid,group_key text);
 CREATE TABLE fulfillment_orders(id uuid,owner_id uuid,source_channel text,order_number text,revision int);
 `+original.slice(original.indexOf('CREATE FUNCTION private.orders_dashboard_group_key('),original.indexOf('REVOKE ALL ON FUNCTION private.orders_dashboard_group_key('))+
 original.slice(original.indexOf('CREATE FUNCTION private.orders_projection_record_failure('),original.indexOf('REVOKE ALL ON FUNCTION private.orders_projection_record_failure('))+trigger+`
 CREATE TRIGGER project AFTER INSERT OR UPDATE OR DELETE ON fulfillment_orders FOR EACH ROW EXECUTE FUNCTION private.orders_dashboard_projection_changed();
 INSERT INTO fulfillment_orders VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','amazon','one',0);
 DELETE FROM private.orders_projection_dirty;`);
 // Apply the proposed replacement over the currently installed implementation.
 const replacement=readFileSync('supabase/migrations/20261022085809_orders_projection_single_enqueue.sql','utf8');
 await db.exec(replacement);
 await db.exec(`INSERT INTO fulfillment_orders VALUES('00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000002','amazon','inserted',0)`);
 expect((await db.query<any>('SELECT group_key FROM private.orders_projection_dirty')).rows).toEqual([{group_key:'amazon:inserted'}]);
 await db.exec(`DELETE FROM private.orders_projection_dirty;DELETE FROM fulfillment_orders WHERE order_number='inserted'`);
 expect((await db.query<any>('SELECT group_key FROM private.orders_projection_dirty')).rows).toEqual([{group_key:'amazon:inserted'}]);
 await db.exec('DELETE FROM private.orders_projection_dirty');
 await db.exec('UPDATE fulfillment_orders SET revision=1');
 expect((await db.query<any>('SELECT group_key FROM private.orders_projection_dirty')).rows).toEqual([{group_key:'amazon:one'}]);
 await db.exec(`DELETE FROM private.orders_projection_dirty;UPDATE fulfillment_orders SET order_number='two'`);
 expect((await db.query<any>('SELECT group_key FROM private.orders_projection_dirty ORDER BY group_key')).rows).toEqual([{group_key:'amazon:one'},{group_key:'amazon:two'}]);
 await db.exec(`DELETE FROM private.orders_projection_dirty;UPDATE fulfillment_orders SET owner_id='00000000-0000-4000-8000-000000000003'`);
 expect((await db.query<any>('SELECT count(DISTINCT owner_id)::int n FROM private.orders_projection_dirty')).rows[0].n).toBe(2);
 await db.exec(`DELETE FROM private.orders_projection_dirty;UPDATE fulfillment_orders SET revision=revision`);
 expect((await db.query<any>('SELECT count(*)::int n FROM private.orders_projection_dirty')).rows[0].n).toBe(0);
 await db.exec(`UPDATE private.orders_projection_control SET maintenance_enabled=false;UPDATE fulfillment_orders SET revision=2`);
 expect((await db.query<any>('SELECT count(*)::int n FROM private.orders_projection_dirty')).rows[0].n).toBe(0);
 await db.exec(`UPDATE private.orders_projection_control SET maintenance_enabled=true;
 CREATE FUNCTION private.fail_queue() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'forced';END$$;
 CREATE TRIGGER fail_queue BEFORE INSERT ON private.orders_projection_dirty FOR EACH ROW EXECUTE FUNCTION private.fail_queue();
 UPDATE fulfillment_orders SET revision=3;`);
 expect((await db.query<any>('SELECT revision FROM fulfillment_orders')).rows[0].revision).toBe(3);
 expect((await db.query<any>('SELECT count(*)::int n FROM private.orders_projection_failures')).rows[0].n).toBe(1);
 await db.exec(`DROP TRIGGER fail_queue ON private.orders_projection_dirty;
 CREATE FUNCTION private.fail_second() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.group_key='amazon:fail-new' THEN RAISE EXCEPTION 'second enqueue failed';END IF;RETURN NEW;END$$;
 CREATE TRIGGER fail_second BEFORE INSERT ON private.orders_projection_dirty FOR EACH ROW EXECUTE FUNCTION private.fail_second();
 UPDATE fulfillment_orders SET order_number='fail-new',revision=4;`);
 expect((await db.query<any>('SELECT revision FROM fulfillment_orders')).rows[0].revision).toBe(4);
 // The exception subtransaction also removes the first (old-group) queue entry.
 expect((await db.query<any>('SELECT count(*)::int n FROM private.orders_projection_dirty')).rows[0].n).toBe(0);
 expect((await db.query<any>('SELECT count(*)::int n FROM private.orders_projection_failures')).rows[0].n).toBe(2);
 await db.exec(`DROP TRIGGER fail_second ON private.orders_projection_dirty;UPDATE fulfillment_orders SET order_number='two';DELETE FROM private.orders_projection_dirty;DELETE FROM fulfillment_orders;`);
 expect((await db.query<any>('SELECT group_key FROM private.orders_projection_dirty')).rows).toEqual([{group_key:'amazon:two'}]);
 await db.exec(readFileSync('supabase/rollback/20261022_orders_projection_single_enqueue.sql','utf8'));
 await db.exec(`INSERT INTO fulfillment_orders VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','amazon','rollback',0);DELETE FROM private.orders_projection_dirty;UPDATE fulfillment_orders SET revision=1;`);
 expect((await db.query<any>('SELECT count(*)::int n FROM private.orders_projection_dirty')).rows[0].n).toBe(2);
 }finally{await db.close()}
},15000);
