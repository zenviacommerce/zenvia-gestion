begin;
do $$
declare owner uuid:=gen_random_uuid();j public.import_jobs;i public.import_job_items;rows jsonb;
begin
 insert into auth.users(id,email) values(owner,'orders-'||owner||'@example.invalid');
 insert into public.workspaces(id,slug,name,status) values(owner,'orders-'||owner,'Order fixture','active');
 insert into public.app_users(user_id,email,data_owner_id,workspace_id,role,active,permissions) values(owner,'test@example.invalid',owner,owner,'admin',true,'{}') on conflict(user_id) do update set data_owner_id=owner,workspace_id=owner,role='admin',active=true;
 j:=public.import_enqueue(owner,owner,'shopify_orders','orders','Order test','order-test-'||owner,null,'{}','[{"key":"one","label":"one"}]');perform * from public.import_claim_items(1);select * into i from public.import_job_items where job_id=j.id;
 rows:=jsonb_build_array(jsonb_build_object('owner_id',owner,'sendcloud_id','shopify:fixture:'||owner,'order_number','FIX-1','integration_id',0,'source_channel','shopify','total_amount',121,'currency','EUR'));
 perform public.import_order_write(i.id,i.lease_token,'upsert',rows);perform public.import_order_write(i.id,i.lease_token,'upsert',rows);
 if (select count(*) from public.fulfillment_orders where owner_id=owner)<>1 then raise exception 'Order replay duplicated records';end if;
 -- A label created after the remote snapshot must survive the upsert.
 update public.fulfillment_orders set shipping_provider='mrw',label_created_at=now(),tracking_number='LOCAL-NEW',tracking_url='https://example.invalid/local' where owner_id=owner;
 perform public.import_order_write(i.id,i.lease_token,'upsert',jsonb_set(rows||'[]'::jsonb,'{0,tracking_number}','"STALE-REMOTE"'));
 if (select tracking_number from public.fulfillment_orders where owner_id=owner)<>'LOCAL-NEW' then raise exception 'Concurrent local label overwritten';end if;
 -- Envia must inspect the current provider inside the write transaction.
 j:=public.import_enqueue(owner,owner,'envia_shipments','orders','Envia race','envia-race-'||owner,null,'{}','[{"key":"envia","label":"envia"}]');perform * from public.import_claim_items(2);select * into i from public.import_job_items where job_id=j.id;
 perform public.import_order_write(i.id,i.lease_token,'update',jsonb_build_array(jsonb_build_object('id',(select id from public.fulfillment_orders where owner_id=owner),'tracking_number','ENVIA-STALE','shipping_provider','envia')));
 if (select tracking_number from public.fulfillment_orders where owner_id=owner)<>'LOCAL-NEW' then raise exception 'Envia overwritten different provider';end if;
 update public.app_users set active=false where user_id=owner;
 begin
 perform public.import_order_write(i.id,i.lease_token,'update',jsonb_build_array(jsonb_build_object('id',(select id from public.fulfillment_orders where owner_id=owner),'total_amount',999)));raise exception 'Revoked order writer mutated records';
 exception when others then if sqlerrm='Revoked order writer mutated records' then raise;end if;end;
 if (select total_amount from public.fulfillment_orders where owner_id=owner)<>121 then raise exception 'Mutation not rolled back';end if;
end $$;
rollback;
