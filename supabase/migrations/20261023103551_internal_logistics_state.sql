-- Definition-only installation: historical evidence is populated separately after an approved count.
set local lock_timeout='3s';
do $$begin if current_setting('zenvia.logistics_release_bundle',true) is distinct from 'atomic' and exists(select 1 from public.fulfillment_orders) then raise exception 'LOGISTICS_ATOMIC_RELEASE_REQUIRED';end if;end$$;
create table private.order_dispatch_evidence(
 owner_id uuid not null references public.workspaces(id), identity_key text not null,
 order_id uuid not null, dispatched_at timestamptz not null,
 cause text not null check(cause in ('tracking','signed_report','manual')),
 evidence_basis text not null default 'live',actor_id uuid, report_id uuid references public.pickup_reports(id),
 recorded_at timestamptz not null default now(),primary key(owner_id,identity_key)
);
alter table private.order_dispatch_evidence enable row level security;
revoke all on private.order_dispatch_evidence from public,anon,authenticated;
create trigger order_dispatch_immutable before update or delete on private.order_dispatch_evidence for each row execute function private.pickup_report_immutable();

-- Imported completed orders with no local label remain read-only history after cutover.
-- This is deliberately not physical dispatch evidence.
create table private.order_logistics_legacy(
 owner_id uuid not null references public.workspaces(id),identity_key text not null,
 order_id uuid not null,historical_date timestamptz,recorded_at timestamptz not null default now(),primary key(owner_id,order_id)
);
alter table private.order_logistics_legacy enable row level security;
revoke all on private.order_logistics_legacy from public,anon,authenticated;
create trigger order_logistics_legacy_immutable before update or delete on private.order_logistics_legacy for each row execute function private.pickup_report_immutable();

create function private.order_logistics_identity(p_row jsonb) returns text language sql immutable set search_path='' as $$
 select private.shipment_tracking_identity(jsonb_populate_record(null::public.fulfillment_orders,p_row));
$$;
create function private.order_logistics_evidence(p_row jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('dispatchedAt',d.dispatched_at,'cause',d.cause,'actorId',d.actor_id,'reportId',d.report_id,'basis',d.evidence_basis)
 from private.order_dispatch_evidence d where d.owner_id=(p_row->>'owner_id')::uuid
 and d.identity_key=private.order_logistics_identity(p_row)
 and p_row->>'label_cancelled_at' is null and p_row->>'pii_purged_at' is null
 and (p_row->>'label_created_at' is not null or p_row->>'sendcloud_parcel_id' is not null or nullif(p_row->>'shipping_remote_id','') is not null)
 union all
 select jsonb_build_object('historical',true,'historicalDate',h.historical_date) from private.order_logistics_legacy h
 where h.owner_id=(p_row->>'owner_id')::uuid and h.order_id=(p_row->>'id')::uuid and h.identity_key=private.order_logistics_identity(p_row)
 and p_row->>'label_created_at' is null and p_row->>'sendcloud_parcel_id' is null and nullif(p_row->>'shipping_remote_id','') is null;
$$;
create function private.order_logistics_state(p_row jsonb) returns text language sql stable security definer set search_path='' as $$
 select case
 when lower(trim(coalesce(p_row->>'source_status',''))) in ('cancelled','canceled','cancelled_by_customer','cancelled_by_seller')
 or p_row->>'label_cancelled_at' is not null or coalesce(p_row->>'tracking_normalized_state',
 (select s.normalized_state from public.shipment_tracking_state s where s.owner_id=(p_row->>'owner_id')::uuid and s.order_id=(p_row->>'id')::uuid and s.identity_key=private.order_logistics_identity(p_row)),
 private.tracking_legacy_state(p_row->>'shipping_provider',p_row->>'tracking_status_code'))='cancelled' then 'cancelled'
 when private.order_logistics_evidence(p_row)->>'historical'='true' then 'shipped'
 when not (p_row->>'label_created_at' is not null or p_row->>'sendcloud_parcel_id' is not null or nullif(p_row->>'shipping_remote_id','') is not null) then 'pending'
 when private.order_logistics_evidence(p_row) is not null then 'shipped'
 else 'labelled' end;
$$;

-- Select the exact label-bearing sibling, using the report's existing canonical scope.
create function private.order_report_identity(p_owner uuid,p_order uuid,p_tracking text) returns text language sql stable security definer set search_path='' as $$
 select private.shipment_tracking_identity(o) from public.fulfillment_orders requested
 join public.fulfillment_orders o on o.owner_id=requested.owner_id and (o.id=requested.id or (
 requested.source_channel in ('amazon','shopify') and nullif(trim(requested.order_number),'') is not null
 and o.source_channel=requested.source_channel and o.source_integration_account_id is not distinct from requested.source_integration_account_id
 and trim(o.order_number)=trim(requested.order_number)))
 where requested.id=p_order and requested.owner_id=p_owner and o.tracking_number=p_tracking and o.label_cancelled_at is null
 order by o.label_created_at desc nulls last,o.id limit 1;
$$;

create function private.order_dispatch_from_tracking() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.fulfillment_orders;begin
 if new.normalized_state not in ('in_transit','out_for_delivery','delivered') or new.normalized_state is null then return new;end if;
 select * into o from public.fulfillment_orders where id=new.order_id and owner_id=new.owner_id for update;
 if not found or (o.label_created_at is null and o.sendcloud_parcel_id is null and nullif(o.shipping_remote_id,'') is null) or o.label_cancelled_at is not null or o.pii_purged_at is not null or private.shipment_tracking_identity(o)<>new.identity_key then return new;end if;
 insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause)
 values(o.owner_id,new.identity_key,o.id,coalesce(new.event_at,new.observed_at,now()),'tracking') on conflict do nothing;
 return new;
end$$;
create trigger order_dispatch_tracking after insert or update on public.shipment_tracking_state for each row execute function private.order_dispatch_from_tracking();

create function private.order_dispatch_from_signature() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.fulfillment_orders;item jsonb;v_expected jsonb;begin
 select op.input->'_logisticsIdentities' into v_expected from private.pickup_document_operations op
 where op.owner_id=new.owner_id and op.request_id=new.request_id and op.report_id=new.report_id;
 -- Same order lock order as report creation and manual dispatch. Compare again after locking.
 perform f.id from public.fulfillment_orders f where f.owner_id=new.owner_id and exists(
 select 1 from jsonb_array_elements(private.pickup_report_effective(new.report_id)->'items') i
 where i->>'carrier'=new.carrier and (f.id=(i->>'orderId')::uuid or private.shipment_tracking_identity(f)=v_expected->>(i->>'orderId')))
 order by f.id for update;
 for item in select i from jsonb_array_elements(private.pickup_report_effective(new.report_id)->'items') i where i->>'carrier'=new.carrier loop
 if v_expected->>(item->>'orderId') is null or v_expected->>(item->>'orderId') is distinct from private.order_report_identity(new.owner_id,(item->>'orderId')::uuid,item->>'trackingNumber') then raise exception 'LOGISTICS_REPORT_LABEL_CHANGED';end if;
 select * into o from public.fulfillment_orders f where f.owner_id=new.owner_id and private.shipment_tracking_identity(f)=v_expected->>(item->>'orderId') and f.label_cancelled_at is null and f.pii_purged_at is null order by f.id limit 1;
 if not found then raise exception 'LOGISTICS_REPORT_LABEL_CHANGED';end if;
 insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,actor_id,report_id)
 values(o.owner_id,private.shipment_tracking_identity(o),o.id,new.created_at,'signed_report',new.created_by,new.report_id) on conflict do nothing;
 end loop;return new;
end$$;
create trigger order_dispatch_signature after insert on private.pickup_document_signatures for each row execute function private.order_dispatch_from_signature();

create function public.order_logistics_mark_sent(p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=private.pickup_report_owner();o public.fulfillment_orders;v_count integer:=0;v_total integer;begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'LOGISTICS_INVALID_SELECTION';end if;
 v_total:=jsonb_array_length(p_items);
 if v_total not between 1 and 2000 or (select count(distinct i->>'id') from jsonb_array_elements(p_items)i)<>v_total then raise exception 'LOGISTICS_INVALID_SELECTION';end if;
 perform f.id from public.fulfillment_orders f where f.owner_id=v_owner and f.id in (select (i->>'id')::uuid from jsonb_array_elements(p_items)i) order by f.id for update;
 if (select count(*) from public.fulfillment_orders f where f.owner_id=v_owner and f.id in (select (i->>'id')::uuid from jsonb_array_elements(p_items)i))<>v_total then raise exception 'LOGISTICS_SELECTION_CHANGED';end if;
 for o in select f.* from public.fulfillment_orders f where f.owner_id=v_owner and f.id in (select (i->>'id')::uuid from jsonb_array_elements(p_items)i) order by f.id loop
 if not exists(select 1 from jsonb_array_elements(p_items)i where i->>'id'=o.id::text and i->>'identity'=private.shipment_tracking_identity(o)) then raise exception 'LOGISTICS_LABEL_CHANGED';end if;
 if (o.label_created_at is null and o.sendcloud_parcel_id is null and nullif(o.shipping_remote_id,'') is null) or private.order_logistics_state(to_jsonb(o)) not in ('labelled','shipped') or o.pii_purged_at is not null then raise exception 'LOGISTICS_LABEL_INACTIVE';end if;
 insert into private.order_dispatch_evidence(owner_id,identity_key,order_id,dispatched_at,cause,actor_id)
 values(v_owner,private.shipment_tracking_identity(o),o.id,now(),'manual',auth.uid()) on conflict do nothing;
 if found then
 v_count:=v_count+1;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 values(v_owner,auth.uid(),'orders','mark_shipped','fulfillment_order',o.id::text,o.order_number,'Pedido marcado como enviado',jsonb_build_object('identity',private.shipment_tracking_identity(o),'cause','manual','dispatchedAt',now()));
 end if;end loop;
 return jsonb_build_object('marked',v_count,'selected',v_total);
end$$;
revoke all on function public.order_logistics_mark_sent(jsonb) from public,anon;
grant execute on function public.order_logistics_mark_sent(jsonb) to authenticated;

-- Scope the direct Summary/list read to the same server evidence as workbench RPCs.
create function public.order_logistics_read(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid:=private.pickup_report_owner();begin
 if p_ids is null or cardinality(p_ids)>10000 then raise exception 'LOGISTICS_INVALID_SELECTION';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'logistics_identity',private.shipment_tracking_identity(o),
 'logistics',private.order_logistics_evidence(to_jsonb(o)),'logistics_state',private.order_logistics_state(to_jsonb(o))))
 from public.fulfillment_orders o where o.owner_id=v_owner and o.id=any(p_ids)),'[]'::jsonb);
end$$;
revoke all on function public.order_logistics_read(uuid[]) from public,anon;
grant execute on function public.order_logistics_read(uuid[]) to authenticated;

-- Existing signed pending reports cannot adopt a replacement label on completion.
-- New snapshots carry identity; unchanged legacy snapshots are checked against report creation time.
do $$declare src text;f record;before_src text;begin
 src:=pg_get_functiondef('private.pickup_report_preview_items(uuid,uuid[])'::regprocedure);
 if position('''trackingNumber'',CASE' in src)=0 then raise exception 'LOGISTICS_REPORT_PREVIEW_CHANGED';end if;
 execute replace(src,'''trackingNumber'',CASE','''shipmentIdentity'',private.order_report_identity(p_owner,id,tracking_number),''trackingNumber'',CASE');
 src:=pg_get_functiondef('public.pickup_document_prepare(uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 if position('v_report:=private.pickup_report_effective(p_report);' in src)=0 then raise exception 'LOGISTICS_SIGNATURE_PREPARE_CHANGED';end if;
 execute replace(src,'v_report:=private.pickup_report_effective(p_report);',
 $guard$v_report:=private.pickup_report_effective(p_report);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_report->'items') i
 WHERE private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber') IS NULL
 OR (i->>'shipmentIdentity' IS NOT NULL AND i->>'shipmentIdentity' IS DISTINCT FROM private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber'))
 OR (i->>'shipmentIdentity' IS NULL AND NOT EXISTS(SELECT 1 FROM public.fulfillment_orders f WHERE f.owner_id=p_owner
 AND private.shipment_tracking_identity(f)=private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber')
 AND f.label_created_at <= (v_report->>'createdAt')::timestamptz))) THEN RAISE EXCEPTION 'LOGISTICS_REPORT_LABEL_CHANGED';END IF;
 p_input:=p_input||jsonb_build_object('_logisticsIdentities',(SELECT jsonb_object_agg(i->>'orderId',private.order_report_identity(p_owner,(i->>'orderId')::uuid,i->>'trackingNumber')) FROM jsonb_array_elements(v_report->'items') i));
 $guard$);
 -- Both cached reads and fallback classify the exact same current label evidence.
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('mfa_impl_orders_dashboard_pickup_v1','mfa_impl_orders_workbench_v1','pickup_report_dashboard_scope','orders_dashboard_projection_refresh') loop
 src:=pg_get_functiondef(f.oid);before_src:=src;
 src:=regexp_replace(src,'CASE[[:space:]]+WHEN f.is_cancelled THEN ''cancelled''.*?END AS order_state','private.order_logistics_state(to_jsonb(f)) AS order_state','gs');
 src:=regexp_replace(src,'p.print_sort,CASE WHEN p.has_label.*?END AS order_state,p.created_day','p.print_sort,private.order_logistics_state(to_jsonb(p)) AS order_state,p.created_day','gs');
 src:=regexp_replace(src,'original.print_sort,CASE WHEN original.has_label.*?END AS order_state,original.created_day','original.print_sort,private.order_logistics_state(to_jsonb(original)) AS order_state,original.created_day','gs');
 src:=replace(src,'p.created_day,p.dispatched_day,','p.created_day,(coalesce(nullif(private.order_logistics_evidence(to_jsonb(p))->>''dispatchedAt'',''''),nullif(private.order_logistics_evidence(to_jsonb(p))->>''historicalDate'',''''))::timestamptz AT TIME ZONE ''Europe/Madrid'')::date AS dispatched_day,');
 src:=replace(src,'coalesce(f.fulfilled_at,f.tracking_updated_at,f.label_created_at,f.order_updated_at,f.order_created_at)','coalesce(nullif(private.order_logistics_evidence(to_jsonb(f))->>''dispatchedAt'',''''),nullif(private.order_logistics_evidence(to_jsonb(f))->>''historicalDate'',''''))::timestamptz');
 src:=replace(src,'(to_jsonb(p) -','((to_jsonb(p)||jsonb_build_object(''logistics_state'',private.order_logistics_state(to_jsonb(p)),''logistics'',private.order_logistics_evidence(to_jsonb(p)),''logistics_identity'',private.order_logistics_identity(to_jsonb(p)))) -');
 if src=before_src then raise exception 'LOGISTICS_CLASSIFIER_CHANGED %',f.oid::regprocedure;end if;
 execute src;
 end loop;
end$$;
revoke all on function private.order_logistics_identity(jsonb),private.order_logistics_evidence(jsonb),private.order_logistics_state(jsonb),private.order_report_identity(uuid,uuid,text),private.order_dispatch_from_tracking(),private.order_dispatch_from_signature() from public,anon,authenticated;

-- Additive RPCs use the existing MFA manifest/wrapper contract. The pilot configuration is unchanged.
DO $wrap$
DECLARE f record; original text; impl_name text; impl_oid regprocedure; args text;
BEGIN
 FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('order_logistics_read','order_logistics_mark_sent')
 LOOP
 original:=pg_get_functiondef(f.oid);
 impl_name:='mfa_impl_'||f.proname;
 EXECUTE replace(original,'FUNCTION public.'||f.proname||'(', 'FUNCTION private.'||impl_name||'(');
 impl_oid:=to_regprocedure('private.'||impl_name||'('||oidvectortypes(f.proargtypes)||')');
 SELECT string_agg('$'||i,',' ORDER BY i) INTO args FROM generate_series(1,f.pronargs)i;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE plpgsql %s SECURITY DEFINER SET search_path=%L AS %L',
 f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,'',
 'BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION ''AUTH_REQUIRED'' USING ERRCODE=''42501''; END IF; PERFORM public.security_mfa_assert(false); RETURN private.'||impl_name||'('||args||'); END');
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',impl_oid);
 INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
 VALUES(f.oid::regprocedure::text,f.oid,impl_oid,original,md5(pg_get_functiondef(f.oid)));
 END LOOP;
END $wrap$;

-- A declared pickup total can differ from the verified line sum. The PDF already
-- prints both totals; keep exact verified IDs/revision and base numeric validation.
do $declared$ declare src text; fn text; needle text; begin
 foreach fn in array array['public.pickup_document_prepare(uuid,uuid,uuid,uuid,uuid,jsonb)','public.pickup_document_complete(uuid,uuid,uuid,uuid,uuid,jsonb)'] loop
 src:=pg_get_functiondef(fn::regprocedure);
 needle:='if (p_input->>''packages'')::integer is distinct from (select sum((i->>''packages'')::integer) from jsonb_array_elements(v_report->''items'')i where trim(i->>''carrier'')=v_carrier) then raise exception ''PICKUP_INVALID_PACKAGES'';end if;';
 if fn like '%complete%' then needle:=replace(replace(needle,'p_input','o.input'),'v_carrier','o.carrier');end if;
 if position(needle in src)=0 then raise exception 'LOGISTICS_DECLARED_PACKAGES_GUARD_CHANGED';end if;
 execute replace(src,needle,'');
 end loop;
end $declared$;
