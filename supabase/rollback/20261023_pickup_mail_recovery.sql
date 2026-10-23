BEGIN;
SET LOCAL lock_timeout='3s';
DO $$BEGIN IF EXISTS(SELECT 1 FROM private.pickup_document_mail WHERE status='sending' OR reconcile_required) THEN RAISE EXCEPTION 'PICKUP_MAIL_ROLLBACK_UNRESOLVED';END IF;END$$;
CREATE OR REPLACE FUNCTION public.pickup_document_mail_finish(p_owner uuid, p_actor uuid, p_request uuid, p_status text, p_message_id text, p_error_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m private.pickup_document_mail%rowtype;begin
 -- Record a previously authorized external result even if access was revoked in flight. This cannot initiate email.
 select * into m from private.pickup_document_mail where owner_id=p_owner and request_id=p_request and actor_id=p_actor for update;
 if not found then raise exception 'PICKUP_OPERATION_NOT_FOUND';end if;
 if p_status not in ('sent','failed','unknown') or coalesce(p_error_code,'') not in ('','GMAIL_DENIED','GMAIL_FAILED','NETWORK_UNCERTAIN') or length(coalesce(p_message_id,''))>200 then raise exception 'PICKUP_INVALID_MAIL_RESULT';end if;
 if m.status='sending' then
 update private.pickup_document_mail set status=p_status,message_id=p_message_id,error_code=p_error_code,finished_at=now() where owner_id=p_owner and request_id=p_request;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 select p_owner,p_actor,'orders','email_pickup_report','pickup_report',r.id::text,r.number,'Resultado de envío de informe registrado',jsonb_build_object('status',p_status,'ccOwner',m.cc_owner) from public.pickup_reports r where r.id=m.report_id;end if;
 return jsonb_build_object('status',case when m.status='sending' then p_status else m.status end,'messageId',coalesce(m.message_id,p_message_id));
end$function$
;
CREATE OR REPLACE FUNCTION public.pickup_document_mail_list(p_owner uuid, p_actor uuid, p_report uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 perform private.pickup_document_assert(p_owner,p_actor);
 if not exists(select 1 from public.pickup_reports where id=p_report and owner_id=p_owner) then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 return coalesce((select jsonb_agg(v order by created_at desc) from (select created_at,jsonb_build_object('requestId',request_id,'to',recipient,'subject',subject,
 'ccOwner',cc_owner,'status',case when status='sending' and created_at<now()-interval '5 minutes' then 'unknown' else status end,'createdAt',created_at,'finishedAt',finished_at,'actorId',actor_id) v
 from private.pickup_document_mail where owner_id=p_owner and report_id=p_report order by created_at desc limit 50)x),'[]'::jsonb);
end$function$
;
CREATE OR REPLACE FUNCTION public.pickup_document_mail_prepare(p_owner uuid, p_actor uuid, p_report uuid, p_request uuid, p_to text, p_input_hash text, p_cc_owner boolean, p_subject text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m private.pickup_document_mail%rowtype;s private.pickup_document_state%rowtype;begin
 perform private.pickup_document_assert(p_owner,p_actor);
 if p_request is null or coalesce(p_to,'') !~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]{2,}$' or length(p_to)>254 or coalesce(p_input_hash,'') !~ '^[a-f0-9]{64}$' or length(coalesce(p_subject,''))>200 then raise exception 'PICKUP_INVALID_MAIL';end if;
 if not exists(select 1 from public.pickup_reports where id=p_report and owner_id=p_owner) then raise exception 'PICKUP_REPORT_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('pickup-mail:'||p_owner::text,0));
 select * into m from private.pickup_document_mail where owner_id=p_owner and request_id=p_request;
 if found then
 if m.report_id<>p_report or m.actor_id<>p_actor or m.input_hash<>p_input_hash then raise exception 'PICKUP_REQUEST_REUSED';end if;
 return jsonb_build_object('status',case when m.status='sending' and m.created_at<now()-interval '5 minutes' then 'unknown' else m.status end,'retry',false,'messageId',m.message_id);end if;
 perform pg_advisory_xact_lock(hashtextextended('pickup-document:'||p_report::text,0));
 select * into s from private.pickup_document_state where report_id=p_report;
 if s.status='void' then raise exception 'PICKUP_REPORT_VOID';end if;
 if s.pii_purged_at is null and s.expires_at<=now() then raise exception 'PICKUP_PII_PURGED';end if;
 if (select count(*) from private.pickup_document_mail where owner_id=p_owner and created_at>now()-interval '1 hour')>=10
 or (select count(*) from private.pickup_document_mail where owner_id=p_owner and created_at>now()-interval '1 day')>=100
 or (select count(*) from private.pickup_document_mail where owner_id=p_owner and recipient=lower(p_to) and created_at>now()-interval '1 hour')>=3 then raise exception 'PICKUP_MAIL_RATE_LIMIT';end if;
 insert into private.pickup_document_mail(owner_id,request_id,report_id,actor_id,recipient,subject,input_hash,cc_owner,status,expires_at)
 values(p_owner,p_request,p_report,p_actor,lower(p_to),p_subject,p_input_hash,coalesce(p_cc_owner,false),'sending',now()+make_interval(days=>(select retention_days from private.pickup_document_config where id)));
 return jsonb_build_object('status','sending','retry',true);
end$function$
;
-- Disable the new watchdog before restoring old handlers. Preserve mail/audit rows and recovery metadata.
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='pickup-mail-stale-recovery') THEN PERFORM cron.unschedule('pickup-mail-stale-recovery');END IF;END IF;END$$;
COMMIT;
