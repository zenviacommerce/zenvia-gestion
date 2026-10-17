-- LOCAL PREPARATION ONLY. No existing-row updates, cron, Storage or HTTP.
-- Gates deliberately start empty. Deploy schema + compatible producers/readers first.
create table private.amazon_pii_execution_gates(
 owner_id uuid primary key,
 reconciliation_verified_at timestamptz,
 cycle_verified_at timestamptz,
 deployment_reviewed_at timestamptz,
 copies_reviewed_at timestamptz,
 pilot_run_id uuid,
 pilot_verified_at timestamptz
);
create table private.amazon_pii_batch_runs(
 owner_id uuid not null,run_id uuid not null,mode text not null,batch_limit int not null,
 policy_version text not null,started_at timestamptz not null,result jsonb not null,
 primary key(owner_id,run_id)
);
alter table private.amazon_pii_execution_gates enable row level security;
alter table private.amazon_pii_batch_runs enable row level security;
revoke all on private.amazon_pii_execution_gates,private.amazon_pii_batch_runs from public,anon,authenticated;
grant select,insert,update on private.amazon_pii_execution_gates,private.amazon_pii_batch_runs to service_role;

-- Only controls read by the real sync worker survive. Never retain arbitrary values
-- merely because their key resembles a control. Dates are canonical ISO strings.
create function private.amazon_pii_job_controls(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
 'mode',case when p->>'mode' in ('initial','hourly','manual','reconcile') then p->>'mode' end,
 'snapshot',case when p->>'snapshot'='current' then 'current' end,
 'high_water_mark',case when p->>'high_water_mark' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then p->>'high_water_mark' end,
 'superseded',case when jsonb_typeof(p->'superseded')='boolean' then p->'superseded' end,
 'superseded_at',case when p->>'superseded_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then p->>'superseded_at' end))
$$;
create function private.amazon_pii_checkpoint(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
 'last_job_id',case when p->>'last_job_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p->>'last_job_id' end,
 'rows_processed',case when jsonb_typeof(p->'rows_processed')='number' then p->'rows_processed' end,
 'queued_jobs',case when jsonb_typeof(p->'queued_jobs')='number' then p->'queued_jobs' end))
$$;
create function private.guard_amazon_pii_controls() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='amazon_sync_jobs' then
   new.payload:=private.amazon_pii_job_controls(new.payload);
   if new.last_error is not null then new.last_error:='AMAZON_SYNC_ERROR';end if;
 else
   new.checkpoint:=private.amazon_pii_checkpoint(new.checkpoint);
   if tg_table_name='amazon_sync_runs' then
     if new.error_message is not null then new.error_message:='AMAZON_SYNC_ERROR';end if;
   end if;
 end if;
 return new;
end $$;
create trigger zzzz_amazon_pii_control_guard before insert or update on public.amazon_sync_jobs for each row execute function private.guard_amazon_pii_controls();
create trigger zzzz_amazon_pii_control_guard before insert or update on public.amazon_sync_runs for each row execute function private.guard_amazon_pii_controls();
create trigger zzzz_amazon_pii_control_guard before insert or update on public.amazon_sync_state for each row execute function private.guard_amazon_pii_controls();

-- Historical job/run/state controls have no per-order foreign key. Scrub them as
-- an explicit separate, owner-scoped minimization step, at most p_limit per table.
-- It never touches invoice, finance, audit, support or Storage tables.
create function public.amazon_pii_scrub_control_copies(p_owner uuid,p_limit int default 50,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='3s' set lock_timeout='500ms' as $$
declare v_jobs uuid[];v_runs uuid[];v_states uuid[];
begin
 if p_owner is null or p_limit is null or p_limit<1 or p_limit>50 or p_dry_run is null then raise exception 'Invalid control scrub parameters' using errcode='22023';end if;
 if not p_dry_run and not exists(select 1 from private.amazon_pii_execution_gates where owner_id=p_owner and reconciliation_verified_at is not null and cycle_verified_at is not null and deployment_reviewed_at is not null and copies_reviewed_at is not null) then raise exception 'Execution gates are not verified' using errcode='55000';end if;
 if not p_dry_run and not pg_try_advisory_xact_lock(hashtextextended('amazon-pii-owner:'||p_owner::text,0)) then raise exception 'Purge owner lease busy' using errcode='55P03';end if;
 select array_agg(id order by id) into v_jobs from(select id from public.amazon_sync_jobs where owner_id=p_owner and (payload is distinct from private.amazon_pii_job_controls(payload) or (last_error is not null and last_error<>'AMAZON_SYNC_ERROR')) order by id limit p_limit) s;
 select array_agg(id order by id) into v_runs from(select id from public.amazon_sync_runs where owner_id=p_owner and (checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint) or (error_message is not null and error_message<>'AMAZON_SYNC_ERROR')) order by id limit p_limit) s;
 select array_agg(id order by id) into v_states from(select id from public.amazon_sync_state where owner_id=p_owner and checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint) order by id limit p_limit) s;
 if not p_dry_run then
   perform 1 from public.amazon_sync_jobs where owner_id=p_owner and id=any(v_jobs) for update nowait;
   perform 1 from public.amazon_sync_runs where owner_id=p_owner and id=any(v_runs) for update nowait;
   perform 1 from public.amazon_sync_state where owner_id=p_owner and id=any(v_states) for update nowait;
   update public.amazon_sync_jobs set payload=private.amazon_pii_job_controls(payload),last_error=case when last_error is not null then 'AMAZON_SYNC_ERROR' end where owner_id=p_owner and id=any(v_jobs);
   update public.amazon_sync_runs set checkpoint=private.amazon_pii_checkpoint(checkpoint),error_message=case when error_message is not null then 'AMAZON_SYNC_ERROR' end where owner_id=p_owner and id=any(v_runs);
   update public.amazon_sync_state set checkpoint=private.amazon_pii_checkpoint(checkpoint) where owner_id=p_owner and id=any(v_states);
 end if;
 return jsonb_build_object('dry_run',p_dry_run,'jobs',coalesce(cardinality(v_jobs),0),'runs',coalesce(cardinality(v_runs),0),'states',coalesce(cardinality(v_states),0));
end $$;

create function private.amazon_pii_order_ref(p_number text,p_id text) returns text language sql immutable set search_path='' as $$
 select case when p_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' and p_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' and p_number<>p_id then null
 else coalesce(case when p_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then p_number end,case when p_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' then p_id end) end
$$;
-- Fence every Amazon writer against a simultaneous tombstone creation. Both the
-- runner and writer acquire this lock before observing a tombstone. Transaction
-- lease auto-releases on error or disconnect; no stuck lease cleanup is needed.
create function private.amazon_pii_write_fence() returns trigger language plpgsql security definer set search_path='' as $$
declare v_ref text;
begin
 if new.source_channel='amazon' then
   if new.order_number ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' and new.order_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$' and new.order_number<>new.order_id then
     raise exception 'Conflicting Amazon order references' using errcode='22023';
   end if;
   v_ref:=private.amazon_pii_order_ref(new.order_number,new.order_id);
   if v_ref is not null then perform pg_advisory_xact_lock(hashtextextended('amazon-pii-order:'||new.owner_id::text||':'||v_ref,0));end if;
 end if;
 return new;
end $$;
create trigger aaaa_amazon_pii_write_fence before insert or update on public.fulfillment_orders for each row execute function private.amazon_pii_write_fence();

-- Legacy carrier imports used numeric sendcloud_id as a retrieval capability.
-- NOT NULL + owner uniqueness require a replacement instead of NULL. Use row
-- identity, never the deleted carrier value; retain the Amazon order separately.
create function private.amazon_pii_remove_capabilities() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.source_channel='amazon' and new.pii_purged_at is not null then
   new.sendcloud_id:='amazon-purged:'||new.id::text;
   new.shopify_tracking_synced_number:=null;
 end if;
 return new;
end $$;
create trigger zzzzz_amazon_pii_remove_capabilities before insert or update on public.fulfillment_orders for each row execute function private.amazon_pii_remove_capabilities();
revoke all on function private.amazon_pii_remove_capabilities() from public,anon,authenticated;
grant execute on function private.amazon_pii_remove_capabilities() to service_role;

create function private.amazon_pii_candidates(p_owner uuid,p_at timestamptz,p_limit int)
returns table(amazon_ref text,purchase_at timestamptz,row_count bigint) language sql stable set search_path='' as $$
 select private.amazon_pii_order_ref(f.order_number,f.order_id),max(f.order_created_at),count(*)
 from public.fulfillment_orders f where f.owner_id=p_owner and f.source_channel='amazon'
 group by private.amazon_pii_order_ref(f.order_number,f.order_id)
 having private.amazon_pii_order_ref(f.order_number,f.order_id) is not null
 and bool_and(f.order_created_at is not null)
 -- No verified delivery timestamp/source exists in the inspected production
 -- schema. Do not infer delivery from DELIVERED or fulfilled_at.
 and private.amazon_pii_deadline(max(f.order_created_at),null)<=p_at
 and bool_or(f.pii_purged_at is null)
 and not bool_or(coalesce(f.order_action_lease_until>p_at,false) or coalesce(f.shopify_tracking_lease_until>p_at,false))
 order by max(f.order_created_at),private.amazon_pii_order_ref(f.order_number,f.order_id) limit p_limit
$$;
create function public.amazon_pii_run_batch(p_owner uuid,p_run uuid,p_mode text default 'pilot',p_limit int default 10,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='3s' set lock_timeout='500ms' as $$
declare v_at timestamptz:=statement_timestamp();v_started timestamptz:=clock_timestamp();v_refs text[];v_ref text;v_rows int;v_orders int;v_result jsonb;v_existing private.amazon_pii_batch_runs%rowtype;v_gate private.amazon_pii_execution_gates%rowtype;v_missing int;v_active int;v_young int;v_invalid int;
begin
 if p_owner is null or p_run is null or p_mode is null or p_mode not in ('pilot','batch') or p_limit is null or p_limit<1 or p_limit>50 or (p_mode='pilot' and p_limit<>10) or p_dry_run is null then raise exception 'Invalid purge mode or limit' using errcode='22023';end if;
 if not p_dry_run then
   if not pg_try_advisory_xact_lock(hashtextextended('amazon-pii-owner:'||p_owner::text,0)) then raise exception 'Purge owner lease busy' using errcode='55P03';end if;
   select * into v_existing from private.amazon_pii_batch_runs where owner_id=p_owner and run_id=p_run;
   if found then
     if v_existing.mode<>p_mode or v_existing.batch_limit<>p_limit then raise exception 'Run identity parameters changed' using errcode='22023';end if;
     return v_existing.result;
   end if;
   select * into v_gate from private.amazon_pii_execution_gates where owner_id=p_owner for update;
   if v_gate.reconciliation_verified_at is null or v_gate.cycle_verified_at is null or v_gate.deployment_reviewed_at is null or v_gate.copies_reviewed_at is null then raise exception 'Execution gates are not verified' using errcode='55000';end if;
   if p_mode='pilot' and v_gate.pilot_run_id is not null then raise exception 'Pilot already executed; verify before remaining batches' using errcode='55000';end if;
   if p_mode='batch' and (v_gate.pilot_run_id is null or v_gate.pilot_verified_at is null) then raise exception 'Pilot verification is required' using errcode='55000';end if;
   if exists(select 1 from public.amazon_sync_jobs where owner_id=p_owner and (payload is distinct from private.amazon_pii_job_controls(payload) or (last_error is not null and last_error<>'AMAZON_SYNC_ERROR')))
   or exists(select 1 from public.amazon_sync_runs where owner_id=p_owner and (checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint) or (error_message is not null and error_message<>'AMAZON_SYNC_ERROR')))
   or exists(select 1 from public.amazon_sync_state where owner_id=p_owner and checkpoint is distinct from private.amazon_pii_checkpoint(checkpoint)) then raise exception 'Historical control copies must be scrubbed first' using errcode='55000';end if;
 end if;
 select array_agg(amazon_ref order by purchase_at,amazon_ref),sum(row_count)::int into v_refs,v_rows from private.amazon_pii_candidates(p_owner,v_at,p_limit);
 v_orders:=coalesce(cardinality(v_refs),0);v_rows:=coalesce(v_rows,0);
 if v_rows>500 then raise exception 'Duplicate row budget exceeded' using errcode='54000';end if;
 if not p_dry_run and p_mode='pilot' and v_orders<>10 then raise exception 'Pilot requires exactly ten eligible canonical orders' using errcode='55000';end if;
 if not p_dry_run then
   foreach v_ref in array coalesce(v_refs,array[]::text[]) loop
     if not pg_try_advisory_xact_lock(hashtextextended('amazon-pii-order:'||p_owner::text||':'||v_ref,0)) then raise exception 'Order writer lease busy' using errcode='55P03';end if;
   end loop;
   -- Lock one representative with SKIP LOCKED; then lock every duplicate NOWAIT.
   -- A locked/mutated duplicate aborts the whole short transaction, never a
   -- partial canonical purge or a pilot silently smaller than ten.
   if (select count(*) from(select f.id from public.fulfillment_orders f where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs) order by f.id for update skip locked) locked)<>v_rows then raise exception 'Candidate rows busy or changed; retry dry-run' using errcode='55P03';end if;
   if exists(select 1 from public.fulfillment_orders f where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs) and (f.order_created_at is null or private.amazon_pii_deadline(f.order_created_at,null)>v_at or f.order_action_lease_until>clock_timestamp() or f.shopify_tracking_lease_until>clock_timestamp())) then raise exception 'Candidate eligibility changed' using errcode='55000';end if;
   update public.fulfillment_orders f set pii_purged_at=v_at where f.owner_id=p_owner and f.source_channel='amazon' and private.amazon_pii_order_ref(f.order_number,f.order_id)=any(v_refs);
   get diagnostics v_rows=row_count;
 end if;
 select count(*) filter(where ref is null),count(*) filter(where missing),count(*) filter(where leased),count(*) filter(where not missing and private.amazon_pii_deadline(purchased,null)>v_at)
 into v_invalid,v_missing,v_active,v_young from (
   select private.amazon_pii_order_ref(order_number,order_id) ref,bool_or(order_created_at is null) missing,max(order_created_at) purchased,
   bool_or(coalesce(order_action_lease_until>v_at,false) or coalesce(shopify_tracking_lease_until>v_at,false)) leased
   from public.fulfillment_orders where owner_id=p_owner and source_channel='amazon' and pii_purged_at is null group by private.amazon_pii_order_ref(order_number,order_id)
 ) s;
 v_result:=jsonb_build_object('run_id',p_run,'policy_version','amazon-pii-v2-purchase60','evaluated_at',v_at,'dry_run',p_dry_run,'mode',p_mode,'selected_orders',v_orders,'fulfillment_rows',v_rows,'skipped_missing_purchase',v_missing,'skipped_action_lease',v_active,'skipped_within_period',v_young,'invalid_identity_groups',v_invalid,'tables',jsonb_build_object('fulfillment_orders',v_rows,'amazon_orders',0,'amazon_order_items',0),'cohort_fingerprint',md5(coalesce(array_to_string(v_refs,','),'')),'errors',0,'duration_ms',floor(extract(epoch from clock_timestamp()-v_started)*1000));
 if not p_dry_run then
   insert into private.amazon_pii_batch_runs values(p_owner,p_run,p_mode,p_limit,'amazon-pii-v2-purchase60',v_at,v_result);
   if p_mode='pilot' then update private.amazon_pii_execution_gates set pilot_run_id=p_run where owner_id=p_owner;end if;
 end if;
 return v_result;
end $$;

revoke all on function private.amazon_pii_job_controls(jsonb),private.amazon_pii_checkpoint(jsonb),private.guard_amazon_pii_controls(),private.amazon_pii_order_ref(text,text),private.amazon_pii_write_fence(),private.amazon_pii_candidates(uuid,timestamptz,int) from public,anon,authenticated;
grant execute on function private.amazon_pii_job_controls(jsonb),private.amazon_pii_checkpoint(jsonb),private.guard_amazon_pii_controls(),private.amazon_pii_order_ref(text,text),private.amazon_pii_write_fence(),private.amazon_pii_candidates(uuid,timestamptz,int) to service_role;
revoke all on function public.amazon_pii_run_batch(uuid,uuid,text,int,boolean),public.amazon_pii_scrub_control_copies(uuid,int,boolean) from public,anon,authenticated;
grant execute on function public.amazon_pii_run_batch(uuid,uuid,text,int,boolean),public.amazon_pii_scrub_control_copies(uuid,int,boolean) to service_role;
