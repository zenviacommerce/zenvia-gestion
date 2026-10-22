-- Existing mixed reports remain immutable, with their original IDs/numbers/snapshots.
create function private.pickup_report_single_carrier() returns trigger language plpgsql set search_path='' as $$begin
 if (select count(distinct nullif(trim(i->>'carrier'),'')) from jsonb_array_elements(new.snapshot->'items')i)<>1 then raise exception 'PICKUP_SINGLE_CARRIER_REQUIRED';end if;return new;
end$$;
revoke all on function private.pickup_report_single_carrier() from public,anon,authenticated;
create trigger pickup_report_single_carrier before insert on public.pickup_reports for each row execute function private.pickup_report_single_carrier();
create table private.pickup_report_batches(owner_id uuid not null references public.workspaces(id) on delete cascade,request_id uuid not null,fingerprint jsonb not null,reports jsonb not null,created_at timestamptz not null default now(),primary key(owner_id,request_id));
alter table private.pickup_report_batches enable row level security;
revoke all on private.pickup_report_batches from public,anon,authenticated;
create function public.pickup_report_create_batch(p_order_ids uuid[],p_request_id uuid,p_allow_duplicates boolean default false,p_package_counts jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=private.pickup_report_owner();v_fingerprint jsonb;v_existing private.pickup_report_batches%rowtype;v_preview jsonb;v_group record;v_entry record;v_counts jsonb;v_ids uuid[];v_reports jsonb:='[]';v_report jsonb;begin
 if p_request_id is null then raise exception 'PICKUP_REQUEST_ID_REQUIRED';end if;
 if coalesce(cardinality(p_order_ids),0) not between 1 and 2000 or array_position(p_order_ids,null) is not null then raise exception 'PICKUP_INVALID_SELECTION';end if;
 if cardinality(p_order_ids)<>(select count(distinct x) from unnest(p_order_ids)x) then raise exception 'PICKUP_DUPLICATE_SELECTION';end if;
 if jsonb_typeof(p_package_counts) is distinct from 'object' then raise exception 'PICKUP_INVALID_PACKAGES';end if;
 for v_entry in select * from jsonb_each(p_package_counts) loop
  if jsonb_typeof(v_entry.value)<>'number' or v_entry.value::text !~ '^([1-9]|[1-9][0-9]|100)$' or not(v_entry.key=any(select x::text from unnest(p_order_ids)x)) then raise exception 'PICKUP_INVALID_PACKAGES';end if;
 end loop;
 v_fingerprint:=jsonb_build_object('ids',(select jsonb_agg(x order by x) from unnest(p_order_ids)x),'packages',p_package_counts,'allowDuplicates',coalesce(p_allow_duplicates,false));
 perform pg_advisory_xact_lock(hashtextextended('pickup-report:'||v_owner::text,0));
 select * into v_existing from private.pickup_report_batches where owner_id=v_owner and request_id=p_request_id;
 if found then if v_existing.fingerprint<>v_fingerprint then raise exception 'PICKUP_REQUEST_REUSED';end if;return v_existing.reports;end if;
 -- Lock the complete selection and all canonical siblings before grouping: a label
 -- cannot switch carrier between preview and any of the individual creates.
 perform o.id from public.fulfillment_orders o where o.owner_id=v_owner and (o.id=any(p_order_ids) or exists(
 select 1 from public.fulfillment_orders requested where requested.owner_id=v_owner and requested.id=any(p_order_ids)
 and requested.source_channel in ('amazon','shopify') and nullif(trim(requested.order_number),'') is not null
 and o.source_channel=requested.source_channel and o.source_integration_account_id is not distinct from requested.source_integration_account_id
 and trim(o.order_number)=trim(requested.order_number))) order by o.id for update of o;
 v_preview:=private.pickup_report_preview_items(v_owner,p_order_ids);
 if not coalesce((v_preview->>'canCreate')::boolean,false) then raise exception 'PICKUP_INELIGIBLE_ORDERS';end if;
 for v_group in select trim(i->>'carrier') carrier,array_agg((i->>'orderId')::uuid order by i->>'orderId') ids from jsonb_array_elements(v_preview->'items')i group by trim(i->>'carrier') order by trim(i->>'carrier') loop
  v_ids:=v_group.ids;select coalesce(jsonb_object_agg(key,value),'{}') into v_counts from jsonb_each(p_package_counts) where key=any(select x::text from unnest(v_ids)x);
  v_report:=private.mfa_impl_pickup_report_create(v_ids,gen_random_uuid(),p_allow_duplicates,v_counts);
  v_reports:=v_reports||jsonb_build_array(v_report);
 end loop;
 insert into private.pickup_report_batches(owner_id,request_id,fingerprint,reports)values(v_owner,p_request_id,v_fingerprint,v_reports);return v_reports;
end$$;
revoke all on function public.pickup_report_create_batch(uuid[],uuid,boolean,jsonb) from public,anon;
grant execute on function public.pickup_report_create_batch(uuid[],uuid,boolean,jsonb) to authenticated;
-- Same audited MFA wrapper/manifest contract as existing pickup RPCs.
do $$declare f record;original text;impl_oid regprocedure;begin
 select * into strict f from pg_proc where oid='public.pickup_report_create_batch(uuid[],uuid,boolean,jsonb)'::regprocedure;
 original:=pg_get_functiondef(f.oid);execute replace(original,'FUNCTION public.pickup_report_create_batch(','FUNCTION private.mfa_impl_pickup_report_create_batch(');
 impl_oid:='private.mfa_impl_pickup_report_create_batch(uuid[],uuid,boolean,jsonb)'::regprocedure;
 execute format('CREATE OR REPLACE FUNCTION public.pickup_report_create_batch(%s) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=%L AS %L',pg_get_function_arguments(f.oid),'',
 'BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION ''AUTH_REQUIRED'' USING ERRCODE=''42501''; END IF; PERFORM public.security_mfa_assert(false); RETURN private.mfa_impl_pickup_report_create_batch($1,$2,$3,$4); END');
 execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',impl_oid);
 insert into private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)values(f.oid::regprocedure::text,f.oid,impl_oid,original,md5(pg_get_functiondef(f.oid)));
end$$;
-- An annulled report stays visible in history but no longer blocks a new pickup.
do $$declare src text;needle text:='JOIN public.pickup_reports pr ON pr.id=pi.report_id';begin
 src:=pg_get_functiondef('private.pickup_report_preview_items(uuid,uuid[])'::regprocedure);
 if position(needle in src)=0 then raise exception 'PICKUP_PREVIEW_SOURCE_CHANGED';end if;
 execute replace(src,needle,needle||' AND NOT EXISTS (SELECT 1 FROM private.pickup_document_state ds WHERE ds.report_id=pr.id AND ds.status=''void'')');
end$$;
