-- Immutable, buyer-PII-free pickup receipts. No shipping provider is called.
-- Only the RPCs may write. All tenant-scoped RPCs recheck existing MFA/access.
CREATE TABLE private.pickup_report_counters (
 owner_id uuid NOT NULL, report_year integer NOT NULL, last_number integer NOT NULL CHECK(last_number>0),
 PRIMARY KEY(owner_id,report_year)
);
ALTER TABLE private.pickup_report_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pickup_report_counters FROM PUBLIC,anon,authenticated;
CREATE TABLE public.pickup_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
 request_id uuid NOT NULL, request_fingerprint jsonb NOT NULL,
 number text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 snapshot jsonb NOT NULL, UNIQUE(owner_id,request_id), UNIQUE(owner_id,number)
);
CREATE TABLE public.pickup_report_items (
 report_id uuid NOT NULL REFERENCES public.pickup_reports(id), owner_id uuid NOT NULL,
 order_id uuid NOT NULL, order_key text NOT NULL,
 PRIMARY KEY(report_id,order_key)
);
CREATE INDEX pickup_report_items_order_idx ON public.pickup_report_items(owner_id,order_id);
CREATE INDEX pickup_report_items_key_idx ON public.pickup_report_items(owner_id,order_key);
CREATE INDEX pickup_reports_created_idx ON public.pickup_reports(owner_id,created_at DESC);
ALTER TABLE public.pickup_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_report_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY pickup_reports_owner_read ON public.pickup_reports FOR SELECT TO authenticated
 USING(owner_id=(SELECT private.app_workspace_owner_id()) AND (SELECT private.app_has_permission('orders')));
CREATE POLICY pickup_report_items_owner_read ON public.pickup_report_items FOR SELECT TO authenticated
 USING(owner_id=(SELECT private.app_workspace_owner_id()) AND (SELECT private.app_has_permission('orders')));
-- No direct table grants: sensitive snapshots require an MFA-gated RPC even for reads.
REVOKE ALL ON public.pickup_reports,public.pickup_report_items FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.pickup_report_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'PICKUP_REPORT_IMMUTABLE' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION private.pickup_report_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER pickup_reports_immutable BEFORE UPDATE OR DELETE ON public.pickup_reports
 FOR EACH ROW EXECUTE FUNCTION private.pickup_report_immutable();
CREATE TRIGGER pickup_report_items_immutable BEFORE UPDATE OR DELETE ON public.pickup_report_items
 FOR EACH ROW EXECUTE FUNCTION private.pickup_report_immutable();

CREATE FUNCTION private.pickup_report_owner() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.security_mfa_assert(false);
 v_owner:=private.app_workspace_owner_id();
 IF v_owner IS NULL THEN RAISE EXCEPTION 'ACCESS_DISABLED' USING ERRCODE='42501'; END IF;
 IF NOT coalesce(private.app_has_permission('orders'),false) THEN
 RAISE EXCEPTION 'PICKUP_ORDERS_PERMISSION_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN v_owner;
END $$;
REVOKE ALL ON FUNCTION private.pickup_report_owner() FROM PUBLIC,anon,authenticated;

-- The existing dashboard is the canonical filter/dedupe source. Clone it at migration
-- time, keeping its public signature/behavior untouched. Only the selectable scope
-- changes: pickup previews need labelled/shipped/missing-label matches as well.
-- A source guard fails closed if a subsequent dashboard rewrite needs review.
DO $clone$
DECLARE src text; original text;
BEGIN
 SELECT pg_get_functiondef('public.orders_dashboard_page_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[])'::regprocedure) INTO original;
 src:=replace(original,'FUNCTION public.orders_dashboard_page_v1(', 'FUNCTION private.pickup_report_dashboard_scope(');
 IF src=original OR position('FROM public.fulfillment_orders o' IN src)=0
 OR position('SELECT id FROM eligible WHERE order_state=''pending'' AND pii_purged_at IS NULL' IN src)=0
 THEN RAISE EXCEPTION 'PICKUP_DASHBOARD_SOURCE_CHANGED'; END IF;
 src:=replace(src,'FROM public.fulfillment_orders o','FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()');
 src:=replace(src,'SELECT id FROM eligible WHERE order_state=''pending'' AND pii_purged_at IS NULL','SELECT id FROM eligible');
 EXECUTE src;
END $clone$;
REVOKE ALL ON FUNCTION private.pickup_report_dashboard_scope(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[]) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pickup_report_selection(p_filters jsonb DEFAULT '{}',p_limit integer DEFAULT 2000) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.pickup_report_owner();
 IF jsonb_typeof(p_filters) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PICKUP_INVALID_FILTERS' USING ERRCODE='22023'; END IF;
 RETURN private.pickup_report_dashboard_scope(
 p_from=>nullif(p_filters->>'from','')::date,p_to=>nullif(p_filters->>'to','')::date,
 p_state=>coalesce(nullif(p_filters->>'state',''),'all'),p_channel=>coalesce(p_filters->>'channel','all'),
 p_query=>coalesce(p_filters->>'query',''),p_tracking=>coalesce(p_filters->>'tracking','all'),
 p_country=>coalesce(p_filters->>'country','all'),p_carrier=>coalesce(p_filters->>'carrier','all'),
 p_selection_ids_only=>true,p_selection_limit=>p_limit);
END $$;

-- Internal preview whitelists business/shipping fields. It never serializes an order
-- record. A submitted canonical dashboard ID may obtain its real label from a
-- duplicate marketplace row belonging to the same tenant and logical order.
CREATE FUNCTION private.pickup_report_preview_items(p_owner uuid,p_order_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF coalesce(cardinality(p_order_ids),0)=0 OR cardinality(p_order_ids)>2000 OR array_position(p_order_ids,NULL) IS NOT NULL
 THEN RAISE EXCEPTION 'PICKUP_INVALID_SELECTION' USING ERRCODE='22023'; END IF;
 IF cardinality(p_order_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)
 THEN RAISE EXCEPTION 'PICKUP_DUPLICATE_SELECTION' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT id) FROM public.fulfillment_orders WHERE owner_id=p_owner AND id=ANY(p_order_ids))
 <> (SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)
 THEN RAISE EXCEPTION 'PICKUP_ORDERS_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF (SELECT count(DISTINCT CASE WHEN o.source_channel IN ('amazon','shopify') AND nullif(trim(o.order_number),'') IS NOT NULL
 THEN o.source_channel||':'||coalesce(o.source_integration_account_id::text,'legacy')||':'||trim(o.order_number) ELSE o.id::text END) FROM public.fulfillment_orders o WHERE o.owner_id=p_owner AND o.id=ANY(p_order_ids))<>cardinality(p_order_ids)
 THEN RAISE EXCEPTION 'PICKUP_DUPLICATE_SELECTION' USING ERRCODE='22023'; END IF;
 WITH requested AS (
 SELECT
 o.id,o.order_number,o.source_channel,o.source_integration_account_id,
 CASE WHEN o.source_channel IN ('amazon','shopify') AND nullif(trim(o.order_number),'') IS NOT NULL
 THEN o.source_channel||':'||coalesce(o.source_integration_account_id::text,'legacy')||':'||trim(o.order_number) ELSE o.id::text END order_key
 FROM public.fulfillment_orders o WHERE o.owner_id=p_owner AND o.id=ANY(p_order_ids)
 ORDER BY CASE WHEN o.source_channel IN ('amazon','shopify') AND nullif(trim(o.order_number),'') IS NOT NULL
 THEN o.source_channel||':'||coalesce(o.source_integration_account_id::text,'legacy')||':'||trim(o.order_number) ELSE o.id::text END,o.id
 ), siblings AS MATERIALIZED (
 SELECT r.id requested_id,o.* FROM requested r JOIN public.fulfillment_orders o ON o.owner_id=p_owner AND (
 o.id=r.id OR (r.source_channel IN ('amazon','shopify') AND nullif(trim(r.order_number),'') IS NOT NULL
 AND o.source_channel=r.source_channel AND o.source_integration_account_id IS NOT DISTINCT FROM r.source_integration_account_id
 AND trim(o.order_number)=trim(r.order_number)))
 ), cancellation AS (
 SELECT requested_id,
 bool_or(lower(coalesce(source_status,'')) LIKE '%cancel%') order_cancelled,
 bool_or(pii_purged_at IS NOT NULL) purged,
 greatest(max(label_cancelled_at),max(CASE WHEN
 lower(coalesce(tracking_status_code,'')) LIKE '%cancel%' OR lower(coalesce(tracking_status_message,'')) LIKE '%cancel%'
 THEN coalesce(label_cancelled_at,tracking_updated_at,updated_at) END)) latest_cancelled_at,
 bool_or((lower(coalesce(tracking_status_code,'')) LIKE '%cancel%' OR lower(coalesce(tracking_status_message,'')) LIKE '%cancel%')
 AND coalesce(label_cancelled_at,tracking_updated_at,updated_at) IS NULL) undated_cancellation
 FROM siblings GROUP BY requested_id
 ), candidate AS (
 SELECT r.*,l.tracking_number,l.carrier,l.valid_label,c.purged,
 -- Never resurrect an old uncancelled copy. A replacement is valid only when
 -- its actual label creation strictly follows every known cancellation event.
 (c.order_cancelled OR c.undated_cancellation OR (c.latest_cancelled_at IS NOT NULL
 AND (l.label_created_at IS NULL OR l.label_created_at<=c.latest_cancelled_at))) cancelled,
 coalesce((SELECT jsonb_agg(pr.number ORDER BY pr.created_at,pr.number)
 FROM public.pickup_report_items pi JOIN public.pickup_reports pr ON pr.id=pi.report_id
 WHERE pi.owner_id=p_owner AND pi.order_key=r.order_key),'[]'::jsonb) previous
 FROM requested r JOIN cancellation c ON c.requested_id=r.id CROSS JOIN LATERAL (
 SELECT o.tracking_number,o.label_created_at,CASE WHEN lower(coalesce(o.shipping_provider,''))='mrw' THEN 'MRW'
 ELSE coalesce(nullif(trim(o.carrier_name),''),nullif(trim(o.carrier_code),'')) END carrier,
 (o.label_created_at IS NOT NULL OR o.sendcloud_parcel_id IS NOT NULL OR nullif(o.shipping_remote_id,'') IS NOT NULL OR nullif(o.shipping_label_url,'') IS NOT NULL) valid_label
 FROM siblings o WHERE o.requested_id=r.id
 ORDER BY (o.label_created_at IS NOT NULL) DESC,o.label_created_at DESC NULLS LAST,
 (nullif(trim(o.tracking_number),'') IS NOT NULL) DESC,o.id
 LIMIT 1
 ) l
 ), checked AS (
 SELECT *,CASE WHEN source_channel NOT IN ('amazon','shopify') OR source_channel IS NULL THEN 'unsupported_channel'
 WHEN purged THEN 'purged_order' WHEN cancelled THEN 'cancelled_label'
 WHEN NOT valid_label THEN 'missing_label' WHEN nullif(trim(tracking_number),'') IS NULL THEN 'missing_tracking'
 WHEN carrier IS NULL THEN 'missing_carrier' END issue FROM candidate
 )
 SELECT jsonb_build_object('items',jsonb_agg(jsonb_build_object('orderId',id,'orderNumber',order_number,'channel',source_channel,
 'carrier',carrier,'trackingNumber',CASE WHEN NOT cancelled AND NOT purged AND valid_label THEN tracking_number END,
 'packages',1,'packageCountEstimated',true,'eligible',issue IS NULL,'issue',issue,'previousReports',previous,'orderKey',order_key) ORDER BY order_number,id),
 'totalPackages',count(*),'canCreate',bool_and(issue IS NULL)) INTO result FROM checked;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.pickup_report_preview_items(uuid,uuid[]) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pickup_report_preview(p_order_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=private.pickup_report_owner(); data jsonb;
BEGIN
 data:=private.pickup_report_preview_items(v_owner,p_order_ids);
 RETURN jsonb_set(data,'{items}',(SELECT jsonb_agg(item-'orderKey') FROM jsonb_array_elements(data->'items') item));
END $$;

CREATE FUNCTION public.pickup_report_get(p_report_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=private.pickup_report_owner(); result jsonb;
BEGIN
 SELECT snapshot INTO result FROM public.pickup_reports WHERE owner_id=v_owner AND id=p_report_id;
 IF result IS NULL THEN RAISE EXCEPTION 'PICKUP_REPORT_NOT_FOUND' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.pickup_report_create(p_order_ids uuid[],p_request_id uuid,p_allow_duplicates boolean DEFAULT false,p_package_counts jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=private.pickup_report_owner(); v_data jsonb; v_items jsonb; v_sender jsonb; v_report jsonb;
 v_id uuid:=gen_random_uuid(); v_created timestamptz:=now(); v_year integer:=extract(year FROM now() AT TIME ZONE 'Europe/Madrid');
 v_seq integer; v_number text; v_fingerprint jsonb; v_existing public.pickup_reports%rowtype; v_entry record;
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'PICKUP_REQUEST_ID_REQUIRED' USING ERRCODE='22023'; END IF;
 IF cardinality(p_order_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)
 THEN RAISE EXCEPTION 'PICKUP_DUPLICATE_SELECTION' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_package_counts) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PICKUP_INVALID_PACKAGES' USING ERRCODE='22023'; END IF;
 FOR v_entry IN SELECT * FROM jsonb_each(p_package_counts) LOOP
 IF jsonb_typeof(v_entry.value)<>'number' OR v_entry.value::text !~ '^([1-9]|[1-9][0-9]|100)$'
 OR NOT(v_entry.key=ANY(SELECT x::text FROM unnest(p_order_ids) x))
 THEN RAISE EXCEPTION 'PICKUP_INVALID_PACKAGES' USING ERRCODE='22023'; END IF;
 END LOOP;
 v_fingerprint:=jsonb_build_object('ids',(SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT unnest(p_order_ids) x)s),
 'packages',p_package_counts,'allowDuplicates',coalesce(p_allow_duplicates,false));
 -- One transaction per tenant serializes counter, retry and overlapping membership
 -- decisions. Hash collisions merely serialize unrelated tenants, never authorize.
 PERFORM pg_advisory_xact_lock(hashtextextended('pickup-report:'||v_owner::text,0));
 SELECT * INTO v_existing FROM public.pickup_reports WHERE owner_id=v_owner AND request_id=p_request_id;
 IF FOUND THEN
 IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'PICKUP_REQUEST_REUSED' USING ERRCODE='22023'; END IF;
 RETURN v_existing.snapshot;
 END IF;
 -- Snapshot labels may live on canonical siblings, so lock every existing
 -- sibling in the same stable order used by all receipt transactions.
 PERFORM o.id FROM public.fulfillment_orders o WHERE o.owner_id=v_owner AND (o.id=ANY(p_order_ids) OR EXISTS(
 SELECT 1 FROM public.fulfillment_orders requested WHERE requested.owner_id=v_owner AND requested.id=ANY(p_order_ids)
 AND requested.source_channel IN ('amazon','shopify') AND nullif(trim(requested.order_number),'') IS NOT NULL
 AND o.source_channel=requested.source_channel AND o.source_integration_account_id IS NOT DISTINCT FROM requested.source_integration_account_id
 AND trim(o.order_number)=trim(requested.order_number)))
 ORDER BY o.id FOR UPDATE OF o;
 v_data:=private.pickup_report_preview_items(v_owner,p_order_ids);
 IF NOT (v_data->>'canCreate')::boolean THEN RAISE EXCEPTION 'PICKUP_INELIGIBLE_ORDERS' USING ERRCODE='22023'; END IF;
 IF NOT coalesce(p_allow_duplicates,false) AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_data->'items') item WHERE jsonb_array_length(item->'previousReports')>0)
 THEN RAISE EXCEPTION 'PICKUP_ALREADY_REPORTED' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('legalName',legal_name,'taxId',tax_id,
 'address',concat_ws(', ',nullif(address_line1,''),nullif(address_line2,''),nullif(concat_ws(' ',postal_code,city),''),nullif(province,''),nullif(country_code,'')),
 'email',email,'phone',phone) INTO v_sender FROM public.business_settings WHERE owner_id=v_owner;
 IF v_sender IS NULL OR nullif(trim(v_sender->>'legalName'),'') IS NULL THEN RAISE EXCEPTION 'PICKUP_SENDER_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg((item-'orderKey'-'previousReports'-'issue'-'eligible')||jsonb_build_object(
 'packages',coalesce((p_package_counts->>(item->>'orderId'))::integer,1),
 'packageCountEstimated',NOT(p_package_counts ? (item->>'orderId')))) INTO v_items FROM jsonb_array_elements(v_data->'items') item;
 INSERT INTO private.pickup_report_counters(owner_id,report_year,last_number) VALUES(v_owner,v_year,1)
 ON CONFLICT(owner_id,report_year) DO UPDATE SET last_number=private.pickup_report_counters.last_number+1 RETURNING last_number INTO v_seq;
 v_number:='REC-'||v_year::text||'-'||lpad(v_seq::text,greatest(4,length(v_seq::text)),'0');
 v_report:=jsonb_build_object('id',v_id,'number',v_number,'createdAt',v_created,'createdBy',auth.uid(),
 'sender',v_sender,'items',v_items,'totalPackages',(SELECT sum((item->>'packages')::integer) FROM jsonb_array_elements(v_items) item));
 INSERT INTO public.pickup_reports(id,owner_id,request_id,request_fingerprint,number,created_at,created_by,snapshot)
 VALUES(v_id,v_owner,p_request_id,v_fingerprint,v_number,v_created,auth.uid(),v_report);
 INSERT INTO public.pickup_report_items(report_id,owner_id,order_id,order_key)
 SELECT v_id,v_owner,(item->>'orderId')::uuid,item->>'orderKey' FROM jsonb_array_elements(v_data->'items') item;
 RETURN v_report;
END $$;

CREATE FUNCTION public.pickup_report_list(p_order_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=private.pickup_report_owner(); v_key text;
BEGIN
 IF p_order_id IS NOT NULL THEN
 SELECT CASE WHEN source_channel IN ('amazon','shopify') AND nullif(trim(order_number),'') IS NOT NULL
 THEN source_channel||':'||coalesce(source_integration_account_id::text,'legacy')||':'||trim(order_number) ELSE id::text END INTO v_key FROM public.fulfillment_orders WHERE owner_id=v_owner AND id=p_order_id;
 IF v_key IS NULL THEN RAISE EXCEPTION 'PICKUP_ORDERS_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN coalesce((SELECT jsonb_agg(summary ORDER BY created_at DESC,id DESC) FROM (
 SELECT r.id,r.created_at,jsonb_build_object('id',r.id,'number',r.number,'createdAt',r.created_at,
 'totalPackages',r.snapshot->'totalPackages','totalOrders',jsonb_array_length(r.snapshot->'items'),
 'carriers',(SELECT jsonb_agg(carrier ORDER BY carrier) FROM (SELECT DISTINCT item->>'carrier' carrier FROM jsonb_array_elements(r.snapshot->'items') item)c)) summary
 FROM public.pickup_reports r WHERE r.owner_id=v_owner AND (p_order_id IS NULL OR EXISTS(
 SELECT 1 FROM public.pickup_report_items pi WHERE pi.report_id=r.id AND pi.owner_id=v_owner AND (pi.order_id=p_order_id OR pi.order_key=v_key)))
 ORDER BY r.created_at DESC,r.id DESC LIMIT least(greatest(coalesce(p_limit,50),1),200)
 )s),'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.pickup_report_selection(jsonb,integer),public.pickup_report_preview(uuid[]),
 public.pickup_report_create(uuid[],uuid,boolean,jsonb),public.pickup_report_get(uuid),public.pickup_report_list(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pickup_report_selection(jsonb,integer),public.pickup_report_preview(uuid[]),
 public.pickup_report_create(uuid[],uuid,boolean,jsonb),public.pickup_report_get(uuid),public.pickup_report_list(uuid,integer) TO authenticated;
