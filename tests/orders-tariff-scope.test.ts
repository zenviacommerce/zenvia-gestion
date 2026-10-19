import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('returns uncapped narrow tariff inputs from the whole cost scope, with RLS and purge sanitization',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;`+readFileSync('tests/fixtures/orders-table-schema.sql','utf8'));
 await db.exec(`ALTER TABLE fulfillment_orders ENABLE ROW LEVEL SECURITY;GRANT SELECT ON fulfillment_orders TO authenticated;CREATE POLICY tenant ON fulfillment_orders TO authenticated USING(owner_id=current_setting('test.owner')::uuid);
 INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,source_channel,source_status,order_created_at,label_created_at,shipping_address,raw_payload,items,customer_name,shipping_cost_source,shipping_cost_amount,pii_purged_at)
 SELECT md5(n::text)::uuid,CASE WHEN n=205 THEN '00000000-0000-4000-8000-000000000002'::uuid ELSE '00000000-0000-4000-8000-000000000001'::uuid END,n::text,'other','SHIPPED',now(),now(),'{"country_code":"ES","postal_code":"28001","address_line_1":"SECRET"}','{"shipping_details":{"measurement":{"weight":{"value":1,"unit":"kg"}}},"secret":"SECRET"}','[]','SECRET',CASE WHEN n=204 THEN 'recorded' ELSE 'tariff_estimate' END,CASE WHEN n>=203 THEN 10 ELSE NULL END,CASE WHEN n=202 THEN now() END FROM generate_series(1,205)n;`);
 for(const name of ['20261019135436_orders_pool_status_dashboard.sql','20261019140644_orders_dashboard_record_once.sql','20261019160000_orders_dashboard_tariff_kpi_parity.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
 await db.exec(`SET ROLE authenticated;SET test.owner='00000000-0000-4000-8000-000000000001';`);
 const call=async(page:number)=>(await db.query<any>(`select orders_dashboard_page_v1(p_state=>'pending',p_page=>${page}) data`)).rows[0].data;
 const result=await call(0);expect(result.rows).toHaveLength(0);expect(result.tariffCandidates).toHaveLength(203);expect(result.kpis.transport.net).toBe(20);expect((await call(9)).tariffCandidates).toEqual(result.tariffCandidates);
 expect(JSON.stringify(result.tariffCandidates)).not.toContain('SECRET');expect(result.tariffCandidates.find((o:any)=>o.pii_purged_at).shipping_address).toEqual({});expect(result.tariffCandidates.every((o:any)=>o.raw_payload===undefined&&o.customer_name===undefined)).toBe(true);
 }finally{await db.close()}
},20000);
