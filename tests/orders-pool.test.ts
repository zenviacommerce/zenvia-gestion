import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261019113000_orders_pool_status_dashboard.sql','utf8');
it('real SQL pages 120 matches while aggregating the whole RLS tenant scope',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`+readFileSync('tests/fixtures/orders-table-schema.sql','utf8'));
 await db.exec(`ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;GRANT SELECT ON fulfillment_orders TO authenticated;
 CREATE POLICY tenant ON fulfillment_orders TO authenticated USING(owner_id=current_setting('test.owner')::uuid);
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,order_updated_at,total_amount,currency,shipping_address,raw_payload,items,destination_country_code)
 SELECT md5(n::text)::uuid,'00000000-0000-4000-8000-000000000001',n::text,'ORDER-'||n,'amazon',CASE WHEN n<=120 THEN 'UNSHIPPED' ELSE 'SHIPPED' END,now(),now(),121,'EUR','{}',jsonb_build_object('shipping_details',jsonb_build_object('measurement',jsonb_build_object('weight',jsonb_build_object('value',n,'unit','kg')))),jsonb_build_array(jsonb_build_object('sku','SKU-'||n,'quantity',n)),'ES' FROM generate_series(1,130)n;
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items)
 VALUES(md5('other')::uuid,'00000000-0000-4000-8000-000000000002','other','OTHER-TENANT','amazon','UNSHIPPED',now(),'{}','[]');`);
 await db.exec(migration);
 const flags=await db.query<any>(`select prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') admitted from pg_proc where proname='orders_dashboard_page_v1'`);expect(flags.rows[0]).toMatchObject({prosecdef:false,anon:false,admitted:true});
 await db.exec(`SET ROLE authenticated;SET test.owner='00000000-0000-4000-8000-000000000001';`);
 const call=async(args='')=>(await db.query<any>(`select public.orders_dashboard_page_v1(${args}) data`)).rows[0].data;
 const first=await call();expect(first.rows).toHaveLength(25);expect(first.total).toBe(120);expect(first.kpis.pending).toBe(120);expect(first.kpis.shipped).toBe(10);expect(first.kpis.sales.gross).toBe(15730);expect(first.facets.countries).toContain('ES');expect(JSON.stringify(first)).not.toContain('OTHER-TENANT');expect(first.rows[0].raw_payload).toBeUndefined();
 const byWeight=await call("p_sort_key=>'weight',p_sort_direction=>'desc'");expect(byWeight.rows[0].order_number).toBe('ORDER-120');
 const byUnits=await call("p_sort_key=>'units',p_sort_direction=>'desc'");expect(byUnits.rows[0].order_number).toBe('ORDER-120');
 const next=await call('p_page=>1');expect(next.total).toBe(120);expect(next.rows).toHaveLength(25);expect(next.rows.some((x:any)=>first.rows.some((y:any)=>x.id===y.id))).toBe(false);expect(next.kpis).toEqual(first.kpis);
 const query=await call("p_query=>'SKU-99'");expect(query.total).toBe(1);expect(query.kpis.pending).toBe(1);
 const country=await call("p_country=>'ES'");expect(country.total).toBe(120);
 const last=await call('p_page=>4');expect(last.rows).toHaveLength(20);const bounded=await call('p_page_size=>1000');expect(bounded.pageSize).toBe(100);expect(bounded.rows).toHaveLength(100);
 await db.exec(`RESET ROLE;
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,total_amount,currency,raw_payload,label_created_at)
 VALUES(md5('legacy')::uuid,'00000000-0000-4000-8000-000000000001','carrier','SAME','amazon','UNSHIPPED',now(),'{}','[]',null,null,'{}',now()),
 (md5('direct')::uuid,'00000000-0000-4000-8000-000000000001','amazon:direct','SAME','amazon','UNSHIPPED',now(),'{"country_code":"ES"}','[{"sku":"FALLBACK","quantity":2}]',121,'EUR','{}',null);
 SET ROLE authenticated;`);
 const merged=await call("p_state=>'all',p_query=>'SAME'");expect(merged.total).toBe(1);expect(merged.kpis.sales.gross).toBe(121);expect(merged.rows[0].items[0].sku).toBe('FALLBACK');expect(merged.rows[0].shipping_address.country_code).toBe('ES');
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET pii_purged_at=now(),destination_country_code='ES' WHERE id=md5('direct')::uuid;UPDATE fulfillment_orders SET customer_name='SYNTHETIC-BUYER' WHERE id=md5('legacy')::uuid;
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,tracking_status_code,tracking_status_message,tracking_number,shipping_remote_id,shipping_address,raw_payload,items)
 VALUES(md5('incident')::uuid,'00000000-0000-4000-8000-000000000001','incident','INCIDENT','amazon','SHIPPED',now(),'SHIPPED','Delivery delayed','TRACK','REMOTE','{}','{}','[]');SET ROLE authenticated;`);
 const purged=await call("p_state=>'all',p_query=>'SAME',p_country=>'ES'");expect(purged.total).toBe(1);expect(purged.rows[0].pii_purged_at).toBeTruthy();expect(purged.rows[0].customer_name).toBeNull();expect(purged.rows[0].shipping_address).toEqual({});expect(purged.kpis.sales.gross).toBe(121);expect(JSON.stringify(purged)).not.toContain('SYNTHETIC-BUYER');
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET items='[{"sku":{"buyerName":"SYNTHETIC-PRIVATE"},"quantity":"SYNTHETIC-PRIVATE","unit_price":{"value":"SYNTHETIC-PRIVATE"}}]' WHERE id=md5('legacy')::uuid;SET ROLE authenticated;`);
 const guarded=await call("p_state=>'all',p_query=>'SAME'");expect(JSON.stringify(guarded)).not.toContain('SYNTHETIC-PRIVATE');
 const incident=await call("p_state=>'all',p_query=>'INCIDENT',p_tracking=>'issue'");expect(incident.total).toBe(1);expect((await call("p_state=>'all',p_query=>'INCIDENT',p_tracking=>'transit'")).total).toBe(0);
 await db.exec(`RESET ROLE;
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,sendcloud_remote_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,raw_payload)
 VALUES(md5('weight-first')::uuid,'00000000-0000-4000-8000-000000000001','amazon:weighted',null,'WEIGHT-PARITY','amazon','UNSHIPPED','2026-01-01','{}','[]','{"shipping_details":{"measurement":{"weight":{"value":2,"unit":"kg"}}}}'),
 (md5('weight-newer')::uuid,'00000000-0000-4000-8000-000000000001','amazon:empty',null,'WEIGHT-PARITY','amazon','UNSHIPPED','2026-02-01','{}','[]','{}'),
 (md5('remote-first')::uuid,'00000000-0000-4000-8000-000000000001','amazon:remote','carrier-remote','REMOTE-PARITY','amazon','UNSHIPPED','2026-01-01','{}','[]','{}'),
 (md5('remote-newer')::uuid,'00000000-0000-4000-8000-000000000001','amazon:local',null,'REMOTE-PARITY','amazon','UNSHIPPED','2026-02-01','{}','[]','{}');SET ROLE authenticated;`);
 const weighted=await call("p_state=>'all',p_query=>'WEIGHT-PARITY'");expect(weighted.rows[0].sendcloud_id).toBe('amazon:weighted');
 const remote=await call("p_state=>'all',p_query=>'REMOTE-PARITY'");expect(remote.rows[0].sendcloud_id).toBe('amazon:remote');
 await db.exec(`SET test.owner='00000000-0000-4000-8000-000000000002';`);const other=await call();expect(other.total).toBe(1);expect(other.rows[0].order_number).toBe('OTHER-TENANT');expect(other.kpis.pending).toBe(1);
 }finally{await db.close()}
},20000);

it('selects the complete filtered eligible set under RLS and retrieves only live selected rows',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;`+readFileSync('tests/fixtures/orders-table-schema.sql','utf8'));
 await db.exec(`ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;GRANT SELECT ON fulfillment_orders TO authenticated;
 CREATE POLICY tenant ON fulfillment_orders TO authenticated USING(owner_id=current_setting('test.owner')::uuid);
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,destination_country_code,carrier_code)
 SELECT md5('selection-'||n)::uuid,'00000000-0000-4000-8000-000000000001','selection-'||n,'SELECT-'||n,'shopify','unfulfilled','2026-10-10','{}','[]','ES','mrw' FROM generate_series(1,70)n;
 UPDATE fulfillment_orders SET pii_purged_at=now() WHERE order_number='SELECT-64';
 UPDATE fulfillment_orders SET label_created_at=now() WHERE order_number='SELECT-65';
 UPDATE fulfillment_orders SET source_status='cancelled' WHERE order_number='SELECT-66';
 UPDATE fulfillment_orders SET destination_country_code='FR' WHERE order_number='SELECT-67';
 UPDATE fulfillment_orders SET carrier_code='correos' WHERE order_number='SELECT-68';
 UPDATE fulfillment_orders SET source_channel='manual' WHERE order_number='SELECT-69';
 UPDATE fulfillment_orders SET order_created_at='2026-09-01' WHERE order_number='SELECT-70';
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,destination_country_code,carrier_code)
 VALUES(md5('foreign-selection')::uuid,'00000000-0000-4000-8000-000000000002','foreign','SELECT-FOREIGN','shopify','unfulfilled','2026-10-10','{}','[]','ES','mrw');
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,destination_country_code,carrier_code)
 VALUES(md5('selection-duplicate')::uuid,'00000000-0000-4000-8000-000000000001','selection-duplicate','SELECT-1','shopify','unfulfilled','2026-09-01','{}','[]','ES','mrw');`);
 await db.exec(migration);
 await db.exec(`SET ROLE authenticated;SET test.owner='00000000-0000-4000-8000-000000000001';`);
 const filters="p_from=>'2026-10-01',p_to=>'2026-10-19',p_state=>'all',p_channel=>'shopify',p_query=>'SELECT-',p_tracking=>'none',p_country=>'ES',p_carrier=>'mrw'";
 const call=async(args='')=>(await db.query<any>(`select public.orders_dashboard_page_v1(${args}) data`)).rows[0].data;
 const select=async(extra='')=>(await db.query<any>(`select public.orders_dashboard_selection_v1(${filters}${extra}) data`)).rows[0].data;
 const page=await call(filters);expect(page.rows).toHaveLength(25);expect(page.total).toBe(66);expect(page.selectableTotal).toBe(63);
 const selection=await select();expect(selection).toEqual({ids:[...selection.ids].sort(),total:63,limit:2000,exceeded:false});expect(selection.ids).toHaveLength(63);
 const expected=(await db.query<any>(`SELECT id FROM fulfillment_orders WHERE order_number ~ '^SELECT-[0-9]+$' AND substring(order_number from 8)::int<=63 AND sendcloud_id<>'selection-duplicate' ORDER BY id`)).rows.map(x=>x.id);expect(selection.ids).toEqual(expected);
 expect(await select(',p_limit=>62')).toEqual({ids:[],total:63,limit:62,exceeded:true});expect((await select(',p_limit=>99999')).limit).toBe(2000);expect((await select(',p_limit=>0')).limit).toBe(1);
 expect((await call("p_selected_ids=>ARRAY[]::uuid[]")).total).toBe(0);
 const ids=`ARRAY[${selection.ids.map((id:string)=>`'${id}'::uuid`).join(',')}]`;
 const pages=await Promise.all([0,1,2].map(n=>call(`p_selected_ids=>${ids},p_page=>${n}`)));expect(pages.map(p=>p.rows.length)).toEqual([25,25,13]);expect(pages.map(p=>p.total)).toEqual([63,63,63]);expect(pages.flatMap(p=>p.rows.map((r:any)=>r.id)).sort()).toEqual(selection.ids);
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET label_created_at=now() WHERE id='${selection.ids[0]}';UPDATE fulfillment_orders SET pii_purged_at=now() WHERE id='${selection.ids[1]}';SET ROLE authenticated;`);
 const live=await call(`p_state=>'all',p_selected_ids=>${ids},p_page_size=>100`);expect(live.total).toBe(61);expect(live.rows.some((r:any)=>selection.ids.slice(0,2).includes(r.id))).toBe(false);
 await expect(call(`p_selected_ids=>array_fill('${selection.ids[0]}'::uuid,ARRAY[2001])`)).rejects.toThrow();
 await db.exec(`SET test.owner='00000000-0000-4000-8000-000000000002';`);expect((await select()).ids).toEqual([(await db.query<any>(`SELECT md5('foreign-selection')::uuid id`)).rows[0].id]);expect((await call(`p_selected_ids=>${ids}`)).rows).toEqual([]);
 await db.exec('RESET ROLE');const flags=await db.query<any>(`SELECT proname,prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') admitted,has_function_privilege('service_role',oid,'EXECUTE') service FROM pg_proc WHERE proname IN ('orders_dashboard_page_v1','orders_dashboard_selection_v1')`);expect(flags.rows).toHaveLength(2);for(const flag of flags.rows)expect(flag).toMatchObject({prosecdef:false,anon:false,admitted:true,service:true});
 }finally{await db.close()}
},20000);
