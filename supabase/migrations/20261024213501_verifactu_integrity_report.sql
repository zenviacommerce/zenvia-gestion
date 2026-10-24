-- Read-only monitoring API. No source/archive DML, no changes to fiscal guards.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL search_path='';

CREATE FUNCTION private.vf_integrity_report(p_owner uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;c record;e record;prior record;prev_hash text;prev_sequence bigint;last_id uuid;
 issues jsonb:='[]';problems text[];code text;canonical text;input jsonb;expected jsonb;
 total bigint:=0;altas bigint:=0;cancelled bigint:=0;events bigint:=0;days jsonb;recent jsonb;
BEGIN
 IF p_owner IS NULL THEN RAISE EXCEPTION 'VF_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 FOR c IN
  SELECT issuer_nif,installation_id FROM private.verifactu_records WHERE owner_id=p_owner
  UNION SELECT issuer_nif,installation_id FROM private.verifactu_chains WHERE owner_id=p_owner
 LOOP
  prev_hash:='';prev_sequence:=0;last_id:=NULL;
  FOR r IN SELECT * FROM private.verifactu_records WHERE owner_id=p_owner AND issuer_nif=c.issuer_nif AND installation_id=c.installation_id ORDER BY sequence LOOP
   total:=total+1;problems:='{}';
   IF r.record_kind='alta' THEN altas:=altas+1;ELSE cancelled:=cancelled+1;END IF;
   IF r.sequence<>prev_sequence+1 THEN problems:=array_append(problems,'RECORD_SEQUENCE');END IF;
   IF r.previous_hash<>prev_hash THEN problems:=array_append(problems,'RECORD_LINK');END IF;
   IF r.hash<>private.vf_sha256(r.hash_input) THEN problems:=array_append(problems,'RECORD_DIGEST');END IF;
   BEGIN
    canonical:=private.vf_hash_input(r.record_kind,r.hash_fields);
    IF canonical<>r.hash_input OR r.hash_fields->>'Huella' IS DISTINCT FROM r.previous_hash OR r.hash_fields->>'FechaHoraHusoGenRegistro' IS DISTINCT FROM r.generated_at_with_offset OR (r.generated_at_with_offset)::timestamptz IS DISTINCT FROM date_trunc('second',r.generated_at) THEN problems:=array_append(problems,'RECORD_CANONICAL');END IF;
   EXCEPTION WHEN OTHERS THEN problems:=array_append(problems,'RECORD_CANONICAL');END;
   IF r.record_kind='anulacion' AND NOT EXISTS(SELECT 1 FROM private.verifactu_records a WHERE a.id=r.alta_record_id AND a.owner_id=p_owner AND a.invoice_id=r.invoice_id AND a.issuer_nif=r.issuer_nif AND a.installation_id=r.installation_id AND a.record_kind='alta' AND a.sequence<r.sequence) THEN problems:=array_append(problems,'CANCELLATION_ALTA');END IF;
   FOREACH code IN ARRAY problems LOOP issues:=issues||jsonb_build_array(jsonb_build_object('code',code,'recordId',r.id,'sequence',r.sequence));END LOOP;
   prev_hash:=r.hash;prev_sequence:=r.sequence;last_id:=r.id;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM private.verifactu_chains h WHERE h.owner_id=p_owner AND h.issuer_nif=c.issuer_nif AND h.installation_id=c.installation_id AND h.last_sequence=prev_sequence AND h.last_hash=prev_hash AND h.last_record_id IS NOT DISTINCT FROM last_id) THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CHAIN_HEAD','recordId',last_id,'sequence',prev_sequence));END IF;
 END LOOP;
 prev_hash:='';prev_sequence:=0;
 FOR e IN SELECT * FROM private.verifactu_events WHERE owner_id=p_owner ORDER BY sequence LOOP
  events:=events+1;problems:='{}';
  IF e.sequence<>prev_sequence+1 THEN problems:=array_append(problems,'EVENT_SEQUENCE');END IF;
  IF e.previous_hash<>prev_hash THEN problems:=array_append(problems,'EVENT_LINK');END IF;
  IF e.hash<>private.vf_sha256(e.hash_input) THEN problems:=array_append(problems,'EVENT_DIGEST');END IF;
  BEGIN
   input:=e.hash_input::jsonb;
   expected:=jsonb_build_object('owner',e.owner_id,'sequence',e.sequence,'kind',e.event_kind,'documentKind',e.document_kind,'document',e.document_id,'actor',e.actor_id,'details',e.details,'previousHash',e.previous_hash);
   IF (input-'at') IS DISTINCT FROM expected OR (input->>'at')::timestamptz IS DISTINCT FROM e.occurred_at THEN problems:=array_append(problems,'EVENT_FIELDS');END IF;
  EXCEPTION WHEN OTHERS THEN problems:=array_append(problems,'EVENT_FIELDS');END;
  FOREACH code IN ARRAY problems LOOP issues:=issues||jsonb_build_array(jsonb_build_object('code',code,'eventId',e.id,'sequence',e.sequence));END LOOP;
  prev_hash:=e.hash;prev_sequence:=e.sequence;
 END LOOP;
 SELECT coalesce(jsonb_agg(d ORDER BY d->>'day' DESC),'[]') INTO days FROM (
  SELECT jsonb_build_object('day',(generated_at AT TIME ZONE 'Europe/Madrid')::date,'altas',count(*) FILTER(WHERE record_kind='alta'),'cancellations',count(*) FILTER(WHERE record_kind='anulacion')) d
  FROM private.verifactu_records WHERE owner_id=p_owner GROUP BY (generated_at AT TIME ZONE 'Europe/Madrid')::date ORDER BY (generated_at AT TIME ZONE 'Europe/Madrid')::date DESC LIMIT 31
 )daily;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'generatedAt' DESC),'[]') INTO recent FROM (
  SELECT jsonb_build_object('id',id,'sequence',sequence,'kind',record_kind,'generatedAt',generated_at,'hash',hash,'invoiceId',invoice_id) x FROM private.verifactu_records WHERE owner_id=p_owner ORDER BY generated_at DESC,id DESC LIMIT 25
 )recent_records;
 RETURN jsonb_build_object('checkedAt',statement_timestamp(),'mode',coalesce((SELECT mode FROM private.verifactu_settings WHERE owner_id=p_owner),'disabled'),'status',CASE WHEN jsonb_array_length(issues)>0 THEN 'broken' WHEN total=0 THEN 'empty' ELSE 'ok' END,'recordCount',total,'altaCount',altas,'cancellationCount',cancelled,'eventCount',events,'issueCount',jsonb_array_length(issues),'issues',(SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(issues) WITH ORDINALITY v(x,n) WHERE n<=100),'issuesTruncated',jsonb_array_length(issues)>100,'days',days,'recent',recent,'aeatConnected',false);
END$$;

CREATE FUNCTION private.mfa_impl_verifactu_integrity_report() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT private.vf_integrity_report(private.vf_actor_owner())$$;
CREATE FUNCTION public.verifactu_integrity_report() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 PERFORM public.security_mfa_assert(false);
 RETURN private.mfa_impl_verifactu_integrity_report();
END$$;
REVOKE ALL ON FUNCTION private.vf_integrity_report(uuid),private.mfa_impl_verifactu_integrity_report() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.verifactu_integrity_report() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.verifactu_integrity_report() TO authenticated;
INSERT INTO private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
SELECT p.oid::regprocedure::text,p.oid,'private.mfa_impl_verifactu_integrity_report()'::regprocedure,pg_get_functiondef(p.oid),md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid='public.verifactu_integrity_report()'::regprocedure;
COMMIT;
