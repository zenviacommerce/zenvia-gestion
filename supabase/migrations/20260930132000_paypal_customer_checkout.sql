alter table public.workspace_subscriptions
  add column if not exists billing_cycle text;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.workspace_subscriptions'::regclass
      and conname='workspace_subscriptions_billing_cycle_check'
  ) then
    alter table public.workspace_subscriptions
      add constraint workspace_subscriptions_billing_cycle_check
      check (billing_cycle is null or billing_cycle in ('monthly','yearly'));
  end if;
end;
$$;

create table if not exists public.workspace_billing_config(
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  provider text not null default 'manual',
  mode text,
  public_client_id text,
  updated_at timestamptz not null default now(),
  constraint workspace_billing_config_mode_check check(mode is null or mode in ('sandbox','live'))
);

alter table public.workspace_billing_config enable row level security;
revoke all on public.workspace_billing_config from anon,authenticated;

comment on table public.workspace_billing_config is
  'Public checkout configuration synchronized from ZENVIA Platform. Never contains provider secrets.';

notify pgrst,'reload schema';
