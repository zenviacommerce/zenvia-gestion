-- Run against a database with at least one Shopify order. All fixtures roll back.
begin;
do $$
declare
 template jsonb; tenant uuid; prefix text:=gen_random_uuid()::text;
 pending_id uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid(); n int;
begin
 select to_jsonb(f)||jsonb_build_object('shipping_remote_id',null,'sendcloud_parcel_id',null,'sendcloud_shipment_id',null),owner_id into template,tenant from fulfillment_orders f where source_channel='shopify' limit 1;
 if template is null then raise exception 'Missing Shopify fixture'; end if;
 for n in 1..101 loop
  insert into fulfillment_orders select (jsonb_populate_record(null::fulfillment_orders,template||jsonb_build_object('id',gen_random_uuid(),'sendcloud_id',prefix||n,'label_created_at',now(),'tracking_number','TEST','shopify_tracking_synced_number','TEST','shopify_tracking_synced_at',now(),'shopify_tracking_last_attempt_at',now()-interval '1 day'))).*;
 end loop;
 insert into fulfillment_orders select (jsonb_populate_record(null::fulfillment_orders,template||jsonb_build_object('id',pending_id,'sendcloud_id',prefix||'pending','label_created_at',now(),'tracking_number','TEST','shopify_tracking_synced_number',null,'shopify_tracking_synced_at',null,'shopify_tracking_last_attempt_at',now()-interval '10 minutes'))).*;
 if not exists(select 1 from integration_shopify_pending_shipments(tenant) where id=pending_id) then raise exception 'Pending order starved'; end if;
 select count(*) into n from integration_shopify_claim_shipment(pending_id,tenant,lease);
 if n<>1 then raise exception 'Claim failed'; end if;
 select count(*) into n from integration_shopify_claim_shipment(pending_id,tenant,gen_random_uuid());
 if n<>0 then raise exception 'Duplicate claim'; end if;
 select count(*) into n from integration_shopify_claim_shipment(pending_id,gen_random_uuid(),gen_random_uuid());
 if n<>0 then raise exception 'Cross tenant claim'; end if;
 if has_function_privilege('authenticated','integration_shopify_claim_shipment(uuid,uuid,uuid)','EXECUTE') then raise exception 'Public claim permission'; end if;
end $$;
rollback;
