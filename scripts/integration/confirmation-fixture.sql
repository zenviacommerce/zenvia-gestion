-- Test-only minimal business schema, inside the dedicated CI database.
create role anon; create role authenticated; create role service_role;
create table fulfillment_orders(id uuid primary key,owner_id uuid not null,source_channel text default 'amazon',order_id text,source_integration_account_id uuid,source_status text,order_action_lease uuid,order_action_lease_until timestamptz,shopify_tracking_lease_until timestamptz,shipping_remote_id text,sendcloud_parcel_id bigint,tracking_number text,amazon_tracking_synced_at timestamptz,amazon_tracking_last_attempt_at timestamptz,amazon_tracking_sync_error text,amazon_tracking_sync_attempts integer default 0,fulfilled_at timestamptz);
create table integration_accounts(id uuid primary key,owner_id uuid,provider text default 'amazon',enabled boolean default true,status text default 'connected');
create table amazon_accounts(id uuid primary key,owner_id uuid,integration_account_id uuid);
create table amazon_orders(owner_id uuid,amazon_account_id uuid,amazon_order_id text,marketplace_id text,fulfillment_channel text);
create table order_cancellation_operations(id uuid primary key default gen_random_uuid(),owner_id uuid,order_id uuid,kind text,provider text,reference text,requested_by uuid,details jsonb,status text default 'submitting',message text,remote_id text,created_at timestamptz default now(),updated_at timestamptz default now());
