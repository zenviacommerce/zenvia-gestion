-- Hotfix: immutable mail identity, pre-provider checkpoint and bounded stale recovery.
set local lock_timeout='3s';
alter table private.pickup_document_mail add column sender_email text,add column rfc_message_id text,add column provider_started_at timestamptz,add column reconcile_required boolean not null default false,add column negative_checks integer not null default 0,add column checked_at timestamptz;
create index pickup_mail_recovery_due on private.pickup_document_mail(created_at) where status in('sending','unknown');
create function private.pickup_mail_expire() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;begin
 with candidates as(select owner_id,request_id from private.pickup_document_mail where status in('sending','unknown') and created_at<now()-interval '5 minutes' order by created_at limit 100 for update skip locked)
 update private.pickup_document_mail m set reconcile_required=(m.provider_started_at is not null or m.status='unknown'),status='failed',error_code=case when m.provider_started_at is not null or m.status='unknown' then 'PROVIDER_UNCONFIRMED' else 'PRE_SEND_ABORTED' end,finished_at=clock_timestamp() from candidates c where c.owner_id=m.owner_id and c.request_id=m.request_id;
 get diagnostics n=row_count;return n;end$$;
revoke all on function private.pickup_mail_expire() from public,anon,authenticated;
create function public.pickup_document_mail_stage(p_owner uuid,p_actor uuid,p_request uuid,p_stage text,p_sender text,p_rfc text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.pickup_document_mail%rowtype;begin
 perform private.pickup_document_assert(p_owner,p_actor);
 select * into m from private.pickup_document_mail where owner_id=p_owner and actor_id=p_actor and request_id=p_request for update;
 if not found or m.status<>'sending' or m.created_at<now()-interval '5 minutes' or m.provider_started_at is not null then raise exception 'PICKUP_MAIL_NOT_ACTIVE';end if;
 if p_stage not in('prepared','provider') or coalesce(p_sender,'') !~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]{2,}$' or length(p_sender)>254 or p_rfc is distinct from '<zenvia.pickup.'||p_owner::text||'.'||p_request::text||'@zenviacommerce.com>' then raise exception 'PICKUP_INVALID_MAIL';end if;
 if m.sender_email is not null and (m.sender_email<>lower(p_sender) or m.rfc_message_id<>p_rfc) then raise exception 'PICKUP_REQUEST_REUSED';end if;
 update private.pickup_document_mail set sender_email=lower(p_sender),rfc_message_id=p_rfc,provider_started_at=case when p_stage='provider' then clock_timestamp() end where owner_id=p_owner and request_id=p_request;
 return jsonb_build_object('ok',true);end$$;
create function public.pickup_document_mail_context(p_owner uuid,p_actor uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.pickup_document_mail%rowtype;begin
 perform private.pickup_document_assert(p_owner,p_actor);perform private.pickup_mail_expire();
 select * into m from private.pickup_document_mail where owner_id=p_owner and request_id=p_request;
 if not found then raise exception 'PICKUP_OPERATION_NOT_FOUND';end if;
 return jsonb_build_object('requestId',m.request_id,'reportId',m.report_id,'status',m.status,'sender',m.sender_email,'rfcMessageId',m.rfc_message_id,'reconcileRequired',m.reconcile_required,'createdAt',m.created_at,'messageId',m.message_id,'errorCode',m.error_code,'checkedAt',m.checked_at);end$$;
create or replace function public.pickup_document_mail_finish(p_owner uuid,p_actor uuid,p_request uuid,p_status text,p_message_id text,p_error_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.pickup_document_mail%rowtype;uncertain boolean;begin
 select * into m from private.pickup_document_mail where owner_id=p_owner and request_id=p_request and actor_id=p_actor for update;
 if not found then raise exception 'PICKUP_OPERATION_NOT_FOUND';end if;
 if p_status not in('sent','failed','unknown') or coalesce(p_error_code,'') not in('','GMAIL_DENIED','GMAIL_FAILED','NETWORK_UNCERTAIN','PDF_FAILED','STORAGE_FAILED','PROVIDER_UNCONFIRMED','PROVIDER_TIMEOUT','PRE_SEND_ABORTED') or length(coalesce(p_message_id,''))>200 or (p_status='sent' and nullif(p_message_id,'') is null) then raise exception 'PICKUP_INVALID_MAIL_RESULT';end if;
 uncertain:=p_status='unknown' or p_error_code in('NETWORK_UNCERTAIN','PROVIDER_UNCONFIRMED','PROVIDER_TIMEOUT');
 if m.status='sending' or (p_status='sent' and m.status='failed' and (m.reconcile_required or m.error_code='GMAIL_NOT_FOUND')) then
 update private.pickup_document_mail set status=case when p_status='unknown' then 'failed' else p_status end,message_id=p_message_id,error_code=nullif(p_error_code,''),reconcile_required=uncertain,finished_at=clock_timestamp() where owner_id=p_owner and request_id=p_request returning * into m;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details) select p_owner,p_actor,'orders','email_pickup_report','pickup_report',r.id::text,r.number,'Resultado de envío de informe registrado',jsonb_build_object('status',m.status,'ccOwner',m.cc_owner,'errorCode',m.error_code) from public.pickup_reports r where r.id=m.report_id;end if;
 return jsonb_build_object('status',m.status,'messageId',m.message_id,'reconcileRequired',m.reconcile_required,'code',m.error_code);end$$;
create function public.pickup_document_mail_reconcile(p_owner uuid,p_actor uuid,p_request uuid,p_result text,p_message_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.pickup_document_mail%rowtype;begin
 perform private.pickup_document_assert(p_owner,p_actor);perform private.pickup_mail_expire();
 select * into m from private.pickup_document_mail where owner_id=p_owner and request_id=p_request for update;
 if not found then raise exception 'PICKUP_OPERATION_NOT_FOUND';end if;
 if p_result not in('sent','absent') or (p_result='sent' and (nullif(p_message_id,'') is null or length(p_message_id)>200)) then raise exception 'PICKUP_INVALID_MAIL_RESULT';end if;
 if m.reconcile_required and m.created_at<=now()-interval '5 minutes' then
 if p_result='sent' then
 update private.pickup_document_mail set status='sent',message_id=p_message_id,reconcile_required=false,error_code=null,finished_at=clock_timestamp(),checked_at=clock_timestamp() where owner_id=p_owner and request_id=p_request returning * into m;
 elsif m.checked_at is null or m.checked_at<=now()-interval '60 seconds' then
 update private.pickup_document_mail set negative_checks=negative_checks+1,checked_at=clock_timestamp(),reconcile_required=(negative_checks+1<2),error_code=case when negative_checks+1>=2 then 'GMAIL_NOT_FOUND' else 'PROVIDER_UNCONFIRMED' end where owner_id=p_owner and request_id=p_request returning * into m;
 end if;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details) select p_owner,p_actor,'orders','reconcile_pickup_report_email','pickup_report',r.id::text,r.number,'Comprobación de informe en Gmail',jsonb_build_object('status',m.status,'result',p_result,'reconcileRequired',m.reconcile_required,'negativeChecks',m.negative_checks) from public.pickup_reports r where r.id=m.report_id;
 end if;
 return jsonb_build_object('status',m.status,'messageId',m.message_id,'reconcileRequired',m.reconcile_required,'code',m.error_code);end$$;
create or replace function public.pickup_document_mail_list(p_owner uuid,p_actor uuid,p_report uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.pickup_document_assert(p_owner,p_actor);perform private.pickup_mail_expire();
 if not exists(select 1 from public.pickup_reports where id=p_report and owner_id=p_owner) then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 return coalesce((select jsonb_agg(v order by created_at desc) from(select created_at,jsonb_build_object('requestId',request_id,'to',recipient,'subject',subject,'ccOwner',cc_owner,'status',status,'createdAt',created_at,'finishedAt',finished_at,'actorId',actor_id,'errorCode',error_code,'reconcileRequired',reconcile_required,'checkedAt',checked_at) v from private.pickup_document_mail where owner_id=p_owner and report_id=p_report order by created_at desc limit 50)x),'[]'::jsonb);end$$;
-- Preserve signature, OID and grants on the reservation RPC.
do $guard$ declare src text;needle text;begin
 src:=pg_get_functiondef('public.pickup_document_mail_prepare(uuid,uuid,uuid,uuid,text,text,boolean,text)'::regprocedure);
 needle:='perform pg_advisory_xact_lock(hashtextextended(''pickup-mail:''||p_owner::text,0));';
 if position(needle in src)=0 then raise exception 'PICKUP_MAIL_PREPARE_SOURCE_CHANGED';end if;
 src:=replace(src,needle,needle||' perform private.pickup_mail_expire();');
 needle:='perform pg_advisory_xact_lock(hashtextextended(''pickup-document:''||p_report::text,0));';
 if position(needle in src)=0 then raise exception 'PICKUP_MAIL_PREPARE_GUARD_CHANGED';end if;
 src:=replace(src,needle,'if exists(select 1 from private.pickup_document_mail where owner_id=p_owner and report_id=p_report and reconcile_required) then raise exception ''PICKUP_MAIL_RECONCILE_REQUIRED'';end if; if exists(select 1 from private.pickup_document_mail where owner_id=p_owner and report_id=p_report and status=''sending'') then raise exception ''PICKUP_BUSY'';end if; '||needle);
 needle:='''retry'',false,''messageId'',m.message_id';
 if position(needle in src)=0 then raise exception 'PICKUP_MAIL_PREPARE_RESULT_CHANGED';end if;
 src:=replace(src,needle,needle||',''reconcileRequired'',m.reconcile_required,''code'',m.error_code');
 execute src;end $guard$;
revoke all on function public.pickup_document_mail_stage(uuid,uuid,uuid,text,text,text),public.pickup_document_mail_context(uuid,uuid,uuid),public.pickup_document_mail_reconcile(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pickup_document_mail_stage(uuid,uuid,uuid,text,text,text),public.pickup_document_mail_context(uuid,uuid,uuid),public.pickup_document_mail_reconcile(uuid,uuid,uuid,text,text) to service_role;
-- SQL-only watchdog: the project currently has session Gmail OAuth, no persistent refresh credential.
do $$begin if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('pickup-mail-stale-recovery','* * * * *','select private.pickup_mail_expire()');end if;end$$;
