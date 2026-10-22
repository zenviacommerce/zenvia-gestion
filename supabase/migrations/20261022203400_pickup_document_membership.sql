-- Add states to the existing projection, without fetching signatures or driver PII.
do $$declare src text;needle text;wrapper text;v_oid oid;begin
 v_oid:='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure;
 src:=pg_get_functiondef(v_oid);
 needle:='FROM public.pickup_report_items pi WHERE pi.owner_id=c.owner_id AND (';
 if position(needle in src)=0 or position('p_pickup_report=''in''' in src)=0 then raise exception 'PICKUP_MEMBERSHIP_SOURCE_CHANGED';end if;
 src:=replace(src,'p_pickup_report=''in''','p_pickup_report IN (''in'',''pending'',''signed'',''void'')');
 src:=replace(src,needle,'FROM public.pickup_report_items pi WHERE pi.owner_id=c.owner_id AND (CASE WHEN p_pickup_report IN (''in'',''none'') THEN NOT EXISTS (SELECT 1 FROM private.pickup_document_state ds WHERE ds.report_id=pi.report_id AND ds.status=''void'') WHEN p_pickup_report=''pending'' THEN coalesce((SELECT ds.status FROM private.pickup_document_state ds WHERE ds.report_id=pi.report_id),''pending'') IN (''pending'',''partial'') ELSE coalesce((SELECT ds.status FROM private.pickup_document_state ds WHERE ds.report_id=pi.report_id),''pending'')=p_pickup_report END) AND (');
 needle:='jsonb_build_object(''id'',pr.id,''number'',pr.number)';
 if position(needle in src)=0 then raise exception 'PICKUP_MEMBERSHIP_JSON_CHANGED';end if;
 src:=replace(src,needle,'jsonb_build_object(''id'',pr.id,''number'',pr.number,''status'',coalesce((SELECT ds.status FROM private.pickup_document_state ds WHERE ds.report_id=pr.id),''pending''),''carriers'',coalesce((SELECT jsonb_agg(carrier ORDER BY carrier) FROM (SELECT DISTINCT i->>''carrier'' carrier FROM jsonb_array_elements(pr.snapshot->''items'')i)c),''[]''::jsonb))');
 execute src;
 -- Preserve the public audited guard, extending only its validated filter enum.
 v_oid:='public.orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure;
 wrapper:=pg_get_functiondef(v_oid);
 if position('''all'',''in'',''none''' in wrapper)=0 then raise exception 'PICKUP_MEMBERSHIP_WRAPPER_CHANGED';end if;
 execute replace(wrapper,'''all'',''in'',''none''','''all'',''in'',''none'',''pending'',''signed'',''void''');
 update private.mfa_function_manifest set wrapper_hash=md5(pg_get_functiondef(v_oid)) where function_oid=v_oid;
 if not found then raise exception 'PICKUP_MEMBERSHIP_MANIFEST_MISSING';end if;
end$$;
