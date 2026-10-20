-- Service-only receipts contain no customer payload; analytics retains only fiscal data.
create table public.shopify_order_ingestion_trace(
 owner_id uuid not null references public.workspaces(id) on delete cascade,
 integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
 order_id text not null check(order_id ~ '^[0-9]{1,30}$'),
 shopify_created_at timestamptz,first_received_at timestamptz not null default clock_timestamp(),
 operational_imported_at timestamptz,analytics_imported_at timestamptz,
 operational_source text,analytics_source text,
 primary key(integration_account_id,order_id)
);
create table public.shopify_order_events(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.workspaces(id) on delete cascade,
 integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
 delivery_id text not null check(length(delivery_id) between 1 and 200),
 order_id text not null check(order_id ~ '^[0-9]{1,30}$'),
 topic text not null check(topic in ('orders/create','orders/updated')),
 shopify_created_at timestamptz,received_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,next_attempt_at timestamptz not null default clock_timestamp(),attempts integer not null default 0,last_error text,
 unique(integration_account_id,delivery_id)
);
create index shopify_events_pending on public.shopify_order_events(integration_account_id,received_at) where completed_at is null;
create table public.shopify_order_sync_state(
 integration_account_id uuid primary key references public.integration_accounts(id) on delete cascade,
 owner_id uuid not null references public.workspaces(id) on delete cascade,
 lease uuid,lease_until timestamptz,last_poll_started_at timestamptz,last_completed_at timestamptz,
 webhook_checked_at timestamptz,webhook_subscriptions jsonb,webhook_error text,last_error text
);
alter table public.shopify_order_ingestion_trace enable row level security;
alter table public.shopify_order_events enable row level security;
alter table public.shopify_order_sync_state enable row level security;
revoke all on public.shopify_order_ingestion_trace,public.shopify_order_events,public.shopify_order_sync_state from public,anon,authenticated;
grant all on public.shopify_order_ingestion_trace,public.shopify_order_events,public.shopify_order_sync_state to service_role;

create function public.shopify_record_order_ingestion(owner uuid,store uuid,remote_order_id text,remote_created_at timestamptz,destination text,source text,received_at timestamptz default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if destination not in ('operational','analytics') or source not in ('webhook','cron','browser','manual') then raise exception 'Invalid ingestion metadata';end if;
 if not exists(select 1 from public.integration_accounts a join public.workspaces w on w.id=a.owner_id where a.id=store and a.owner_id=owner and a.provider='shopify' and a.enabled and a.status<>'disabled' and w.status in ('active','trialing')) then raise exception 'Invalid Shopify scope' using errcode='42501';end if;
 insert into public.shopify_order_ingestion_trace(owner_id,integration_account_id,order_id,shopify_created_at,first_received_at,operational_imported_at,analytics_imported_at,operational_source,analytics_source)
 values(owner,store,remote_order_id,remote_created_at,coalesce(received_at,clock_timestamp()),case when destination='operational' then clock_timestamp() end,case when destination='analytics' then clock_timestamp() end,case when destination='operational' then source end,case when destination='analytics' then source end)
 on conflict(integration_account_id,order_id) do update set
 first_received_at=least(shopify_order_ingestion_trace.first_received_at,excluded.first_received_at),
 shopify_created_at=coalesce(shopify_order_ingestion_trace.shopify_created_at,excluded.shopify_created_at),
 operational_imported_at=coalesce(shopify_order_ingestion_trace.operational_imported_at,excluded.operational_imported_at),
 analytics_imported_at=coalesce(shopify_order_ingestion_trace.analytics_imported_at,excluded.analytics_imported_at),
 operational_source=coalesce(shopify_order_ingestion_trace.operational_source,excluded.operational_source),
 analytics_source=coalesce(shopify_order_ingestion_trace.analytics_source,excluded.analytics_source);
end;$$;
create function public.shopify_order_sync_acquire(owner uuid,store uuid,lease_token uuid,poll boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.integration_accounts a join public.workspaces w on w.id=a.owner_id where a.id=store and a.owner_id=owner and a.provider='shopify' and a.enabled and a.status<>'disabled' and a.credential_source<>'derived' and w.status in ('active','trialing')) then raise exception 'Invalid Shopify scope' using errcode='42501';end if;
 insert into public.shopify_order_sync_state(integration_account_id,owner_id) values(store,owner) on conflict do nothing;
 update public.shopify_order_sync_state s set lease=lease_token,lease_until=clock_timestamp()+interval '240 seconds',last_poll_started_at=case when poll then clock_timestamp() else s.last_poll_started_at end
 where s.integration_account_id=store and s.owner_id=owner and (s.lease_until is null or s.lease_until<clock_timestamp()) and (not poll or s.last_poll_started_at is null or s.last_poll_started_at<clock_timestamp()-interval '2 minutes');
 return found;
end;$$;
create function public.shopify_order_sync_release(owner uuid,store uuid,lease_token uuid,success boolean) returns void
language sql security invoker set search_path='' as $$
 update public.shopify_order_sync_state s set lease=null,lease_until=null,last_completed_at=case when success then clock_timestamp() else s.last_completed_at end where s.integration_account_id=store and s.owner_id=owner and s.lease=lease_token;
$$;
revoke all on function public.shopify_record_order_ingestion(uuid,uuid,text,timestamptz,text,text,timestamptz),public.shopify_order_sync_acquire(uuid,uuid,uuid,boolean),public.shopify_order_sync_release(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.shopify_record_order_ingestion(uuid,uuid,text,timestamptz,text,text,timestamptz),public.shopify_order_sync_acquire(uuid,uuid,uuid,boolean),public.shopify_order_sync_release(uuid,uuid,uuid,boolean) to service_role;

-- Deployment scheduling and Realtime publication follow backend deployment, separately.
-- Atomic defense against an older browser request racing a webhook snapshot.
create function public.shopify_reject_stale_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.source_channel='shopify' and new.source_channel='shopify' and old.order_updated_at is not null and new.order_updated_at<old.order_updated_at then return old;end if;
 return new;
end;$$;
revoke all on function public.shopify_reject_stale_snapshot() from public,anon,authenticated;
create trigger zz_shopify_reject_stale_snapshot before update on public.fulfillment_orders for each row execute function public.shopify_reject_stale_snapshot();
create function public.shopify_commit_orders_cursor(owner uuid,store uuid,checkpoint_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if checkpoint_at is null or checkpoint_at>clock_timestamp()+interval '1 minute' then raise exception 'Invalid Shopify checkpoint';end if;
 update public.integration_accounts a set config=jsonb_set(coalesce(a.config,'{}'::jsonb),'{shopify_orders_cursor_at}',to_jsonb(greatest(checkpoint_at,nullif(a.config->>'shopify_orders_cursor_at','')::timestamptz))),last_success_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp()
 where a.id=store and a.owner_id=owner and a.provider='shopify' and a.enabled and a.status<>'disabled' and a.config->>'syncOrders' is distinct from 'false'
 and exists(select 1 from public.workspaces w where w.id=owner and w.status in ('active','trialing'));
 return found;
end;$$;
revoke all on function public.shopify_commit_orders_cursor(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.shopify_commit_orders_cursor(uuid,uuid,timestamptz) to service_role;

-- Existing analytics RLS remains authoritative; publication carries no service-only tables.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shopify_analytics_orders') then
  alter publication supabase_realtime add table public.shopify_analytics_orders;
 end if;
end $$;
