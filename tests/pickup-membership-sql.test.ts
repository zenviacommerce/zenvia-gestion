import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261020072636_pickup_reports.sql','utf8');
const dashboard=readFileSync('supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql','utf8');
const rollback=readFileSync('supabase/rollback/20261020_pickup_reports.sql','utf8');
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('filters pickup membership before pagination and IDs with tenant/MFA isolation and rollback',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA private;
 CREATE TABLE private.mfa_function_manifest(signature text primary key,function_oid oid not null,implementation regprocedure not null,original_definition text not null,wrapper_hash text not null);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
 CREATE FUNCTION private.app_has_permission(text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT current_setting('test.orders',true)='yes'$$;
 CREATE FUNCTION private.app_workspace_owner_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.owner',true),'')::uuid$$;
 CREATE FUNCTION public.security_mfa_assert(boolean) RETURNS void LANGUAGE plpgsql STABLE AS $$BEGIN IF current_setting('test.mfa',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='42501'; END IF;END$$;
 CREATE TABLE public.business_settings(owner_id uuid,legal_name text,tax_id text,address_line1 text,address_line2 text,postal_code text,city text,province text,country_code text,email text,phone text,iban text);
 INSERT INTO business_settings VALUES('${owner}','Sender SL','TAX','Company road',NULL,'28001','Madrid','Madrid','ES','office@example.test','123','SECRET-IBAN'),('${other}','Other Sender','OTHER-TAX','Other Company Road',NULL,'08001','Barcelona','Barcelona','ES',NULL,NULL,NULL);
 `+readFileSync('tests/fixtures/orders-table-schema.sql','utf8'));
 await db.exec(`ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA private TO authenticated;GRANT SELECT ON fulfillment_orders TO authenticated;
 CREATE POLICY tenant ON fulfillment_orders TO authenticated USING(owner_id=private.app_workspace_owner_id() AND private.app_has_permission('orders'));
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,destination_country_code,carrier_code,carrier_name,label_created_at,tracking_number,shipping_remote_id,customer_name,customer_email,raw_payload)
 SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${owner}','order-'||n,'ORDER-'||n,'shopify','unfulfilled','2026-10-10','{"address_line_1":"SECRET-BUYER-ADDRESS"}','[]','ES','mrw','MRW',now(),'REAL-'||n,'remote-'||n,'SECRET-BUYER','SECRET-BUYER-EMAIL','{"secret":"SECRET-PAYLOAD"}' FROM generate_series(1,70)n;
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,carrier_name,label_created_at,tracking_number)
 VALUES('${id(71)}','${other}','foreign','FOREIGN','amazon','Unshipped',now(),'{}','[]','Correos',now(),'OTHER-TRACK');
 UPDATE fulfillment_orders SET tracking_number=NULL WHERE id='${id(2)}';
 UPDATE fulfillment_orders SET label_created_at=NULL,shipping_remote_id=NULL WHERE id='${id(3)}';
 UPDATE fulfillment_orders SET label_cancelled_at=now()+interval '1 second' WHERE id='${id(4)}';
 UPDATE fulfillment_orders SET carrier_name=NULL,carrier_code=NULL WHERE id='${id(5)}';
 UPDATE fulfillment_orders SET source_channel='manual' WHERE id='${id(6)}';
 UPDATE fulfillment_orders SET pii_purged_at=now() WHERE id='${id(7)}';`);
 await db.exec(dashboard);
 const original=(await db.query<any>(`select pg_get_functiondef('public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure) def`)).rows[0].def;
 await db.exec(migration);

 expect((await db.query<any>(`select md5(pg_get_functiondef('private.pickup_report_dashboard_scope(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure)) hash`)).rows[0].hash).toBe('943ab6c033c812a159a52d0737df80dc');
 await db.exec(readFileSync('supabase/migrations/20261020095712_pickup_dashboard_membership.sql','utf8'));
 await db.exec(`SET test.uid='${owner}';SET test.owner='${owner}';SET test.mfa='yes';SET test.orders='yes';
 INSERT INTO public.pickup_reports(id,owner_id,request_id,request_fingerprint,number,created_by,snapshot)
 VALUES('${id(900)}','${owner}','${id(901)}','{}','REC-2026-0001','${owner}','{}');
 INSERT INTO public.pickup_report_items(report_id,owner_id,order_id,order_key) VALUES('${id(900)}','${owner}','${id(1)}','shopify:legacy:ORDER-1');
 SET ROLE authenticated;`);
 const page=async(filter:string,extra='')=>(await db.query<any>(`SELECT public.orders_dashboard_pickup_v1(p_state=>'labelled',p_page_size=>1,p_pickup_report=>$1 ${extra}) data`,[filter])).rows[0].data;
 const inside=await page('in');expect(inside.total).toBe(1);expect(inside.rows[0].pickup_reports).toEqual([{id:id(900),number:'REC-2026-0001'}]);
 const none=await page('none');expect(none.total).toBeGreaterThan(25);expect(none.rows[0].pickup_reports).toEqual([]);
 const selected=await page('in',',p_selection_ids_only=>true,p_selection_all=>true');expect(selected.ids).toEqual([id(1)]);
 const old=await db.query<any>(`SELECT public.orders_dashboard_page_v1(p_state=>'labelled',p_page_size=>1) data`);
 expect((await page('all')).total).toBe(old.rows[0].data.total);
 await expect(page('wrong')).rejects.toThrow('PICKUP_INVALID_FILTER');
 await db.exec(`SET test.mfa='no';`);await expect(page('all')).rejects.toThrow('MFA_REQUIRED');
 await db.exec(`SET test.mfa='yes';SET test.owner='${other}';`);expect((await page('in')).total).toBe(0);
 await db.exec(`RESET ROLE;`);
 const guard=await db.query<any>(`SELECT wrapper_hash=md5(pg_get_functiondef(function_oid)) ok FROM private.mfa_function_manifest WHERE signature LIKE '%orders_dashboard_pickup_v1%'`);expect(guard.rows).toEqual([{ok:true}]);
 await db.exec(readFileSync('supabase/rollback/20261020_pickup_dashboard_membership.sql','utf8'));
 expect((await db.query<any>(`SELECT to_regprocedure('public.orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)') gone`)).rows[0].gone).toBeNull();
 }finally{await db.close()}
},30000);
