insert into pg_temp.fulfillment_orders(owner_id,source_channel,order_id,order_number,order_created_at,customer_name,shipping_address,raw_payload,items,total_amount,currency)
select '11111111-1111-4111-8111-111111111111','amazon','123-1234567-'||(1000000+i),'123-1234567-'||(1000000+i),'2026-01-01Z','SYNTHETIC-CANARY','{"country_code":"ES","name":"SYNTHETIC-CANARY"}','{"buyer":{"name":"SYNTHETIC-CANARY"}}','[{"sku":"SKU","quantity":1,"name":"SYNTHETIC-CANARY","total_price":{"value":121,"currency":"EUR"}}]',121,'EUR' from generate_series(0,9) i;
insert into pg_temp.fulfillment_orders(owner_id,source_channel,order_id,order_number,order_created_at,customer_name,total_amount,currency) values('22222222-2222-4222-8222-222222222222','amazon','123-1234567-1000000','123-1234567-1000000','2026-01-01Z','TENANT-B-SYNTHETIC',121,'EUR');
insert into pg_temp.amazon_pii_execution_gates(owner_id,reconciliation_verified_at,cycle_verified_at,deployment_reviewed_at,copies_reviewed_at) values('11111111-1111-4111-8111-111111111111',now(),now(),now(),now());
do $cancel$ declare target uuid;begin
 select id into target from pg_temp.fulfillment_orders where owner_id='11111111-1111-4111-8111-111111111111' order by order_number limit 1;
 insert into pg_temp.order_cancellation_operations(owner_id,order_id,status,reference,details,message,remote_id) values('11111111-1111-4111-8111-111111111111',target,'pending','SYNTHETIC-CANARY','{"trackingNumber":"SYNTHETIC-CANARY"}','SYNTHETIC-CANARY','SYNTHETIC-CANARY');
 begin perform pg_temp.amazon_pii_run_batch('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','pilot',10,false);raise exception 'Purge admitted active cancellation';exception when sqlstate '55000' then null;end;
 update pg_temp.order_cancellation_operations set status='confirmed';
end $cancel$;
do $legacy$ begin
 update pg_temp.fulfillment_orders set order_action_lease='55555555-5555-4555-8555-555555555555',order_action_lease_until=clock_timestamp()+interval '5 minutes' where owner_id='11111111-1111-4111-8111-111111111111';
 if (select min(extract(epoch from order_action_lease_until-clock_timestamp())) from pg_temp.fulfillment_orders where owner_id='11111111-1111-4111-8111-111111111111')<479 then raise exception 'Legacy lease shorter than Edge wall-clock';end if;
 update pg_temp.fulfillment_orders set order_action_lease=null,order_action_lease_until=null where owner_id='11111111-1111-4111-8111-111111111111';
end $legacy$;
do $lease$ declare target uuid;begin
 select id into target from pg_temp.fulfillment_orders where owner_id='11111111-1111-4111-8111-111111111111' order by order_number limit 1;
 if pg_temp.amazon_pii_claim_external_read(target,'11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555')<>'claimed' then raise exception 'Read lease claim failed';end if;
 if (select order_action_lease_until-clock_timestamp()<interval '479 seconds' from pg_temp.fulfillment_orders where id=target) then raise exception 'Read lease shorter than wall-clock';end if;
 begin
 perform pg_temp.amazon_pii_run_batch('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','pilot',10,false);
 raise exception 'Purge admitted active external read';
 exception when sqlstate '55000' then null;end;
 if exists(select 1 from pg_temp.fulfillment_orders where pii_purged_at is not null) then raise exception 'Blocked read changed rows';end if;
 update pg_temp.fulfillment_orders set order_action_lease=null,order_action_lease_until=null where id=target;
end $lease$;
do $verify$ declare dry jsonb;actual jsonb;begin
 dry:=pg_temp.amazon_pii_run_batch('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','pilot',10,true);
 if (select count(*) from pg_temp.fulfillment_orders where pii_purged_at is not null)<>0 then raise exception 'dry run wrote data';end if;
 actual:=pg_temp.amazon_pii_run_batch('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','pilot',10,false);
 if dry->>'cohort_fingerprint' is distinct from actual->>'cohort_fingerprint' or (actual->>'selected_orders')::int<>10 then raise exception 'cohort/exact ten failed';end if;
 if (select count(*) from pg_temp.fulfillment_orders where pii_purged_at is not null)<>10 then raise exception 'count mismatch';end if;
 if exists(select 1 from pg_temp.fulfillment_orders where pii_purged_at is not null and (customer_name is not null or raw_payload<>'{}' or shipping_address<>'{}' or destination_country_code<>'ES' or total_amount<>121 or currency<>'EUR' or items->0->>'sku'<>'SKU')) then raise exception 'redaction/economic invariants failed';end if;
 if (select customer_name from pg_temp.fulfillment_orders where owner_id='22222222-2222-4222-8222-222222222222')<>'TENANT-B-SYNTHETIC' then raise exception 'tenant leak';end if;
 if pg_temp.amazon_pii_run_batch('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','pilot',10,false) is distinct from actual then raise exception 'idempotence failed';end if;
 update pg_temp.fulfillment_orders set customer_name='SYNTHETIC-REHYDRATE',raw_payload='{"name":"SYNTHETIC-REHYDRATE"}' where pii_purged_at is not null;
 if exists(select 1 from pg_temp.fulfillment_orders where pii_purged_at is not null and (customer_name is not null or raw_payload<>'{}')) then raise exception 'rehydration guard failed';end if;
 if pg_temp.amazon_pii_error_code('invalid_grant SYNTHETIC-CANARY')<>'AMAZON_AUTH_INVALID_GRANT' or pg_temp.amazon_pii_error_code('Amazon orders (429): SYNTHETIC-CANARY')<>'AMAZON_QUOTA_429' then raise exception 'error classification failed';end if;
if exists(select 1 from pg_temp.fulfillment_orders where pii_purged_at is not null and pg_temp.amazon_pii_claim_external_read(id,owner_id,'55555555-5555-4555-8555-555555555555')<>'purged') then raise exception 'Purged order reopened';end if;
begin update pg_temp.fulfillment_orders set order_action_lease='55555555-5555-4555-8555-555555555555',order_action_lease_until=now()+interval '5 minutes' where pii_purged_at is not null;raise exception 'Legacy claim reopened a purged row';exception when sqlstate '55000' then null;end;
if exists(select 1 from pg_temp.order_cancellation_operations where details<>'{}' or message is not null or remote_id is not null or reference<>'amazon-purged:'||id::text) then raise exception 'Cancellation copy survived purge';end if;
end $verify$;
select jsonb_build_object('engine',version(),'synthetic_purged_orders',(select count(*) from pg_temp.fulfillment_orders where pii_purged_at is not null),'tenant_b_unchanged',(select customer_name='TENANT-B-SYNTHETIC' from pg_temp.fulfillment_orders where owner_id='22222222-2222-4222-8222-222222222222'),'buyer_rows_touched',0,'dry_run_exact_ten_idempotence_economic_rehydration_checks','passed','rolled_back',true) as verification;
