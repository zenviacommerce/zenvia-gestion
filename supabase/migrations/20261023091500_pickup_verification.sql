-- Additive pending-report corrections. Immutable original snapshots/items are never updated.
-- Installation changes definitions only: no existing business rows or purge settings are modified.
set local lock_timeout='3s';
create table private.pickup_report_exclusions(
 report_id uuid not null references public.pickup_reports(id),owner_id uuid not null references public.workspaces(id),
 order_id uuid not null,order_key text not null,reason text not null check(length(trim(reason)) between 3 and 300),removed_at timestamptz not null default now(),removed_by uuid not null,
 primary key(report_id,order_id)
);
create index pickup_exclusions_owner_order on private.pickup_report_exclusions(owner_id,order_id,removed_at desc);
create index pickup_exclusions_owner_key on private.pickup_report_exclusions(owner_id,order_key);
alter table private.pickup_report_exclusions enable row level security;
revoke all on private.pickup_report_exclusions from public,anon,authenticated;
create policy workspace_read on private.pickup_report_exclusions for select to authenticated using(owner_id=(select private.pickup_report_owner()));
create trigger pickup_exclusions_immutable before update or delete on private.pickup_report_exclusions for each row execute function private.pickup_report_immutable();

create function private.pickup_report_effective(p_report uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select r.snapshot||jsonb_build_object('items',coalesce((select jsonb_agg(i order by pos) from jsonb_array_elements(r.snapshot->'items') with ordinality a(i,pos) where not exists(select 1 from private.pickup_report_exclusions x where x.report_id=r.id and x.order_id=(i->>'orderId')::uuid)),'[]'::jsonb),
 'totalPackages',coalesce((select sum((i->>'packages')::integer) from jsonb_array_elements(r.snapshot->'items')i where not exists(select 1 from private.pickup_report_exclusions x where x.report_id=r.id and x.order_id=(i->>'orderId')::uuid)),0),
 'removedItems',coalesce((select jsonb_agg(i||jsonb_build_object('reason',x.reason,'removedAt',x.removed_at,'removedBy',x.removed_by) order by pos) from jsonb_array_elements(r.snapshot->'items') with ordinality a(i,pos) join private.pickup_report_exclusions x on x.report_id=r.id and x.order_id=(i->>'orderId')::uuid),'[]'::jsonb)) from public.pickup_reports r where r.id=p_report;
$$;
-- Latest removal returns a live shipment to the label work queue until a later active report
-- accepts it. Carrier facts stay intact; terminal/cancelled labels never get resurrected.
create function private.pickup_report_returned(p_owner uuid,p_order uuid,p_key text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.pickup_report_exclusions x
 where x.owner_id=p_owner and (x.order_id=p_order or x.order_key=p_key)
 and not exists(select 1 from public.pickup_report_items current_item join public.pickup_reports r on r.id=current_item.report_id and r.owner_id=current_item.owner_id
 where current_item.owner_id=p_owner and (current_item.order_id=p_order or current_item.order_key=p_key)
 and not exists(select 1 from private.pickup_report_exclusions later where later.report_id=current_item.report_id and later.order_id=current_item.order_id)
 and not exists(select 1 from private.pickup_document_state s where s.report_id=r.id and s.status='void')));
$$;
revoke all on function private.pickup_report_effective(uuid),private.pickup_report_returned(uuid,uuid,text) from public,anon,authenticated;

create function public.pickup_document_exclude_item(p_owner uuid,p_actor uuid,p_report uuid,p_order uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.pickup_document_state%rowtype;x private.pickup_report_exclusions%rowtype;v_item jsonb;begin
 perform private.pickup_document_assert(p_owner,p_actor);
 if length(trim(coalesce(p_reason,''))) not between 3 and 300 or p_reason ~ '[[:cntrl:]]' then raise exception 'PICKUP_REMOVAL_REASON_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('pickup-document:'||p_report::text,0));
 select i into v_item from public.pickup_reports r cross join lateral jsonb_array_elements(r.snapshot->'items')i where r.id=p_report and r.owner_id=p_owner and i->>'orderId'=p_order::text;
 if v_item is null then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 insert into private.pickup_document_state(report_id,owner_id) values(p_report,p_owner) on conflict do nothing;
 select * into s from private.pickup_document_state where report_id=p_report and owner_id=p_owner for update;
 if s.status<>'pending' or exists(select 1 from private.pickup_document_signatures where report_id=p_report) then raise exception 'PICKUP_REPORT_LOCKED';end if;
 if s.lease_until>now() or exists(select 1 from private.pickup_document_mail m where m.report_id=p_report and m.status='sending' and m.created_at>now()-interval '10 minutes') then raise exception 'PICKUP_BUSY';end if;
 select * into x from private.pickup_report_exclusions where report_id=p_report and order_id=p_order;
 if found then if x.reason<>trim(p_reason) then raise exception 'PICKUP_REQUEST_REUSED';end if;return public.pickup_document_read(p_owner,p_actor,p_report);end if;
 insert into private.pickup_report_exclusions(report_id,owner_id,order_id,order_key,reason,removed_by)select p_report,p_owner,p_order,pi.order_key,trim(p_reason),p_actor from public.pickup_report_items pi where pi.report_id=p_report and pi.owner_id=p_owner and pi.order_id=p_order;
 if not found then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 update private.pickup_document_state set revision=revision+1 where report_id=p_report and owner_id=p_owner;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 select p_owner,p_actor,'orders','remove_pickup_report_item','pickup_report',p_report::text,number,'Envío retirado del informe antes de la firma',jsonb_build_object('orderId',p_order,'packages',(v_item->>'packages')::integer,'reasonProvided',true) from public.pickup_reports where id=p_report;
 return public.pickup_document_read(p_owner,p_actor,p_report);
end$$;
revoke all on function public.pickup_document_exclude_item(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pickup_document_exclude_item(uuid,uuid,uuid,uuid,text) to service_role;

-- Patch only private implementations and internal service-role functions. Public MFA
-- wrappers, manifests, auth functions and immutable snapshots remain byte-identical.
do $$declare src text;needle text;f record;guard text;key_expr text;alias_name text;begin
 src:=pg_get_functiondef('private.mfa_impl_pickup_report_get(uuid)'::regprocedure);
 needle:='SELECT snapshot INTO result FROM public.pickup_reports';if position(needle in src)=0 then raise exception 'PICKUP_EFFECTIVE_GET_SOURCE_CHANGED';end if;
 execute replace(src,needle,'SELECT private.pickup_report_effective(id) INTO result FROM public.pickup_reports');
 src:=pg_get_functiondef('private.mfa_impl_pickup_report_list(uuid,integer)'::regprocedure);
 if position('r.snapshot' in src)=0 then raise exception 'PICKUP_EFFECTIVE_LIST_SOURCE_CHANGED';end if;
 src:=replace(src,'r.snapshot','private.pickup_report_effective(r.id)');
 needle:='pi.owner_id=v_owner AND (';if position(needle in src)=0 then raise exception 'PICKUP_EFFECTIVE_LIST_MEMBERSHIP_CHANGED';end if;
 src:=replace(src,needle,'pi.owner_id=v_owner AND NOT EXISTS (SELECT 1 FROM private.pickup_report_exclusions x WHERE x.report_id=pi.report_id AND x.order_id=pi.order_id) AND (');execute src;
 foreach needle in array array['public.pickup_document_read(uuid,uuid,uuid)','public.pickup_document_purge_read(uuid,uuid,uuid)'] loop
 src:=pg_get_functiondef(needle::regprocedure);if position('''report'',r.snapshot' in src)=0 then raise exception 'PICKUP_EFFECTIVE_DOCUMENT_SOURCE_CHANGED';end if;execute replace(src,'''report'',r.snapshot','''report'',private.pickup_report_effective(r.id)');end loop;
 src:=pg_get_functiondef('private.pickup_report_preview_items(uuid,uuid[])'::regprocedure);
 needle:='WHERE pi.owner_id=p_owner AND pi.order_key=r.order_key';if position(needle in src)=0 then raise exception 'PICKUP_EFFECTIVE_PREVIEW_SOURCE_CHANGED';end if;
 execute replace(src,needle,'WHERE pi.owner_id=p_owner AND NOT EXISTS (SELECT 1 FROM private.pickup_report_exclusions x WHERE x.report_id=pi.report_id AND x.order_id=pi.order_id) AND pi.order_key=r.order_key');
 -- Exact verified shipment set and derived totals are checked inside the signing lock.
 src:=pg_get_functiondef('public.pickup_document_prepare(uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:='select * into s from private.pickup_document_state where report_id=p_report for update;';if position(needle in src)=0 then raise exception 'PICKUP_VERIFICATION_PREPARE_SOURCE_CHANGED';end if;
 guard:=$guard$
 v_report:=private.pickup_report_effective(p_report);
 if jsonb_typeof(p_input->'verifiedOrderIds') is distinct from 'array' or jsonb_array_length(p_input->'verifiedOrderIds')=0 or jsonb_array_length(p_input->'verifiedOrderIds')>2000 then raise exception 'PICKUP_VERIFICATION_REQUIRED';end if;
 if coalesce(p_input->>'reportRevision','') !~ '^[0-9]{1,9}$' or (p_input->>'reportRevision')::integer<>s.revision then raise exception 'PICKUP_VERIFICATION_STALE';end if;
 if (select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from jsonb_array_elements_text(p_input->'verifiedOrderIds') id) is distinct from
 (select coalesce(jsonb_agg(i->>'orderId' order by i->>'orderId'),'[]'::jsonb) from jsonb_array_elements(v_report->'items') i where trim(i->>'carrier')=v_carrier) then raise exception 'PICKUP_VERIFICATION_STALE';end if;
 if (p_input->>'packages')::integer is distinct from (select sum((i->>'packages')::integer) from jsonb_array_elements(v_report->'items')i where trim(i->>'carrier')=v_carrier) then raise exception 'PICKUP_INVALID_PACKAGES';end if;
 $guard$;
 execute replace(src,needle,needle||guard);
 src:=pg_get_functiondef('public.pickup_document_complete(uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:='select * into s from private.pickup_document_state where report_id=p_report and owner_id=p_owner for update;';
 if position(needle in src)=0 or position('v_root text;begin' in src)=0 then raise exception 'PICKUP_VERIFICATION_COMPLETE_SOURCE_CHANGED';end if;
 src:=replace(src,'v_root text;begin','v_root text;v_report jsonb;begin');
 src:=replace(src,needle,needle||replace(replace(guard,'p_input','o.input'),'v_carrier','o.carrier'));
 src:=replace(src,'jsonb_array_elements(r.snapshot->''items'')','jsonb_array_elements(private.pickup_report_effective(r.id)->''items'')');execute src;
 src:=pg_get_functiondef('private.pickup_document_json(uuid)'::regprocedure);
 if position('r.snapshot' in src)=0 then raise exception 'PICKUP_EFFECTIVE_STATE_SOURCE_CHANGED';end if;execute replace(src,'r.snapshot','private.pickup_report_effective(r.id)');
 -- Membership/REC column/sort all ignore retired lines before pagination.
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('mfa_impl_orders_dashboard_pickup_v1','mfa_impl_orders_workbench_v1') loop
 src:=pg_get_functiondef(f.oid);needle:='WHERE pi.owner_id=';if position(needle in src)=0 then raise exception 'PICKUP_EFFECTIVE_DASHBOARD_SOURCE_CHANGED';end if;
 src:=replace(src,needle,'WHERE NOT EXISTS (SELECT 1 FROM private.pickup_report_exclusions x WHERE x.report_id=pi.report_id AND x.order_id=pi.order_id) AND pi.owner_id=');
 if position('p.print_sort,p.order_state,p.created_day' in src)>0 then
 foreach alias_name in array array['p','original'] loop
 key_expr:=format('CASE WHEN %1$s.source_channel IN (''amazon'',''shopify'') AND nullif(trim(%1$s.order_number),'''') IS NOT NULL THEN %1$s.source_channel||'':''||coalesce(%1$s.source_integration_account_id::text,''legacy'')||'':''||trim(%1$s.order_number) ELSE %1$s.id::text END',alias_name);
 needle:=alias_name||'.print_sort,'||alias_name||'.order_state,'||alias_name||'.created_day';
 if position(needle in src)=0 then
 if alias_name='original' and position('UNION ALL SELECT original.* FROM (' in src)>0 then
 src:=replace(src,'WHEN f.is_cancelled THEN ''cancelled''','WHEN f.is_cancelled THEN ''cancelled'' WHEN f.has_label AND f.tracking_class NOT IN (''delivered'',''returned'',''cancelled'') AND private.pickup_report_returned(f.owner_id,f.id,CASE WHEN f.source_channel IN (''amazon'',''shopify'') AND nullif(trim(f.order_number),'''') IS NOT NULL THEN f.source_channel||'':''||coalesce(f.source_integration_account_id::text,''legacy'')||'':''||trim(f.order_number) ELSE f.id::text END) THEN ''labelled''');continue;
 end if;raise exception 'PICKUP_EFFECTIVE_PROJECTION_SOURCE_CHANGED';end if;
 src:=replace(src,needle,alias_name||'.print_sort,CASE WHEN '||alias_name||'.has_label AND NOT '||alias_name||'.is_cancelled AND '||alias_name||'.tracking_class NOT IN (''delivered'',''returned'',''cancelled'') AND private.pickup_report_returned('||alias_name||'.owner_id,'||alias_name||'.id,'||key_expr||') THEN ''labelled'' ELSE '||alias_name||'.order_state END AS order_state,'||alias_name||'.created_day');end loop;
 else
 needle:='WHEN f.is_cancelled THEN ''cancelled''';if position(needle in src)=0 then raise exception 'PICKUP_EFFECTIVE_CLASSIFIER_SOURCE_CHANGED';end if;
 src:=replace(src,needle,needle||' WHEN f.has_label AND f.tracking_class NOT IN (''delivered'',''returned'',''cancelled'') AND private.pickup_report_returned(f.owner_id,f.id,CASE WHEN f.source_channel IN (''amazon'',''shopify'') AND nullif(trim(f.order_number),'''') IS NOT NULL THEN f.source_channel||'':''||coalesce(f.source_integration_account_id::text,''legacy'')||'':''||trim(f.order_number) ELSE f.id::text END) THEN ''labelled''');
 end if;execute src;end loop;
end$$;
