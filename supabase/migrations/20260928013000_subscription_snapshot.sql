create table if not exists public.app_subscription_state(
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_key text not null,
  plan_name text not null,
  plan_version integer not null check(plan_version>=1),
  status text not null check(status in ('trialing','active','past_due','cancelled','unpaid')),
  entitlements jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_subscription_state_entitlements_object_check
    check(jsonb_typeof(entitlements)='object')
);

alter table public.app_subscription_state enable row level security;

revoke all on public.app_subscription_state from anon,authenticated;
grant select on public.app_subscription_state to authenticated;
revoke insert,update,delete on public.app_subscription_state from authenticated;

drop policy if exists app_subscription_state_member_read on public.app_subscription_state;
create policy app_subscription_state_member_read
on public.app_subscription_state
for select to authenticated
using(workspace_id=(select private.app_workspace_id()));

create index if not exists app_subscription_state_plan_idx
  on public.app_subscription_state(plan_key,plan_version);

insert into public.app_subscription_state(
  workspace_id,plan_key,plan_name,plan_version,status,entitlements,synced_at,updated_at
)
select
  ws.workspace_id,
  ws.plan_key,
  coalesce(bp.name,'Interno'),
  1,
  ws.status,
  coalesce(
    jsonb_object_agg(
      pe.entitlement_key,
      jsonb_build_object(
        'enabled',pe.enabled,
        'limit',pe.limit_value,
        'config',pe.config
      )
    ) filter(where pe.entitlement_key is not null),
    '{}'::jsonb
  ),
  now(),
  now()
from public.workspace_subscriptions ws
left join public.billing_plans bp on bp.plan_key=ws.plan_key
left join public.plan_entitlements pe on pe.plan_key=ws.plan_key
where ws.workspace_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2'::uuid
group by ws.workspace_id,ws.plan_key,bp.name,ws.status
on conflict(workspace_id) do nothing;

create or replace function public.get_workspace_context()
returns table(
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  workspace_status text,
  plan_key text,
  plan_name text,
  subscription_status text,
  is_platform_admin boolean,
  entitlements jsonb
)
language sql
stable
security invoker
set search_path=''
as $$
  select
    w.id,
    w.name,
    w.slug,
    w.status,
    coalesce(ss.plan_key,ws.plan_key,'internal'),
    coalesce(ss.plan_name,bp.name,'Interno'),
    coalesce(ss.status,ws.status,'active'),
    (select private.app_is_platform_admin()),
    coalesce(
      ss.entitlements,
      coalesce(
        jsonb_object_agg(
          pe.entitlement_key,
          jsonb_build_object(
            'enabled',pe.enabled,
            'limit',pe.limit_value,
            'config',pe.config
          )
        ) filter(where pe.entitlement_key is not null),
        '{}'::jsonb
      )
    )
  from public.app_users au
  join public.workspaces w on w.id=au.workspace_id
  left join public.app_subscription_state ss on ss.workspace_id=w.id
  left join public.workspace_subscriptions ws on ws.workspace_id=w.id
  left join public.billing_plans bp on bp.plan_key=coalesce(ws.plan_key,'internal')
  left join public.plan_entitlements pe on pe.plan_key=coalesce(ws.plan_key,'internal')
  where au.user_id=(select auth.uid())
    and au.active=true
  group by
    w.id,w.name,w.slug,w.status,
    ss.plan_key,ss.plan_name,ss.status,ss.entitlements,
    ws.plan_key,ws.status,bp.name
$$;

revoke all on function public.get_workspace_context() from public,anon;
grant execute on function public.get_workspace_context() to authenticated;

notify pgrst,'reload schema';
