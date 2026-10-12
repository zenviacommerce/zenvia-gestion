-- Nonces for Shopify merchant authorization. Never store an OAuth code or token in this table.
create table if not exists public.shopify_oauth_states (
  state_hash text primary key,
  owner_id uuid not null,
  initiated_by uuid not null,
  shop_domain text not null,
  sync_orders boolean not null default true,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shopify_oauth_state_domain_check check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$')
);
create index if not exists shopify_oauth_states_expires_idx
  on public.shopify_oauth_states(expires_at);
alter table public.shopify_oauth_states enable row level security;
revoke all on public.shopify_oauth_states from anon, authenticated, public;
grant select, insert, update, delete on public.shopify_oauth_states to service_role;
comment on table public.shopify_oauth_states is 'Short-lived one-time hashed Shopify OAuth CSRF states, accessed by service role only.';