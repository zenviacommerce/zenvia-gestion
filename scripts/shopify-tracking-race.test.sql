begin;
do $$
declare template jsonb; test_id uuid:=gen_random_uuid(); saved text;
begin
 select to_jsonb(f) into template from fulfillment_orders f where source_channel='shopify' limit 1;
 insert into fulfillment_orders select (jsonb_populate_record(null::fulfillment_orders,template||jsonb_build_object('id',test_id,'sendcloud_id',test_id::text,'shipping_provider','mrw','shipping_remote_id','TEST-RACE','tracking_number','TEST-RACE','label_created_at',null,'label_cancelled_at',null,'raw_payload','{}'::jsonb))).*;
 update fulfillment_orders set tracking_number=null,last_synced_at=now() where id=test_id;
 select tracking_number into saved from fulfillment_orders where id=test_id;
 if saved is distinct from 'TEST-RACE' then raise exception 'Unchanged payload refresh erased tracking'; end if;
 -- A refresh read before the carrier response writes its old null tracking after it.
 update fulfillment_orders set tracking_number=null,last_synced_at=now()+interval '1 minute',raw_payload='{"remote":true}'::jsonb where id=test_id;
 select tracking_number into saved from fulfillment_orders where id=test_id;
 if saved is distinct from 'TEST-RACE' then raise exception 'Refresh erased tracking during label creation'; end if;
 update fulfillment_orders set label_created_at=now() where id=test_id;
 update fulfillment_orders set tracking_number='OLD-SHOPIFY',raw_payload='{"remote":2}'::jsonb where id=test_id;
 select tracking_number into saved from fulfillment_orders where id=test_id;
 if saved is distinct from 'TEST-RACE' then raise exception 'Refresh replaced local tracking with stale Shopify tracking'; end if;
 update fulfillment_orders set shipping_remote_id=null,label_created_at=null,label_cancelled_at=now(),tracking_number=null where id=test_id;
 select tracking_number into saved from fulfillment_orders where id=test_id;
 if saved is not null then raise exception 'Cancellation failed to clear tracking'; end if;
end $$;
rollback;
