-- Real PostgreSQL, temporary representative table, no updates to live orders.
-- Configuration/scope/queue changes below are visible only inside this transaction and rolled back.
begin;
create temporary table fulfillment_orders(id uuid primary key,owner_id uuid,order_created_at timestamptz,status text,raw_payload jsonb) on commit drop;
insert into fulfillment_orders select id,owner_id,order_created_at,'pending',jsonb_build_object('synthetic',repeat('x',5000)) from public.fulfillment_orders where owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2' limit 1;
create trigger shadow_benchmark after insert or update or delete on pg_temp.fulfillment_orders for each row execute function private.platform_shadow_capture();
insert into private.platform_shadow_source_workspaces(workspace_id) values('7461b2b7-f383-460d-b1c7-6ccbb52e42b2') on conflict do nothing;
create temporary table shadow_benchmark_times(mode text,us double precision) on commit drop;
do $$declare enabled_flag boolean;run int;i int;t timestamptz;r uuid;mode_name text;begin
 select id into r from pg_temp.fulfillment_orders limit 1;
 for run in 1..6 loop
  enabled_flag=(run%2=0);
  update private.platform_shadow_source_config set enabled=enabled_flag where singleton;
  mode_name=case when enabled_flag then 'active_no_metric_change' else 'disabled_no_metric_change' end;
  for i in 1..1100 loop
   t=clock_timestamp();update pg_temp.fulfillment_orders set status=case when status='pending' then 'processing' else 'pending' end where id=r;
   if i>100 then insert into shadow_benchmark_times values(mode_name,extract(epoch from clock_timestamp()-t)*1000000);end if;
  end loop;
 end loop;
 update private.platform_shadow_source_config set enabled=true where singleton;
 for i in 1..600 loop
  t=clock_timestamp();update pg_temp.fulfillment_orders set order_created_at=order_created_at+interval '1 microsecond' where id=r;
  if i>100 then insert into shadow_benchmark_times values('active_metric_change',extract(epoch from clock_timestamp()-t)*1000000);end if;
 end loop;
end;$$;
select mode,count(*) n,round(avg(us)::numeric,2) mean_us,round(percentile_cont(.5) within group(order by us)::numeric,2) median_us,round(percentile_cont(.95) within group(order by us)::numeric,2) p95_us from shadow_benchmark_times group by mode order by mode;
rollback;
