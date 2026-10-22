-- Precompute the exact deduplicated/classified order row once per changed group.
-- No cross-tenant or parameter-result cache. Time-dependent period/KPI filters,
-- membership, selection, sorting and pagination remain in their original RPCs.
CREATE FUNCTION private.orders_dashboard_group_key(p_channel text,p_number text,p_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_channel IN ('amazon','shopify') AND trim(coalesce(p_number,''))<>''
 THEN p_channel||':'||trim(p_number) ELSE p_id::text END
$$;
REVOKE ALL ON FUNCTION private.orders_dashboard_group_key(text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.orders_dashboard_group_key(text,text,uuid) TO authenticated,service_role;
-- This index serves bounded trigger refreshes, not a duplicate sendcloud lookup.
SET LOCAL lock_timeout='3s';
CREATE INDEX fulfillment_orders_dashboard_group_idx ON public.fulfillment_orders
 (owner_id,private.orders_dashboard_group_key(source_channel,order_number,id));

CREATE TABLE private.orders_projection_rpc_backup(
 signature text PRIMARY KEY,original_definition text NOT NULL,optimized_hash text NOT NULL
);
ALTER TABLE private.orders_projection_rpc_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.orders_projection_rpc_backup FROM PUBLIC,anon,authenticated;

CREATE TABLE private.orders_projection_classifier(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),source_prefix text NOT NULL);
ALTER TABLE private.orders_projection_classifier ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.orders_projection_classifier FROM PUBLIC,anon,authenticated;

DO $projection$
DECLARE source text; prefix text; scoped text; boundary integer; cols text; assignments text;
 f record;
BEGIN
 SELECT prosrc INTO STRICT source FROM pg_proc WHERE oid='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure;
 boundary:=position(E',\nmatched AS (' IN source);
 IF boundary=0 THEN RAISE EXCEPTION 'ORDERS_PROJECTION_SOURCE_CHANGED';END IF;
 prefix:=left(source,boundary-1);
 IF position('FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()' IN prefix)=0 THEN RAISE EXCEPTION 'ORDERS_PROJECTION_TENANT_CHANGED';END IF;
 scoped:=replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()',
  'FROM public.fulfillment_orders o WHERE o.owner_id=p_owner AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p_key');
 EXECUTE 'CREATE TABLE private.orders_dashboard_projection AS '||replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()', 'FROM public.fulfillment_orders o WHERE false')||' SELECT * FROM classified WITH NO DATA';
 EXECUTE 'ALTER TABLE private.orders_dashboard_projection ADD COLUMN projection_group_key text NOT NULL, ADD PRIMARY KEY(owner_id,projection_group_key)';
 SELECT string_agg(format('%I',attname),',' ORDER BY attnum),string_agg(format('%1$I=excluded.%1$I',attname),',' ORDER BY attnum)
 INTO cols,assignments FROM pg_attribute WHERE attrelid='private.orders_dashboard_projection'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE format('CREATE FUNCTION private.orders_dashboard_projection_refresh(p_owner uuid,p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS %L',
 'BEGIN
  WITH refreshed AS MATERIALIZED ('||scoped||' SELECT c.*,p_key AS projection_group_key FROM classified c),
  upserted AS (INSERT INTO private.orders_dashboard_projection('||cols||') SELECT * FROM refreshed WHERE true
  ON CONFLICT(owner_id,projection_group_key) DO UPDATE SET '||assignments||' RETURNING 1)
  DELETE FROM private.orders_dashboard_projection p WHERE p.owner_id=p_owner AND p.projection_group_key=p_key
  AND NOT EXISTS(SELECT 1 FROM refreshed);
 END');
 -- Backfill once, preserving the original tenant boundary explicitly.
 FOR f IN SELECT DISTINCT owner_id,private.orders_dashboard_group_key(source_channel,order_number,id) group_key FROM public.fulfillment_orders LOOP
  PERFORM private.orders_dashboard_projection_refresh(f.owner_id,f.group_key);
 END LOOP;
 INSERT INTO private.orders_projection_classifier VALUES(true,prefix);
END $projection$;

ALTER TABLE private.orders_dashboard_projection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.orders_dashboard_projection FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.orders_dashboard_projection TO authenticated;
CREATE POLICY orders_projection_workspace_select ON private.orders_dashboard_projection FOR SELECT TO authenticated
 USING(owner_id=(SELECT private.app_workspace_owner_id()) AND (SELECT private.app_has_permission('orders')));
CREATE POLICY orders_projection_mfa_gate ON private.orders_dashboard_projection AS RESTRICTIVE FOR SELECT TO authenticated
 USING((SELECT private.mfa_allowed()));
REVOKE ALL ON FUNCTION private.orders_dashboard_projection_refresh(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.orders_dashboard_projection_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_key text;new_key text;
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL;END IF;
 IF TG_OP<>'INSERT' THEN old_key:=private.orders_dashboard_group_key(OLD.source_channel,OLD.order_number,OLD.id);END IF;
 IF TG_OP<>'DELETE' THEN new_key:=private.orders_dashboard_group_key(NEW.source_channel,NEW.order_number,NEW.id);END IF;
 -- Serialize mutations to one dedupe group (including competing inserts).
 -- Ordered locks prevent deadlocks when an edit moves between groups.
 PERFORM pg_advisory_xact_lock(k) FROM (SELECT DISTINCT hashtextextended(v,719) k FROM unnest(ARRAY[
  CASE WHEN TG_OP<>'INSERT' THEN OLD.owner_id::text||':'||old_key END,
  CASE WHEN TG_OP<>'DELETE' THEN NEW.owner_id::text||':'||new_key END])v WHERE v IS NOT NULL ORDER BY k)locks;
 IF TG_OP<>'INSERT' THEN PERFORM private.orders_dashboard_projection_refresh(OLD.owner_id,old_key);END IF;
 IF TG_OP<>'DELETE' AND (TG_OP='INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR new_key IS DISTINCT FROM old_key) THEN
  PERFORM private.orders_dashboard_projection_refresh(NEW.owner_id,new_key);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.orders_dashboard_projection_changed() FROM PUBLIC,anon,authenticated;
-- Run after zz_shipment_tracking_pii_purge: tracking row locks must precede
-- group/cache locks, matching polling updates and avoiding lock inversion.
CREATE TRIGGER zzzz_orders_dashboard_projection_changed AFTER INSERT OR UPDATE OR DELETE ON public.fulfillment_orders
FOR EACH ROW EXECUTE FUNCTION private.orders_dashboard_projection_changed();

-- Install the additional dependency when this migration follows the separately
-- approved tracking read-model release. It is deliberately absent for the
-- current legacy classifier, avoiding redundant work on shadow-only polling.
DO $tracking_dependency$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.orders_dashboard_projection_refresh(uuid,text)'::regprocedure AND position('public.shipment_tracking_state' IN prosrc)>0) THEN
  EXECUTE $function$CREATE FUNCTION private.orders_dashboard_projection_tracking_changed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
  DECLARE o record;old_id uuid;new_id uuid;
  BEGIN
   IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL;END IF;
   IF TG_OP<>'INSERT' THEN old_id:=OLD.order_id;END IF;
   IF TG_OP<>'DELETE' THEN new_id:=NEW.order_id;END IF;
   FOR o IN SELECT f.owner_id,private.orders_dashboard_group_key(f.source_channel,f.order_number,f.id) group_key
    FROM public.fulfillment_orders f WHERE f.id IN(old_id,new_id) ORDER BY f.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(o.owner_id::text||':'||o.group_key,719));
    PERFORM private.orders_dashboard_projection_refresh(o.owner_id,o.group_key);
   END LOOP;
   RETURN NULL;
  END $body$ $function$;
  EXECUTE 'REVOKE ALL ON FUNCTION private.orders_dashboard_projection_tracking_changed() FROM PUBLIC,anon,authenticated';
  EXECUTE 'CREATE TRIGGER orders_dashboard_projection_tracking_changed AFTER INSERT OR UPDATE OR DELETE ON public.shipment_tracking_state FOR EACH ROW EXECUTE FUNCTION private.orders_dashboard_projection_tracking_changed()';
 END IF;
END $tracking_dependency$;
