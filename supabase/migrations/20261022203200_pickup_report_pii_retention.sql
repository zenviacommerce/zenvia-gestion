-- Disabled until owner reviews affected counts and separately authorizes activation.
-- Keep report metadata, driver name, mail history and corporate assets. Remove only
-- identifier/signature and every PDF containing them, replacing it before deletion.
create table private.pickup_document_purge_queue(
 kind text not null check(kind in ('report','operation')),owner_id uuid not null references public.workspaces(id) on delete cascade,target_id uuid not null,report_id uuid not null,
 paths text[] not null default '{}',redacted_path text,redacted_hash text,status text not null default 'pending' check(status in ('pending','done')),lease uuid,lease_until timestamptz,completed_at timestamptz,
 primary key(kind,owner_id,target_id)
);
alter table private.pickup_document_purge_queue enable row level security;
revoke all on private.pickup_document_purge_queue from public,anon,authenticated;
create function public.pickup_document_retention_counts() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',c.purge_enabled,'retentionDays',c.retention_days,
 'reports',(select count(*) from private.pickup_document_state s where s.pii_purged_at is null and s.expires_at<=now()),
 'signatures',(select count(*) from private.pickup_document_signatures g join private.pickup_document_state s using(report_id) where s.pii_purged_at is null and s.expires_at<=now()),
 'objects',(select count(*) from storage.objects o where o.bucket_id='pickup-report-documents' and exists(select 1 from private.pickup_document_operations op join private.pickup_document_state s using(report_id) where s.pii_purged_at is null and s.expires_at<=now() and o.name in (op.signature_path,op.pdf_path))),
 'abandonedOperations',(select count(*) from private.pickup_document_operations o where o.status='prepared' and o.created_at<now()-interval '1 day'))
 from private.pickup_document_config c where c.id
$$;
create function public.pickup_document_purge_claim(p_lease uuid,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb:='[]';q private.pickup_document_purge_queue%rowtype;st private.pickup_document_state%rowtype;op private.pickup_document_operations%rowtype;v_count integer:=0;begin
 if not coalesce((select purge_enabled from private.pickup_document_config where id),false) then return result;end if;
 if p_lease is null then raise exception 'PICKUP_LEASE_REQUIRED';end if;
 insert into private.pickup_document_purge_queue(kind,owner_id,target_id,report_id,paths)
 select 'report',s.owner_id,s.report_id,s.report_id,array(select distinct path from (
 select o.signature_path path from private.pickup_document_operations o where o.report_id=s.report_id union all
 select o.pdf_path from private.pickup_document_operations o where o.report_id=s.report_id
 )p where path is not null)
 from private.pickup_document_state s where s.pii_purged_at is null and s.expires_at<=now() and coalesce(s.lease_until,now())<=now() limit 100 on conflict do nothing;
 insert into private.pickup_document_purge_queue(kind,owner_id,target_id,report_id,paths)
 select 'operation',o.owner_id,o.request_id,o.report_id,array[o.signature_path,o.pdf_path]
 from private.pickup_document_operations o join private.pickup_document_state s on s.report_id=o.report_id where o.status='prepared' and o.created_at<now()-interval '1 day' and coalesce(s.lease_until,now())<=now() and (s.expires_at is null or s.expires_at>now()) limit 100 on conflict do nothing;
 for q in select * from private.pickup_document_purge_queue where status='pending' and coalesce(lease_until,now())<=now() order by kind,owner_id,target_id limit 500 for update skip locked loop
  exit when v_count>=least(greatest(coalesce(p_limit,20),1),100);
  if not pg_try_advisory_xact_lock(hashtextextended('pickup-document:'||q.report_id::text,0)) then continue;end if;
  select * into st from private.pickup_document_state where report_id=q.report_id for update;
  if st.lease_until>now() then continue;end if;
  if q.kind='report' and (st.pii_purged_at is not null or st.expires_at is null or st.expires_at>now()) then continue;end if;
  if q.kind='operation' then
   select * into op from private.pickup_document_operations where owner_id=q.owner_id and request_id=q.target_id for update;
   if op.status not in ('prepared','purging') then
    update private.pickup_document_purge_queue set status='done',completed_at=now() where (kind,owner_id,target_id)=(q.kind,q.owner_id,q.target_id);continue;
   end if;
   update private.pickup_document_operations set status='purging' where owner_id=q.owner_id and request_id=q.target_id;
  end if;
  update private.pickup_document_purge_queue set lease=p_lease,lease_until=now()+interval '10 minutes' where (kind,owner_id,target_id)=(q.kind,q.owner_id,q.target_id);
  result:=result||jsonb_build_array(jsonb_build_object('kind',q.kind,'owner',q.owner_id,'id',q.target_id,'reportId',q.report_id,'paths',q.paths,'redactedPath',q.redacted_path,'redactedHash',q.redacted_hash));v_count:=v_count+1;
 end loop;
 return result;
end$$;
-- The internal worker receives an already-redacted model, never the identifier.
create function public.pickup_document_purge_read(p_lease uuid,p_owner uuid,p_report uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if not exists(select 1 from private.pickup_document_purge_queue q where q.kind='report' and q.owner_id=p_owner and q.target_id=p_report and q.lease=p_lease and q.lease_until>now() and q.status='pending') then raise exception 'PICKUP_LEASE_LOST';end if;
 select jsonb_build_object('report',r.snapshot,'stampPath',s.stamp_path,'logoPath',s.logo_path,'generatedAt',coalesce(s.signed_at,r.created_at),
 'signatures',coalesce((select jsonb_agg(jsonb_build_object('carrier',g.carrier,'driverName',g.driver_name,'identifier','','receivedAt',g.received_at,'packages',g.packages,'signatureDataUrl',null,'redacted',true) order by g.carrier) from private.pickup_document_signatures g where g.report_id=r.id),'[]'::jsonb)) into result
 from public.pickup_reports r join private.pickup_document_state s on s.report_id=r.id where r.id=p_report and r.owner_id=p_owner;return result;
end$$;
-- Record the immutable reduced PDF before removing any complete version.
create function public.pickup_document_purge_stage(p_lease uuid,p_owner uuid,p_report uuid,p_hash text) returns boolean language plpgsql security definer set search_path='' as $$declare q private.pickup_document_purge_queue%rowtype;v_path text:=p_owner::text||'/'||p_report::text||'/retention/report.pdf';begin
 select * into q from private.pickup_document_purge_queue where kind='report' and owner_id=p_owner and target_id=p_report for update;
 if not found or q.lease is distinct from p_lease or q.lease_until<=now() or q.status<>'pending' then raise exception 'PICKUP_LEASE_LOST';end if;
 if coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' or (q.redacted_hash is not null and q.redacted_hash<>p_hash) then raise exception 'PICKUP_INVALID_ARTIFACT';end if;
 if not exists(select 1 from storage.objects where bucket_id='pickup-report-documents' and name=v_path) then raise exception 'PICKUP_REDACTED_PDF_REQUIRED';end if;
 update private.pickup_document_purge_queue set redacted_path=v_path,redacted_hash=p_hash where kind='report' and owner_id=p_owner and target_id=p_report;return true;
end$$;
create function public.pickup_document_purge_finish(p_lease uuid,p_kind text,p_owner uuid,p_target uuid) returns boolean language plpgsql security definer set search_path='' as $$declare q private.pickup_document_purge_queue%rowtype;v_previous_hash text;begin
 select * into q from private.pickup_document_purge_queue where kind=p_kind and owner_id=p_owner and target_id=p_target for update;
 if not found then raise exception 'PICKUP_OPERATION_NOT_FOUND';end if;if q.status='done' then return true;end if;
 if q.lease is distinct from p_lease or q.lease_until<=now() then raise exception 'PICKUP_LEASE_LOST';end if;
 if p_kind='report' and (q.redacted_path is null or q.redacted_hash is null or not exists(select 1 from storage.objects where bucket_id='pickup-report-documents' and name=q.redacted_path)) then raise exception 'PICKUP_REDACTED_PDF_REQUIRED';end if;
 if exists(select 1 from storage.objects where bucket_id='pickup-report-documents' and name=any(q.paths)) then raise exception 'PICKUP_PURGE_STORAGE_PENDING';end if;
 perform set_config('zenvia.pickup_purge','on',true);
 if p_kind='report' then
 select pdf_hash into v_previous_hash from private.pickup_document_state where report_id=q.report_id;
 update private.pickup_document_signatures set identifier=null,signature_path=null where report_id=q.report_id and owner_id=p_owner;
 update private.pickup_document_operations set input='{}',status='purged' where report_id=q.report_id and owner_id=p_owner;
 update private.pickup_document_state set pdf_path=q.redacted_path,pdf_hash=q.redacted_hash,pii_purged_at=now(),lease=null,lease_request=null,lease_until=null where report_id=q.report_id and owner_id=p_owner;
 else
 update private.pickup_document_operations set input='{}',status='purged' where owner_id=p_owner and request_id=p_target and status in ('prepared','purging');
 update private.pickup_document_state set lease=null,lease_request=null,lease_until=null where owner_id=p_owner and report_id=q.report_id and lease_request=p_target;
 end if;
 update private.pickup_document_purge_queue set status='done',completed_at=now(),lease=null,lease_until=null where kind=p_kind and owner_id=p_owner and target_id=p_target;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 select p_owner,null,'orders','purge_pickup_document_pii','pickup_report',r.id::text,r.number,'DNI/matrícula y firma retirados por retención',jsonb_build_object('kind',p_kind,'previousPdfHash',v_previous_hash,'redactedPdfHash',q.redacted_hash) from public.pickup_reports r where r.id=q.report_id;
 return true;
end$$;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'pickup_document_purge_%' or p.proname='pickup_document_retention_counts') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;
