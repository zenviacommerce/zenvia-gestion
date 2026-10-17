create table if not exists private.amazon_pii_cron_config (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 daily_limit int not null default 100 check(daily_limit between 1 and 100),
 updated_at timestamptz not null default now()
);
insert into private.amazon_pii_cron_config(id,enabled,daily_limit) values(true,false,100) on conflict(id) do nothing;
create table if not exists private.amazon_pii_cron_receipts(
 id uuid primary key default gen_random_uuid(),
 started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 status text not null,
 selected_orders int not null default 0,
 attempted_batches int not null default 0,
 error_code text,
 result jsonb not null default '{}'::jsonb
);
alter table private.amazon_pii_cron_config enable row level security;
alter table private.amazon_pii_cron_receipts enable row level security;
revoke all on private.amazon_pii_cron_config, private.amazon_pii_cron_receipts from public,anon,authenticated;
create or replace function private.amazon_pii_cron_daily()
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='30s' set lock_timeout='500ms' as $$
declare v_cfg private.amazon_pii_cron_config%rowtype;v_owner uuid;v_limit int;v_total int:=0;v_batches int:=0;v_result jsonb;v_receipt uuid:=gen_random_uuid();v_status text:='success';v_error text;v_results jsonb:='[]'::jsonb;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('amazon-pii-cron-daily',0)) then return jsonb_build_object('status','busy','selected_orders',0);end if;
 select * into v_cfg from private.amazon_pii_cron_config where id=true;
 if not found or not v_cfg.enabled then
  insert into private.amazon_pii_cron_receipts(id,status,completed_at) values(v_receipt,'disabled',clock_timestamp());
  return jsonb_build_object('receipt_id',v_receipt,'status','disabled','selected_orders',0);
 end if;
 insert into private.amazon_pii_cron_receipts(id,status) values(v_receipt,'running');
 begin
  for v_owner in
   select owner_id from private.amazon_pii_execution_gates
   where pilot_verified_at is not null and reconciliation_verified_at is not null
   and cycle_verified_at is not null and deployment_reviewed_at is not null
   and copies_reviewed_at is not null order by owner_id
  loop
   exit when v_total>=v_cfg.daily_limit;
   loop
    exit when v_total>=v_cfg.daily_limit;
    select enabled into strict v_cfg.enabled from private.amazon_pii_cron_config where id=true;
    exit when not v_cfg.enabled;
    v_limit:=least(50,v_cfg.daily_limit-v_total);
    v_result:=public.amazon_pii_run_batch(v_owner,gen_random_uuid(),'batch',v_limit,false);
    v_batches:=v_batches+1;
    v_total:=v_total+coalesce((v_result->>'selected_orders')::int,0);
    v_results:=v_results || jsonb_build_array(jsonb_build_object('owner_id',v_owner,'selected_orders',v_result->'selected_orders','run_id',v_result->'run_id','errors',v_result->'errors'));
    exit when coalesce((v_result->>'selected_orders')::int,0)<v_limit;
   end loop;
  end loop;
 exception when others then
  v_error:=sqlstate;
  v_status:='failed';
 end;
 update private.amazon_pii_cron_receipts set completed_at=clock_timestamp(),status=v_status,selected_orders=v_total,attempted_batches=v_batches,error_code=v_error,result=jsonb_build_object('batches',v_results) where id=v_receipt;
 return jsonb_build_object('receipt_id',v_receipt,'status',v_status,'selected_orders',v_total,'attempted_batches',v_batches,'error_code',v_error);
end $$;
revoke all on function private.amazon_pii_cron_daily() from public,anon,authenticated;
