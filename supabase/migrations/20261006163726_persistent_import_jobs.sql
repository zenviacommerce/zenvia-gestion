-- Persistent import state. Only internal workers mutate queue rows.
create table public.import_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.workspaces(id),
 created_by uuid not null references auth.users(id), kind text not null check(kind in ('gmail_scan','expense_document','sales_document','transport_tariff','shopify_orders','sendcloud_orders','envia_shipments')),
 module text not null, account_id uuid references public.integration_accounts(id), request_key text not null,
 label text not null, status text not null default 'queued' check(status in ('queued','running','waiting_review','completed','completed_with_errors','failed','cancelled')),
 stage text not null default 'En cola', options jsonb not null default '{}', cancel_requested boolean not null default false,
 total integer not null default 0, processed integer not null default 0, imported integer not null default 0,
 review integer not null default 0, failed integer not null default 0, skipped integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,request_key)
);
create table public.import_job_items (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.import_jobs(id) on delete cascade,
 owner_id uuid not null references public.workspaces(id), item_key text not null, label text not null,
 source_document_id uuid references public.source_documents(id),
 status text not null default 'queued' check(status in ('queued','running','waiting_review','ready','imported','duplicate','skipped','error','cancelled')),
 stage text not null default 'En cola', input jsonb not null default '{}', result jsonb not null default '{}', checkpoint jsonb not null default '{}',
 error text, retryable boolean not null default false, attempts integer not null default 0, max_attempts integer not null default 5,
 available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(job_id,item_key)
);
create index import_jobs_owner_created_idx on public.import_jobs(owner_id,created_at desc);
create index import_items_available_idx on public.import_job_items(available_at) where status in ('queued','ready','running');
create index import_items_job_idx on public.import_job_items(job_id);

create function private.import_can_access(p_owner uuid,p_module text,p_actor uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_users u join public.workspaces w on w.id=u.data_owner_id
 where u.user_id=p_actor and u.data_owner_id=p_owner and u.active and w.status in ('active','trialing')
 and (u.role='admin' or (p_module<>'settings' and p_module=any(coalesce(u.permissions,'{}'::text[])))))
$$;
revoke all on function private.import_can_access(uuid,text,uuid) from public,anon;
grant execute on function private.import_can_access(uuid,text,uuid) to authenticated,service_role;
alter table public.import_jobs enable row level security;
alter table public.import_job_items enable row level security;
create policy import_jobs_read on public.import_jobs for select to authenticated using(private.import_can_access(owner_id,module));
create policy import_items_read on public.import_job_items for select to authenticated using(exists(select 1 from public.import_jobs j where j.id=job_id and j.owner_id=import_job_items.owner_id and private.import_can_access(j.owner_id,j.module)));
revoke all on public.import_jobs,public.import_job_items from anon,authenticated;
grant select on public.import_jobs,public.import_job_items to authenticated;
grant all on public.import_jobs,public.import_job_items to service_role;

create function public.import_refresh_job(p_job uuid) returns void language plpgsql set search_path='' as $$
declare counts record; cancelling boolean;
begin
 select cancel_requested into cancelling from public.import_jobs where id=p_job for update;
 select count(*) total,count(*) filter(where status not in ('queued','ready','running')) processed,
 count(*) filter(where status='imported') imported,count(*) filter(where status='waiting_review') review,
 count(*) filter(where status='error') failed,count(*) filter(where status in ('skipped','duplicate','cancelled')) skipped,
 count(*) filter(where status='running') running,count(*) filter(where status in ('queued','ready')) queued
 into counts from public.import_job_items where job_id=p_job;
 update public.import_jobs set total=counts.total,processed=counts.processed,imported=counts.imported,review=counts.review,failed=counts.failed,skipped=counts.skipped,
 status=case when cancelling then 'cancelled' when counts.running>0 then 'running' when counts.queued>0 then 'queued' when counts.review>0 then 'waiting_review' when counts.failed>0 then case when counts.imported+counts.skipped>0 then 'completed_with_errors' else 'failed' end else 'completed' end,
 stage=case when cancelling then 'Cancelada' when counts.running>0 then 'Procesando' when counts.queued>0 then 'En cola' when counts.review>0 then 'Pendiente de revisión' when counts.failed>0 then 'Finalizada con incidencias' else 'Completada' end,updated_at=now() where id=p_job;
end $$;

create function public.import_enqueue(p_owner uuid,p_actor uuid,p_kind text,p_module text,p_label text,p_request_key text,p_account uuid,p_options jsonb,p_items jsonb)
 returns public.import_jobs language plpgsql set search_path='' as $$
declare j public.import_jobs; entry jsonb;
begin
 if not private.import_can_access(p_owner,p_module,p_actor) then raise exception 'No tienes permiso para esta importación'; end if;
 if p_account is not null and not exists(select 1 from public.integration_accounts where id=p_account and owner_id=p_owner and enabled) then raise exception 'Cuenta no disponible'; end if;
 insert into public.import_jobs(owner_id,created_by,kind,module,label,request_key,account_id,options)
 values(p_owner,p_actor,p_kind,p_module,p_label,p_request_key,p_account,coalesce(p_options,'{}')) on conflict(owner_id,request_key) do nothing returning * into j;
 if j.id is null then select * into j from public.import_jobs where owner_id=p_owner and request_key=p_request_key; return j; end if;
 for entry in select value from jsonb_array_elements(p_items) loop
 if nullif(entry->>'sourceDocumentId','') is not null and not exists(select 1 from public.source_documents where id=(entry->>'sourceDocumentId')::uuid and owner_id=p_owner) then raise exception 'Documento no disponible'; end if;
 insert into public.import_job_items(job_id,owner_id,item_key,label,source_document_id,input)
 values(j.id,p_owner,entry->>'key',entry->>'label',nullif(entry->>'sourceDocumentId','')::uuid,coalesce(entry->'input','{}'));
 end loop;
 perform public.import_refresh_job(j.id);
 select * into j from public.import_jobs where id=j.id; return j;
end $$;

create function public.import_claim_items(limit_count integer default 2) returns setof public.import_job_items language plpgsql set search_path='' as $$
declare i public.import_job_items;
begin
 -- Exhausted leases are permanent incidents, never invisible running tasks.
 update public.import_job_items set status='error',error='Se agotaron los intentos tras una interrupción.',retryable=true,lease_token=null,lease_until=null,updated_at=now()
 where status='running' and lease_until<now() and attempts>=max_attempts;
 for i in select item.* from public.import_job_items item join public.import_jobs j on j.id=item.job_id
 where not j.cancel_requested and item.attempts<item.max_attempts and item.available_at<=now()
 and (item.status in ('queued','ready') or (item.status='running' and item.lease_until<now()))
 order by item.available_at,item.created_at for update of item skip locked limit greatest(1,least(limit_count,4)) loop
 if not exists(select 1 from public.import_jobs j where j.id=i.job_id and private.import_can_access(j.owner_id,j.module,j.created_by)) then
 update public.import_job_items set status='error',error='El acceso de la empresa o del usuario está desactivado.',updated_at=now() where id=i.id;
 else
 update public.import_job_items set status='running',stage='Procesando',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes',version=version+1,updated_at=now() where id=i.id returning * into i;
 return next i;
 end if;
 perform public.import_refresh_job(i.job_id);
 end loop;
 -- Refresh jobs whose final lease expired above.
 perform public.import_refresh_job(j.id) from public.import_jobs j where j.status='running' and not exists(select 1 from public.import_job_items x where x.job_id=j.id and x.status='running');
end $$;

create function public.import_finish_item(item_id uuid,lease_token uuid,outcome jsonb) returns boolean language plpgsql set search_path='' as $$
declare i public.import_job_items; j public.import_jobs;
begin
 select * into i from public.import_job_items where id=item_id for update;
 if i.status<>'running' or i.lease_token is distinct from lease_token or i.lease_until<=now() then return false; end if;
 select * into j from public.import_jobs where id=i.job_id for update;
 if j.cancel_requested then return false; end if;
 if not private.import_can_access(j.owner_id,j.module,j.created_by) then raise exception 'Permisos revocados'; end if;
 update public.import_job_items set status=outcome->>'status',stage=coalesce(outcome->>'stage',''),result=coalesce(outcome->'result',result),checkpoint=coalesce(outcome->'checkpoint',checkpoint),error=outcome->>'error',retryable=coalesce((outcome->>'retryable')::boolean,false),
 available_at=now()+make_interval(secs=>greatest(0,least(coalesce((outcome->>'delaySeconds')::integer,0),3600))),
 attempts=case when outcome->>'status'='queued' and not coalesce((outcome->>'retryable')::boolean,false) then 0 else attempts end,
 lease_token=null,lease_until=null,version=version+1,updated_at=now() where id=i.id;
 perform public.import_refresh_job(i.job_id); return true;
end $$;

create function public.import_job_action(p_job uuid,p_actor uuid,p_action text,p_item uuid default null,p_version integer default null,p_candidate jsonb default null) returns void language plpgsql set search_path='' as $$
declare j public.import_jobs; i public.import_job_items;
begin
 select * into j from public.import_jobs where id=p_job for update;
 if j.id is null or not private.import_can_access(j.owner_id,j.module,p_actor) then raise exception 'Importación no disponible'; end if;
 if p_action='cancel' then
 update public.import_jobs set cancel_requested=true where id=j.id;
 update public.import_job_items set status='cancelled',stage='Cancelada',lease_token=null,lease_until=null,version=version+1,updated_at=now() where job_id=j.id and status in ('queued','ready','running','waiting_review','error');
 elsif p_action='retry' then
 if j.cancel_requested then raise exception 'La tarea está cancelada'; end if;
 update public.import_job_items set status='queued',attempts=0,error=null,available_at=now(),version=version+1,updated_at=now() where job_id=j.id and status='error' and retryable;
 elsif p_action='review' then
 if j.cancel_requested then raise exception 'La tarea está cancelada'; end if;
 select * into i from public.import_job_items where id=p_item and job_id=j.id for update;
 if i.status<>'waiting_review' or i.version is distinct from p_version then raise exception 'La revisión ha cambiado. Actualiza antes de guardar'; end if;
 update public.import_job_items set result=jsonb_set(result,'{candidate}',p_candidate),input=input||jsonb_build_object('reviewed',true,'reviewedBy',p_actor),status='ready',attempts=0,available_at=now(),version=version+1,updated_at=now() where id=i.id;
 else raise exception 'Acción no válida'; end if;
 perform public.import_refresh_job(j.id);
end $$;

-- Restrict every worker/API RPC to service_role. No public privilege escalation.
revoke all on function public.import_refresh_job(uuid),public.import_enqueue(uuid,uuid,text,text,text,text,uuid,jsonb,jsonb),public.import_claim_items(integer),public.import_finish_item(uuid,uuid,jsonb),public.import_job_action(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.import_refresh_job(uuid),public.import_enqueue(uuid,uuid,text,text,text,text,uuid,jsonb,jsonb),public.import_claim_items(integer),public.import_finish_item(uuid,uuid,jsonb),public.import_job_action(uuid,uuid,text,uuid,integer,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit) values('import-sources','import-sources',false,20971520) on conflict(id) do nothing;
-- Uploads and previews use signed tokens issued by the authenticated import API.
-- No direct Storage mutation is granted to browser users for this bucket.
create table public.import_document_cache (
 owner_id uuid not null references public.workspaces(id), source_key text not null, rules_version text not null,
 result jsonb not null, created_at timestamptz not null default now(), primary key(owner_id,source_key,rules_version)
);
alter table public.import_document_cache enable row level security;
revoke all on public.import_document_cache from public,anon,authenticated;
grant all on public.import_document_cache to service_role;
