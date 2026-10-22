-- Additive: existing pickup snapshots and MFA wrappers stay immutable.
create table private.pickup_document_config(id boolean primary key default true check(id),retention_days integer not null default 365 check(retention_days between 1 and 3650),purge_enabled boolean not null default false);
insert into private.pickup_document_config values(true,365,false);
create table private.pickup_document_state(
 report_id uuid primary key references public.pickup_reports(id),owner_id uuid not null references public.workspaces(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','partial','signed','void')),revision integer not null default 0,
 pdf_path text,pdf_hash text,stamp_path text,logo_path text,first_signed_at timestamptz,expires_at timestamptz,signed_at timestamptz,signed_by uuid,
 voided_at timestamptz,voided_by uuid,void_reason text,pii_purged_at timestamptz,lease uuid,lease_request uuid,lease_until timestamptz
);
create table private.pickup_document_operations(
 owner_id uuid not null references public.workspaces(id) on delete cascade,request_id uuid not null,report_id uuid not null references public.pickup_reports(id),actor_id uuid not null,
 base_revision integer not null,carrier text not null,input_hash text not null,input jsonb not null,status text not null default 'prepared' check(status in ('prepared','completed','purging','purged')),
 signature_path text not null,pdf_path text not null,created_at timestamptz not null default now(),completed_at timestamptz,primary key(owner_id,request_id)
);
create table private.pickup_document_signatures(
 report_id uuid not null references public.pickup_reports(id),owner_id uuid not null references public.workspaces(id) on delete cascade,carrier text not null,
 request_id uuid not null,driver_name text,identifier text,received_at timestamptz not null,packages integer not null check(packages between 1 and 200000),
 signature_path text,signature_hash text not null,created_at timestamptz not null default now(),created_by uuid not null,primary key(report_id,carrier),unique(owner_id,request_id)
);
create index pickup_document_expiry on private.pickup_document_state(expires_at) where pii_purged_at is null;
create index pickup_document_operation_expiry on private.pickup_document_operations(created_at) where status='prepared';
do $$declare n text;begin foreach n in array array['pickup_document_config','pickup_document_state','pickup_document_operations','pickup_document_signatures'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated',n);
 if n<>'pickup_document_config' then execute format('create policy workspace_read on private.%I for select to authenticated using(owner_id=(select private.pickup_report_owner()))',n);end if;end loop;end$$;

create function private.pickup_document_assert(p_owner uuid,p_actor uuid) returns void language plpgsql stable security definer set search_path='' as $$begin
 if p_owner is null or p_actor is null or not exists(select 1 from public.app_users u join public.workspaces w on w.id=u.data_owner_id
 where u.user_id=p_actor and u.data_owner_id=p_owner and u.active and w.status in ('active','trialing') and (u.role='admin' or 'orders'=any(u.permissions))) then raise exception 'PICKUP_ACCESS_DENIED' using errcode='42501';end if;
end$$;
create function private.pickup_document_json(p_report uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'status',coalesce(s.status,'pending'),'revision',coalesce(s.revision,0),'signedAt',s.signed_at,'signedBy',s.signed_by,
 'voidedAt',s.voided_at,'voidedBy',s.voided_by,'voidReason',s.void_reason,'piiPurgedAt',s.pii_purged_at,'piiExpired',coalesce(s.expires_at<=now(),false),'retentionUntil',s.expires_at,
 'pdfAvailable',s.pdf_path is not null and (s.pii_purged_at is not null or s.expires_at is null or s.expires_at>now()),
 'signatures',coalesce((select jsonb_agg(jsonb_build_object('carrier',g.carrier,'signedAt',g.created_at,'signedBy',g.created_by,'packages',g.packages,
 'actorName',(select nullif(u.full_name,'') from public.app_users u where u.user_id=g.created_by and u.data_owner_id=r.owner_id)) order by g.carrier) from private.pickup_document_signatures g where g.report_id=r.id),'[]'::jsonb),
 'carriers',(select jsonb_agg(carrier order by carrier) from (select distinct trim(item->>'carrier') carrier from jsonb_array_elements(r.snapshot->'items')item)c))
 from public.pickup_reports r left join private.pickup_document_state s on s.report_id=r.id where r.id=p_report
$$;
create function public.pickup_document_statuses(p_owner uuid,p_actor uuid,p_reports uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.pickup_document_assert(p_owner,p_actor);
 if coalesce(cardinality(p_reports),0)>50 or array_position(p_reports,null) is not null then raise exception 'PICKUP_INVALID_SELECTION';end if;
 if exists(select 1 from unnest(p_reports)id where not exists(select 1 from public.pickup_reports r where r.id=id and r.owner_id=p_owner)) then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 return coalesce((select jsonb_agg(private.pickup_document_json(id)) from unnest(p_reports)id),'[]'::jsonb);
end$$;
create function public.pickup_document_read(p_owner uuid,p_actor uuid,p_report uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 perform private.pickup_document_assert(p_owner,p_actor);
 select jsonb_build_object('report',r.snapshot,'state',private.pickup_document_json(r.id),'pdfPath',s.pdf_path,'pdfHash',s.pdf_hash,'stampPath',s.stamp_path,'logoPath',s.logo_path,
 'signatures',coalesce((select jsonb_agg(jsonb_build_object('carrier',g.carrier,'driverName',g.driver_name,'identifier',g.identifier,'receivedAt',g.received_at,'packages',g.packages,'signaturePath',g.signature_path,'signatureHash',g.signature_hash) order by g.carrier) from private.pickup_document_signatures g where g.report_id=r.id),'[]'::jsonb)) into result
 from public.pickup_reports r left join private.pickup_document_state s on s.report_id=r.id where r.id=p_report and r.owner_id=p_owner;
 if result is null then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;return result;
end$$;
create function public.pickup_document_prepare(p_owner uuid,p_actor uuid,p_report uuid,p_request uuid,p_lease uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.pickup_document_state%rowtype;o private.pickup_document_operations%rowtype;v_carrier text:=trim(p_input->>'carrier');v_root text;v_report jsonb;begin
 perform private.pickup_document_assert(p_owner,p_actor);
 if p_request is null or p_lease is null or jsonb_typeof(p_input) is distinct from 'object' or coalesce(p_input->>'inputHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'signatureHash','') !~ '^[a-f0-9]{64}$'
 or length(trim(coalesce(p_input->>'driverName',''))) not between 2 and 120 or length(trim(coalesce(p_input->>'identifier',''))) not between 2 and 40
 or coalesce(p_input->>'driverName','') ~ '[[:cntrl:]]' or coalesce(p_input->>'identifier','') ~ '[[:cntrl:]]' or coalesce(p_input->>'packages','') !~ '^[0-9]{1,6}$' then raise exception 'PICKUP_INVALID_SIGNATURE';end if;
 if (p_input->>'packages')::integer not between 1 and 200000 or (p_input->>'receivedAt')::timestamptz is null then raise exception 'PICKUP_INVALID_SIGNATURE';end if;
 select snapshot into v_report from public.pickup_reports where id=p_report and owner_id=p_owner;if v_report is null then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 if not exists(select 1 from jsonb_array_elements(v_report->'items')i where trim(i->>'carrier')=v_carrier) then raise exception 'PICKUP_CARRIER_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('pickup-document:'||p_report::text,0));
 select * into o from private.pickup_document_operations where owner_id=p_owner and request_id=p_request;
 if found then
 if o.report_id<>p_report or o.actor_id<>p_actor or o.input_hash<>p_input->>'inputHash' then raise exception 'PICKUP_REQUEST_REUSED';end if;
 if o.status='completed' then return jsonb_build_object('status','completed','state',private.pickup_document_json(p_report));end if;
 if o.status in ('purged','purging') then raise exception 'PICKUP_PII_PURGED';end if;end if;
 insert into private.pickup_document_state(report_id,owner_id) values(p_report,p_owner) on conflict do nothing;
 select * into s from private.pickup_document_state where report_id=p_report for update;
 if s.status='void' then raise exception 'PICKUP_REPORT_VOID';end if;
 if s.pii_purged_at is not null or s.expires_at<=now() then raise exception 'PICKUP_PII_PURGED';end if;
 if exists(select 1 from private.pickup_document_signatures where report_id=p_report and carrier=v_carrier) then raise exception 'PICKUP_CARRIER_ALREADY_SIGNED';end if;
 if o.request_id is not null and o.base_revision<>s.revision then raise exception 'PICKUP_SIGNATURE_REBASE_REQUIRED';end if;
 if s.lease_until>now() and s.lease is distinct from p_lease then raise exception 'PICKUP_BUSY';end if;
 if o.request_id is null then v_root:=p_owner::text||'/'||p_report::text||'/'||p_request::text;
 insert into private.pickup_document_operations(owner_id,request_id,report_id,actor_id,base_revision,carrier,input_hash,input,signature_path,pdf_path)
 values(p_owner,p_request,p_report,p_actor,s.revision,v_carrier,p_input->>'inputHash',p_input,v_root||'/signature.png',v_root||'/report.pdf') returning * into o;end if;
 update private.pickup_document_state set lease=p_lease,lease_request=p_request,lease_until=now()+interval '2 minutes' where report_id=p_report;
 return jsonb_build_object('status','prepared','createdAt',o.created_at,'signaturePath',o.signature_path,'pdfPath',o.pdf_path,'bundle',public.pickup_document_read(p_owner,p_actor,p_report));
end$$;
create function public.pickup_document_complete(p_owner uuid,p_actor uuid,p_report uuid,p_request uuid,p_lease uuid,p_artifact jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.pickup_document_state%rowtype;o private.pickup_document_operations%rowtype;v_groups integer;v_count integer;v_complete boolean;v_root text;begin
 perform private.pickup_document_assert(p_owner,p_actor);perform pg_advisory_xact_lock(hashtextextended('pickup-document:'||p_report::text,0));
 select * into o from private.pickup_document_operations where owner_id=p_owner and request_id=p_request and report_id=p_report and actor_id=p_actor for update;
 if not found then raise exception 'PICKUP_OPERATION_NOT_FOUND';end if;if o.status='completed' then return private.pickup_document_json(p_report);end if;
 select * into s from private.pickup_document_state where report_id=p_report and owner_id=p_owner for update;
 if s.lease is distinct from p_lease or s.lease_request is distinct from p_request or s.lease_until<=now() or s.status in ('signed','void') or s.pii_purged_at is not null or s.expires_at<=now() then raise exception 'PICKUP_LEASE_LOST';end if;
 v_root:=p_owner::text||'/'||p_report::text||'/'||p_request::text;
 if coalesce(p_artifact->>'pdfHash','') !~ '^[a-f0-9]{64}$' or (s.stamp_path is null and p_artifact->>'stampPath' is distinct from v_root||'/stamp.png') or (s.stamp_path is not null and p_artifact->>'stampPath' is distinct from s.stamp_path)
 or (p_artifact->>'logoPath' is not null and p_artifact->>'logoPath' not in (v_root||'/logo.png',coalesce(s.logo_path,''))) then raise exception 'PICKUP_INVALID_ARTIFACT';end if;
 insert into private.pickup_document_signatures(report_id,owner_id,carrier,request_id,driver_name,identifier,received_at,packages,signature_path,signature_hash,created_by)
 values(p_report,p_owner,o.carrier,p_request,trim(o.input->>'driverName'),trim(o.input->>'identifier'),(o.input->>'receivedAt')::timestamptz,(o.input->>'packages')::integer,o.signature_path,o.input->>'signatureHash',p_actor);
 select count(distinct trim(i->>'carrier')) into v_groups from public.pickup_reports r,jsonb_array_elements(r.snapshot->'items')i where r.id=p_report;
 select count(*) into v_count from private.pickup_document_signatures where report_id=p_report;v_complete:=v_count=v_groups;
 update private.pickup_document_state set status=case when v_complete then 'signed' else 'partial' end,revision=revision+1,pdf_path=o.pdf_path,pdf_hash=p_artifact->>'pdfHash',stamp_path=coalesce(stamp_path,p_artifact->>'stampPath'),logo_path=coalesce(logo_path,p_artifact->>'logoPath'),
 first_signed_at=coalesce(first_signed_at,now()),expires_at=coalesce(expires_at,now()+make_interval(days=>coalesce((select retention_days from private.pickup_document_config where id),365))),signed_at=case when v_complete then now() end,signed_by=case when v_complete then p_actor end,
 lease=null,lease_request=null,lease_until=null where report_id=p_report;
 update private.pickup_document_operations set status='completed',completed_at=now(),input='{}' where owner_id=p_owner and request_id=p_request;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 select p_owner,p_actor,'orders','sign_pickup_report','pickup_report',p_report::text,r.number,'Firma registrada en informe de recogida',jsonb_build_object('carrier',o.carrier,'packages',(o.input->>'packages')::integer,'signatureHash',o.input->>'signatureHash','pdfHash',p_artifact->>'pdfHash') from public.pickup_reports r where r.id=p_report;
 return private.pickup_document_json(p_report);
end$$;
create function public.pickup_document_void(p_owner uuid,p_actor uuid,p_report uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare s private.pickup_document_state%rowtype;begin
 perform private.pickup_document_assert(p_owner,p_actor);if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'PICKUP_VOID_REASON_REQUIRED';end if;
 if not exists(select 1 from public.pickup_reports where id=p_report and owner_id=p_owner) then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('pickup-document:'||p_report::text,0));insert into private.pickup_document_state(report_id,owner_id) values(p_report,p_owner) on conflict do nothing;
 select * into s from private.pickup_document_state where report_id=p_report for update;if s.status='void' then return private.pickup_document_json(p_report);end if;if s.lease_until>now() then raise exception 'PICKUP_BUSY';end if;
 update private.pickup_document_state set status='void',voided_at=now(),voided_by=p_actor,void_reason=trim(p_reason),expires_at=coalesce(expires_at,now()+make_interval(days=>coalesce((select retention_days from private.pickup_document_config where id),365))),lease=null,lease_request=null,lease_until=null where report_id=p_report;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 select p_owner,p_actor,'orders','void_pickup_report','pickup_report',p_report::text,number,'Informe de recogida anulado',jsonb_build_object('reasonProvided',true) from public.pickup_reports where id=p_report;return private.pickup_document_json(p_report);
end$$;
create function public.pickup_document_release(p_owner uuid,p_actor uuid,p_report uuid,p_request uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$begin
 perform private.pickup_document_assert(p_owner,p_actor);
 update private.pickup_document_state set lease=null,lease_request=null,lease_until=null where owner_id=p_owner and report_id=p_report and lease=p_lease and lease_request=p_request;
 return found;
end$$;
create function private.pickup_signature_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' and not exists(select 1 from public.workspaces where id=old.owner_id) then return old;end if;
 if tg_op='UPDATE' and current_setting('zenvia.pickup_purge',true)='on' and new.identifier is null and new.signature_path is null
 and (to_jsonb(new)-'identifier'-'signature_path')=(to_jsonb(old)-'identifier'-'signature_path') then return new;end if;
 raise exception 'PICKUP_SIGNATURE_IMMUTABLE' using errcode='42501';end$$;
create trigger pickup_signature_immutable before update or delete on private.pickup_document_signatures for each row execute function private.pickup_signature_immutable();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pickup-report-documents','pickup-report-documents',false,5242880,array['application/pdf','image/png','image/jpeg','image/webp']);
create function private.pickup_document_can_read(p_name text) returns boolean language plpgsql stable security definer set search_path='' as $$declare owner uuid:=private.pickup_report_owner();begin
 return exists(select 1 from private.pickup_document_state s where s.owner_id=owner and s.pdf_path=p_name and (s.pii_purged_at is not null or s.expires_at>now()));end$$;
create policy pickup_document_workspace_read on storage.objects for select to authenticated using(bucket_id='pickup-report-documents' and private.pickup_document_can_read(name));
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like 'pickup_document_%' or p.proname='pickup_signature_immutable') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pickup_document_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;
grant execute on function private.pickup_document_can_read(text) to authenticated;
