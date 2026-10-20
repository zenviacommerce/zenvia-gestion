import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261020072636_pickup_reports.sql','utf8');
const dashboard=readFileSync('supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql','utf8');
const rollback=readFileSync('supabase/rollback/20261020_pickup_reports.sql','utf8');
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('executes immutable receipt SQL with tenant/MFA isolation, real labels, counts, retries, duplicate decisions and rollback',async()=>{
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
 const manifest=await db.query<any>(`SELECT p.proname, m.wrapper_hash=md5(pg_get_functiondef(p.oid)) valid, pg_get_functiondef(p.oid) wrapper, n.nspname impl_schema, has_function_privilege('authenticated',impl.oid,'EXECUTE') impl_grant FROM private.mfa_function_manifest m JOIN pg_proc p ON p.oid=m.function_oid JOIN pg_proc impl ON impl.oid=m.implementation::oid JOIN pg_namespace n ON n.oid=impl.pronamespace`);
 expect(manifest.rows).toHaveLength(5);
 for(const fn of manifest.rows){expect(fn.valid).toBe(true);expect(fn.wrapper).toContain('PERFORM public.security_mfa_assert(false)');expect(fn.impl_schema).toBe('private');expect(fn.impl_grant).toBe(false);}
 const definitions=await db.query<any>(`select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated from pg_proc where proname like 'pickup_report_%'`);
 for(const fn of definitions.rows){expect(fn.anon).toBe(false);expect(fn.proconfig).toContain('search_path=""');if(['pickup_report_selection','pickup_report_preview','pickup_report_create','pickup_report_get','pickup_report_list'].includes(fn.proname)){expect(fn.authenticated).toBe(true);expect(fn.prosecdef).toBe(true);}else expect(fn.authenticated).toBe(false);}
 const clone=(await db.query<any>(`select pg_get_functiondef('private.pickup_report_dashboard_scope(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure) def`)).rows[0].def;
 expect(clone).toBe(original.replace('FUNCTION public.orders_dashboard_page_v1(','FUNCTION private.pickup_report_dashboard_scope(').replace('FROM public.fulfillment_orders o','FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()').replace("SELECT id FROM eligible WHERE order_state='pending' AND pii_purged_at IS NULL",'SELECT id FROM eligible'));
 expect((await db.query<any>(`select pg_get_functiondef('public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure) def`)).rows[0].def).toBe(original);
 await db.exec(`SET ROLE authenticated;SET test.uid='${owner}';SET test.owner='${owner}';SET test.mfa='yes';SET test.orders='yes';`);
 const call=async(fn:string,args:unknown[]=[],casts:string[]=[])=> (await db.query<any>(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)+(casts[i]?'::'+casts[i]:'')).join(',')}) data`,args)).rows[0].data;
 const preview=(ids:string[])=>call('pickup_report_preview',[ids],['uuid[]']);
 const create=(ids:string[],req:number,duplicate=false,counts:Record<string,number>={})=>call('pickup_report_create',[ids,id(1000+req),duplicate,counts],['uuid[]','uuid','boolean','jsonb']);
 const selection=await call('pickup_report_selection',[{state:'all',channel:'shopify'},2000],['jsonb','integer']);
 expect(selection.total).toBe(69);expect(selection.ids).toHaveLength(69);expect(selection.ids).toContain(id(1));
 expect((await call('pickup_report_selection',[{state:'labelled'},10],['jsonb','integer']))).toMatchObject({ids:[],exceeded:true});
 expect((await call('pickup_report_selection',[{query:'ORDER-70'},2000],['jsonb','integer'])).ids).toEqual([id(70)]);
 const invalid=await preview([id(2),id(3),id(4),id(5),id(6),id(7)]);
 expect(invalid.canCreate).toBe(false);expect(new Set(invalid.items.map((x:any)=>x.issue))).toEqual(new Set(['missing_tracking','missing_label','cancelled_label','missing_carrier','unsupported_channel','purged_order']));
 expect(invalid.items.find((x:any)=>x.orderId===id(4)).trackingNumber).toBeNull();
 await expect(preview([id(71)])).rejects.toThrow('PICKUP_ORDERS_UNAVAILABLE');
 await expect(create([id(3)],1)).rejects.toThrow('PICKUP_INELIGIBLE_ORDERS');
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET shipping_provider='mrw',carrier_name='Marketplace other' WHERE id='${id(1)}';SET ROLE authenticated;`);
 const ready=await preview([id(1)]);expect(ready.items[0]).toMatchObject({eligible:true,packages:1,packageCountEstimated:true,trackingNumber:'REAL-1',previousReports:[]});
 // Two queued callers with the same UUID obtain exactly the same committed snapshot.
 // PGlite has one session: these test retry outcomes, not multi-session lock scheduling.
 const [receipt,retry]=await Promise.all([create([id(1)],2,false,{[id(1)]:3}),create([id(1)],2,false,{[id(1)]:3})]);
 expect(retry).toEqual(receipt);await expect(create([id(1),id(1)],2,false,{[id(1)]:3})).rejects.toThrow('PICKUP_DUPLICATE_SELECTION');expect(receipt.number).toMatch(/^REC-\d{4}-0001$/);expect(receipt.totalPackages).toBe(3);expect(receipt.createdBy).toBe(owner);
 expect(receipt.items[0]).toMatchObject({packages:3,packageCountEstimated:false});expect(receipt.sender).toMatchObject({legalName:'Sender SL',taxId:'TAX',address:'Company road, 28001 Madrid, Madrid, ES'});
 expect(JSON.stringify(receipt)).not.toContain('SECRET');expect(JSON.stringify(ready)).not.toContain('SECRET');
 await expect(create([id(1)],2,false,{[id(1)]:4})).rejects.toThrow('PICKUP_REQUEST_REUSED');
 await expect(create([id(1)],3)).rejects.toThrow('PICKUP_ALREADY_REPORTED');
 expect((await preview([id(1)])).items[0].previousReports).toEqual([receipt.number]);
 const overridden=await create([id(1)],4,true,{[id(1)]:2});expect(overridden.number).toMatch(/0002$/);
 const outcomes=await Promise.allSettled([create([id(8)],5),create([id(8)],6)]);expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(x=>x.status==='rejected')).toHaveLength(1);
 for(const count of [0,101,1.5]) await expect(create([id(9)],7,false,{[id(9)]:count})).rejects.toThrow('PICKUP_INVALID_PACKAGES');
 const afterFailure=await create([id(9)],8);expect(afterFailure.number).toMatch(/0004$/);
 // A canonical dashboard row can obtain a real label from its duplicate. Both
 // IDs cannot silently shrink the selection; membership warnings cover either ID.
 await db.exec(`RESET ROLE;INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,carrier_name,label_created_at,tracking_number,shipping_remote_id)
 VALUES('${id(72)}','${owner}','amazon:local','ORDER-10','shopify','unfulfilled',now(),'{}','[]',NULL,NULL,NULL,NULL);SET ROLE authenticated;`);
 await expect(preview([id(10),id(72)])).rejects.toThrow('PICKUP_DUPLICATE_SELECTION');
 await expect(preview([id(10),id(10)])).rejects.toThrow('PICKUP_DUPLICATE_SELECTION');
 const canonical=await preview([id(72)]);expect(canonical.items).toHaveLength(1);expect(canonical.items[0]).toMatchObject({trackingNumber:'REAL-10',carrier:'MRW',eligible:true});
 const logical=await create([id(72)],9);expect(logical.items[0].trackingNumber).toBe('REAL-10');
 await expect(create([id(10)],10)).rejects.toThrow('PICKUP_ALREADY_REPORTED');
 expect((await call('pickup_report_list',[id(10),50],['uuid','integer']))[0].id).toBe(logical.id);
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET pii_purged_at=now() WHERE id='${id(72)}';SET ROLE authenticated;`);
 const purgedSibling=await preview([id(10)]);expect(purgedSibling.items[0]).toMatchObject({eligible:false,issue:'purged_order',trackingNumber:null});
 // Selection is bounded by the complete deduplicated scope, not a dashboard page.
 await db.exec(`RESET ROLE;INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,carrier_code,label_created_at,tracking_number)
 SELECT md5('bulk-'||n)::uuid,'${owner}','bulk-'||n,'BULK-'||n,'amazon','Unshipped','2026-10-10','{}','[]','correos',now(),'BULKTRACK-'||n FROM generate_series(1,2001)n;SET ROLE authenticated;`);
 expect(await call('pickup_report_selection',[{channel:'amazon'},2000],['jsonb','integer'])).toMatchObject({ids:[],total:2001,exceeded:true});
 expect((await call('pickup_report_selection',[{channel:'shopify',country:'FR'},2000],['jsonb','integer'])).total).toBe(0);
 // A canceled canonical label must invalidate stale uncanceled duplicate labels.
 await db.exec(`RESET ROLE;INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,carrier_name,shipping_provider,label_created_at,label_cancelled_at,tracking_number,shipping_remote_id)
 VALUES('${id(73)}','${owner}','canceled-main','CANCEL-LOGICAL','amazon','Unshipped','2026-10-01','{}','[]','Marketplace Other','mrw','2026-10-01','2026-10-02','CANCELED-MRW','old-main'),
 ('${id(74)}','${owner}','stale-copy','CANCEL-LOGICAL','amazon','Unshipped','2026-09-20','{}','[]','MRW','mrw','2026-09-20',NULL,'STALE-MRW','old-copy');SET ROLE authenticated;`);
 expect((await preview([id(73)])).items[0]).toMatchObject({eligible:false,issue:'cancelled_label',trackingNumber:null});
 expect((await preview([id(74)])).items[0]).toMatchObject({eligible:false,issue:'cancelled_label',trackingNumber:null});
 await expect(create([id(74)],12)).rejects.toThrow('PICKUP_INELIGIBLE_ORDERS');
 // A genuinely new CEX label after the recorded MRW cancellation is eligible.
 await db.exec(`RESET ROLE;INSERT INTO fulfillment_orders(id,owner_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,carrier_name,carrier_code,shipping_provider,label_created_at,tracking_number,shipping_remote_id)
 VALUES('${id(75)}','${owner}','replacement-cex','CANCEL-LOGICAL','amazon','Unshipped','2026-10-03','{}','[]','Correos Express','correosexpress','sendcloud','2026-10-03','NEW-CEX','new-copy');SET ROLE authenticated;`);
 expect((await preview([id(73)])).items[0]).toMatchObject({eligible:true,trackingNumber:'NEW-CEX',carrier:'Correos Express'});
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET tracking_status_code='CANCELLED',tracking_updated_at=NULL,updated_at=NULL WHERE id='${id(74)}';SET ROLE authenticated;`);
 expect((await preview([id(73)])).items[0]).toMatchObject({eligible:false,issue:'cancelled_label'});
 // A dated tracking cancellation permits only a strictly newer replacement.
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET tracking_updated_at='2026-10-02' WHERE id='${id(74)}';SET ROLE authenticated;`);
 expect((await preview([id(73)])).items[0].eligible).toBe(true);
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET source_status='Canceled' WHERE id='${id(74)}';SET ROLE authenticated;`);
 expect((await preview([id(73)])).items[0]).toMatchObject({eligible:false,issue:'cancelled_label'});
 // Failed receipt creation has not consumed a counter; previous-year rows are
 // independent and four-digit formatting expands without truncation at 10000.
 await db.exec(`RESET ROLE;INSERT INTO private.pickup_report_counters VALUES('${owner}',2000,9999);UPDATE private.pickup_report_counters SET last_number=9999 WHERE owner_id='${owner}' AND report_year=extract(year FROM now() AT TIME ZONE 'Europe/Madrid');SET ROLE authenticated;`);
 expect((await create([id(11)],11)).number).toMatch(/-10000$/);
 // Identical Shopify order numbers in separate connected shops are independent.
 // Unknown legacy account IDs never borrow known-account labels or membership.
 await db.exec(`RESET ROLE;INSERT INTO fulfillment_orders(id,owner_id,source_integration_account_id,sendcloud_id,order_number,source_channel,source_status,order_created_at,shipping_address,items,carrier_name,shipping_provider,label_created_at,tracking_number,shipping_remote_id)
 VALUES('${id(76)}','${owner}','${id(500)}','shop-a','SHOP-1001','shopify','unfulfilled','2026-10-10','{}','[]','MRW','mrw','2026-10-10','SHOP-A-TRACK','shop-a-label'),
 ('${id(77)}','${owner}','${id(501)}','shop-b','SHOP-1001','shopify','unfulfilled','2026-10-10','{}','[]','Correos Express','sendcloud','2026-10-11','SHOP-B-TRACK','shop-b-label'),
 ('${id(78)}','${owner}',NULL,'shop-legacy','SHOP-1001','shopify','unfulfilled','2026-10-10','{}','[]',NULL,NULL,NULL,NULL,NULL);SET ROLE authenticated;`);
 const differentShops=await preview([id(76),id(77)]);expect(differentShops.items).toHaveLength(2);
 expect(differentShops.items.find((x:any)=>x.orderId===id(76))).toMatchObject({trackingNumber:'SHOP-A-TRACK',carrier:'MRW'});
 expect(differentShops.items.find((x:any)=>x.orderId===id(77))).toMatchObject({trackingNumber:'SHOP-B-TRACK',carrier:'Correos Express'});
 const shopAReport=await create([id(76)],13);
 expect((await preview([id(77)])).items[0].previousReports).toEqual([]);
 const shopBReport=await create([id(77)],14);
 expect((await call('pickup_report_list',[id(76),50],['uuid','integer'])).map((x:any)=>x.id)).toEqual([shopAReport.id]);
 expect((await call('pickup_report_list',[id(77),50],['uuid','integer'])).map((x:any)=>x.id)).toEqual([shopBReport.id]);
 expect((await preview([id(78)])).items[0]).toMatchObject({eligible:false,issue:'missing_label',trackingNumber:null,previousReports:[]});
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET label_cancelled_at='2026-10-12' WHERE id='${id(76)}';SET ROLE authenticated;`);
 expect((await preview([id(76)])).items[0].issue).toBe('cancelled_label');
 expect((await preview([id(77)])).items[0]).toMatchObject({eligible:true,trackingNumber:'SHOP-B-TRACK',previousReports:[shopBReport.number]});
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET pii_purged_at=now() WHERE id='${id(76)}';SET ROLE authenticated;`);
 expect((await preview([id(77)])).items[0].eligible).toBe(true);


 const history=await call('pickup_report_list',[id(1),50],['uuid','integer']);expect(history).toHaveLength(2);expect(history[0]).toMatchObject({totalOrders:1,carriers:['MRW']});expect(history[0].items).toBeUndefined();
 await expect(db.query('select * from public.pickup_reports')).rejects.toThrow('permission denied');
 await expect(db.query('insert into public.pickup_report_items values ($1,$2,$3,$4)',[receipt.id,owner,id(99),'tamper'])).rejects.toThrow('permission denied');
 await db.exec(`RESET ROLE;UPDATE fulfillment_orders SET tracking_number='CHANGED',carrier_name='Changed',order_number='RENAMED' WHERE id='${id(1)}';UPDATE business_settings SET legal_name='CHANGED-SENDER';SET ROLE authenticated;`);
 expect(await call('pickup_report_get',[receipt.id],['uuid'])).toEqual(receipt);
 await db.exec(`SET test.owner='${other}';SET test.uid='${other}';`);
 expect(await call('pickup_report_list')).toEqual([]);await expect(call('pickup_report_get',[receipt.id],['uuid'])).rejects.toThrow('PICKUP_REPORT_NOT_FOUND');await expect(preview([id(1)])).rejects.toThrow('PICKUP_ORDERS_UNAVAILABLE');
 expect((await call('pickup_report_selection',[{state:'all'},2000],['jsonb','integer'])).ids).toEqual([id(71)]);
 const otherReceipt=await create([id(71)],2);expect(otherReceipt.number).toMatch(/0001$/);expect(otherReceipt.id).not.toBe(receipt.id);expect(otherReceipt.createdBy).toBe(other);
 await db.exec(`SET test.orders='no';`);
 for(const [fn,args,casts] of [ ['pickup_report_list',[],[]],['pickup_report_get',[otherReceipt.id],['uuid']],['pickup_report_preview',[[id(71)]],['uuid[]']],['pickup_report_create',[[id(71)],id(2000)],['uuid[]','uuid']],['pickup_report_selection',[{}],['jsonb']]] as [string,unknown[],string[]][])
 await expect(call(fn,args,casts)).rejects.toThrow('PICKUP_ORDERS_PERMISSION_REQUIRED');
 await db.exec(`SET test.orders='yes';`);
 await db.exec(`SET test.mfa='no';`);
 for(const [fn,args,casts] of [ ['pickup_report_list',[],[]],['pickup_report_get',[receipt.id],['uuid']],['pickup_report_preview',[[id(71)]],['uuid[]']],['pickup_report_create',[[id(71)],id(2000)],['uuid[]','uuid']],['pickup_report_selection',[{}],['jsonb']]] as [string,unknown[],string[]][])
 await expect(call(fn,args,casts)).rejects.toThrow('MFA_REQUIRED');
 await db.exec(`SET test.uid='';`);await expect(call('pickup_report_list')).rejects.toThrow('AUTH_REQUIRED');
 await db.exec('RESET ROLE');
 await expect(db.query(`UPDATE pickup_reports SET number='TAMPER' WHERE id=$1`,[receipt.id])).rejects.toThrow('PICKUP_REPORT_IMMUTABLE');
 await expect(db.query(`DELETE FROM pickup_report_items WHERE report_id=$1`,[receipt.id])).rejects.toThrow('PICKUP_REPORT_IMMUTABLE');
 const source=(await db.query<any>(`select prosrc from pg_proc where oid='private.mfa_impl_pickup_report_create(uuid[],uuid,boolean,jsonb)'::regprocedure`)).rows[0].prosrc;
 expect(source).toContain('pg_advisory_xact_lock');expect(source).toContain('ORDER BY o.id FOR UPDATE OF o');expect(source).toContain('trim(o.order_number)=trim(requested.order_number)');expect(source).toContain('o.source_integration_account_id IS NOT DISTINCT FROM requested.source_integration_account_id');expect(source).toContain('ON CONFLICT(owner_id,report_year) DO UPDATE');
 await expect(db.exec(rollback)).rejects.toThrow('PICKUP_ROLLBACK_REFUSED_RECEIPTS_EXIST');
 await db.exec('ROLLBACK');
 expect((await db.query<any>('select count(*)::integer n from public.pickup_reports')).rows[0].n).toBeGreaterThan(0);
 // Only synthetic test records are discarded to exercise empty-install removal.
 await db.exec('TRUNCATE public.pickup_report_items,public.pickup_reports');
 await db.exec(rollback);
 expect((await db.query<any>(`select to_regclass('public.pickup_reports') gone, to_regclass('public.fulfillment_orders') orders`)).rows[0]).toEqual({gone:null,orders:'fulfillment_orders'});
 expect((await db.query<any>(`select pg_get_functiondef('public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure) def`)).rows[0].def).toBe(original);
 }finally{await db.close();}
},30000);
