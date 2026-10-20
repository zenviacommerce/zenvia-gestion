BEGIN;
SET LOCAL statement_timeout='15s';
DO $verify$
DECLARE v_uid uuid:='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';v_owner uuid;v_session uuid;v_proof numeric;v_claims jsonb;v_ids uuid[]:='{}';v_candidate record;v_req uuid:=gen_random_uuid();v_first jsonb;v_second jsonb;v_retry jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.pickup_reports) OR EXISTS(SELECT 1 FROM private.pickup_report_counters) THEN RAISE EXCEPTION 'REHEARSAL_REQUIRES_EMPTY_REPORTS';END IF;
 SELECT workspace_id INTO STRICT v_owner FROM public.app_users WHERE user_id=v_uid AND active;
 SELECT s.id,floor(extract(epoch FROM a.updated_at)) INTO v_session,v_proof FROM auth.sessions s JOIN auth.mfa_amr_claims a ON a.session_id=s.id AND a.authentication_method='totp'
 JOIN private.mfa_principals p ON p.user_id=s.user_id AND p.state='active'
 JOIN auth.mfa_factors f ON f.id=s.factor_id AND f.status::text='verified' AND f.id=ANY(p.admitted_factor_ids)
 WHERE s.user_id=v_uid AND s.aal::text='aal2' AND s.created_at>=p.not_before AND (s.not_after IS NULL OR s.not_after>now()) ORDER BY a.updated_at DESC LIMIT 1;
 IF v_session IS NULL THEN RAISE EXCEPTION 'REHEARSAL_NO_VALID_AAL2_SESSION';END IF;
 FOR v_candidate IN SELECT id FROM public.fulfillment_orders WHERE owner_id=v_owner AND tracking_number IS NOT NULL AND source_channel IN ('amazon','shopify') ORDER BY label_created_at DESC NULLS LAST LIMIT 100 LOOP
 IF (private.pickup_report_preview_items(v_owner,ARRAY[v_candidate.id])->>'canCreate')::boolean THEN v_ids:=array_append(v_ids,v_candidate.id);END IF;
 EXIT WHEN cardinality(v_ids)=2;
 END LOOP;
 IF cardinality(v_ids)<>2 THEN RAISE EXCEPTION 'REHEARSAL_NEEDS_TWO_ELIGIBLE_ORDERS';END IF;
 v_claims:=jsonb_build_object('sub',v_uid,'role','authenticated','aal','aal2','session_id',v_session,'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',v_proof)));
 PERFORM set_config('request.jwt.claims',v_claims::text,true);PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claims',(v_claims||'{"aal":"aal1"}'::jsonb)::text,true);
 BEGIN PERFORM public.pickup_report_preview(ARRAY[v_ids[1]]);RAISE EXCEPTION 'REHEARSAL_AAL1_WAS_ALLOWED';EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'MFA_REQUIRED' THEN RAISE;END IF;END;
 PERFORM set_config('request.jwt.claims',v_claims::text,true);
 v_first:=public.pickup_report_create(ARRAY[v_ids[1]],v_req,false,'{}');
 v_retry:=public.pickup_report_create(ARRAY[v_ids[1]],v_req,false,'{}');
 v_second:=public.pickup_report_create(ARRAY[v_ids[2]],gen_random_uuid(),false,'{}');
 IF v_first<>v_retry THEN RAISE EXCEPTION 'REHEARSAL_RETRY_CHANGED';END IF;
 IF v_first->>'number'<>'REC-'||extract(year FROM now() AT TIME ZONE 'Europe/Madrid')::text||'-0001'
 OR v_second->>'number'<>'REC-'||extract(year FROM now() AT TIME ZONE 'Europe/Madrid')::text||'-0002' THEN RAISE EXCEPTION 'REHEARSAL_NUMBERING_FAILED';END IF;
 IF public.pickup_report_get((v_first->>'id')::uuid)<>v_first THEN RAISE EXCEPTION 'REHEARSAL_REPRINT_CHANGED';END IF;
 EXECUTE 'RESET ROLE';
END $verify$;
ROLLBACK;
SELECT jsonb_build_object('rpc_rehearsal','PASS: AAL1 denied, AAL2 preview/create/get, 0001 then 0002, idempotent retry; all ROLLBACK','reports',(select count(*) from public.pickup_reports),'items',(select count(*) from public.pickup_report_items),'counters',(select count(*) from private.pickup_report_counters),'guard_findings',(select count(*) from private.mfa_activation_findings())) proof;
