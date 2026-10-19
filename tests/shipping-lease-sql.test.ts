import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('real PostgreSQL lease excludes competing claims, lasts beyond Edge wall-clock and scopes owner',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE public.fulfillment_orders(id uuid PRIMARY KEY,owner_id uuid,source_status text,pii_purged_at timestamptz,order_action_lease uuid,order_action_lease_until timestamptz,shopify_tracking_lease_until timestamptz);
   CREATE TABLE public.order_cancellation_operations(order_id uuid,owner_id uuid,status text,kind text);
   INSERT INTO public.fulfillment_orders(id,owner_id,source_status) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Unshipped');`);
  await db.exec(readFileSync('supabase/migrations/20261019112741_shipping_creation_lease_480_seconds.sql','utf8'));
  const claim=(owner='00000000-0000-4000-8000-000000000002')=>db.query<{claimed:boolean}>(`select public.integration_claim_order_shipping('00000000-0000-4000-8000-000000000001',$1,'00000000-0000-4000-8000-000000000003') as claimed`,[owner]);
  expect((await claim('00000000-0000-4000-8000-000000000099')).rows[0].claimed).toBe(false);
  const competing=await Promise.all([claim(),claim()]);expect(competing.map(x=>x.rows[0].claimed)).toEqual([true,false]);
  expect((await db.query<{ttl:number}>(`select extract(epoch from order_action_lease_until-clock_timestamp())::float8 ttl from public.fulfillment_orders`)).rows[0].ttl).toBeGreaterThan(400);
  const acl=await db.query<{anon:boolean;authenticated:boolean;service:boolean}>(`select has_function_privilege('anon','public.integration_claim_order_shipping(uuid,uuid,uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.integration_claim_order_shipping(uuid,uuid,uuid)','EXECUTE') authenticated,has_function_privilege('service_role','public.integration_claim_order_shipping(uuid,uuid,uuid)','EXECUTE') service`);
  expect(acl.rows[0]).toEqual({anon:false,authenticated:false,service:true});
 }finally{await db.close()}
});
