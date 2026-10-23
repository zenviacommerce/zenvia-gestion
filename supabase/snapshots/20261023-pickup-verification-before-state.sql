CREATE OR REPLACE FUNCTION private.pickup_document_json(p_report uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',r.id,'status',coalesce(s.status,'pending'),'revision',coalesce(s.revision,0),'signedAt',s.signed_at,'signedBy',s.signed_by,
 'voidedAt',s.voided_at,'voidedBy',s.voided_by,'voidReason',s.void_reason,'piiPurgedAt',s.pii_purged_at,'piiExpired',coalesce(s.expires_at<=now(),false),'retentionUntil',s.expires_at,
 'pdfAvailable',s.pdf_path is not null and (s.pii_purged_at is not null or s.expires_at is null or s.expires_at>now()),
 'signatures',coalesce((select jsonb_agg(jsonb_build_object('carrier',g.carrier,'signedAt',g.created_at,'signedBy',g.created_by,'packages',g.packages,
 'actorName',(select nullif(u.full_name,'') from public.app_users u where u.user_id=g.created_by and u.data_owner_id=r.owner_id)) order by g.carrier) from private.pickup_document_signatures g where g.report_id=r.id),'[]'::jsonb),
 'carriers',(select jsonb_agg(carrier order by carrier) from (select distinct trim(item->>'carrier') carrier from jsonb_array_elements(r.snapshot->'items')item)c))
 from public.pickup_reports r left join private.pickup_document_state s on s.report_id=r.id where r.id=p_report
$function$
;
