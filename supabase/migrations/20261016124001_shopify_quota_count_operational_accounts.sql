create or replace function private.enforce_shopify_account_limit()
returns trigger language plpgsql security invoker set search_path='' as $$
declare quota jsonb; account_limit bigint; used_accounts bigint;
begin
  if new.provider <> 'shopify' or not new.enabled or new.status='disabled' then return new; end if;
  -- Reauthorizing an existing active identity does not consume another slot.
  if tg_op='UPDATE' then
    if old.provider='shopify' and old.owner_id=new.owner_id and old.enabled
       and old.status<>'disabled'
    then return new; end if;
  end if;
  -- Serialize reservations per workspace, including parallel OAuth starts.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shopify-plan:'||new.owner_id::text,0));
  select s.entitlements->'shopify_accounts' into quota
  from public.app_subscription_state s
  where s.workspace_id=new.owner_id and s.status in ('active','trialing');
  if quota is null then
    select pg_catalog.jsonb_build_object('enabled',e.enabled,'limit',e.limit_value) into quota
    from public.workspace_subscriptions s
    join public.plan_entitlements e on e.plan_key=s.plan_key and e.entitlement_key='shopify_accounts'
    where s.workspace_id=new.owner_id and s.status in ('active','trialing');
  end if;
  if quota is null then return new; end if;
  if coalesce((quota->>'enabled')::boolean,true)=false then
    raise exception 'Tu plan no permite conectar cuentas de Shopify.';
  end if;
  account_limit:=nullif(quota->>'limit','')::bigint;
  if account_limit is null then return new; end if;
  select count(*) into used_accounts from public.integration_accounts a
  where a.owner_id=new.owner_id and a.provider='shopify' and a.enabled
    and a.status<>'disabled'
    and a.id is distinct from new.id;
  if used_accounts>=account_limit then
    raise exception 'Has alcanzado el límite de % cuentas Shopify de tu plan.',account_limit;
  end if;
  return new;
end $$;
drop trigger if exists integration_accounts_shopify_plan_limit on public.integration_accounts;
create trigger integration_accounts_shopify_plan_limit
before insert or update of provider,owner_id,enabled,status,config on public.integration_accounts
for each row execute function private.enforce_shopify_account_limit();

