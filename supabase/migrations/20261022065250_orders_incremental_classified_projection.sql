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

-- Operations can disable reads or all maintenance immediately, without DDL.
CREATE TABLE private.orders_projection_control(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 read_enabled boolean NOT NULL DEFAULT true,maintenance_enabled boolean NOT NULL DEFAULT true);
INSERT INTO private.orders_projection_control VALUES(true,true,true);
-- Append-only: simultaneous imports never contend on one dirty-group row.
CREATE TABLE private.orders_projection_dirty(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL,group_key text NOT NULL,queued_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX orders_projection_dirty_group_idx ON private.orders_projection_dirty(owner_id,group_key,id);
CREATE TABLE private.orders_projection_failures(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),sqlstate text NOT NULL,owner_id uuid,group_key text);
-- xmin + ctid identify each tuple version, including repeated updates inside
-- the same transaction (xmin alone would miss those). Never use app timestamps.
CREATE TABLE private.orders_projection_groups(owner_id uuid NOT NULL,group_key text NOT NULL,
 has_row boolean NOT NULL,PRIMARY KEY(owner_id,group_key));
ALTER TABLE private.orders_projection_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.orders_projection_groups FROM PUBLIC,anon,authenticated;
CREATE TABLE private.orders_projection_versions(kind text NOT NULL,id uuid NOT NULL,owner_id uuid NOT NULL,
 group_key text NOT NULL,version text NOT NULL,PRIMARY KEY(kind,id));
CREATE INDEX orders_projection_versions_group_idx ON private.orders_projection_versions(owner_id,group_key);
ALTER TABLE private.orders_projection_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.orders_projection_dirty ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.orders_projection_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.orders_projection_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.orders_projection_control,private.orders_projection_dirty,
 private.orders_projection_failures,private.orders_projection_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON private.orders_projection_control TO service_role;
GRANT SELECT ON private.orders_projection_dirty,private.orders_projection_failures TO service_role;

DO $projection$
DECLARE source text; prefix text; scoped text; boundary integer; cols text; assignments text;
 f record; stamps text;
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
 stamps:='DELETE FROM private.orders_projection_versions WHERE owner_id=p_owner AND group_key=p_key;
 INSERT INTO private.orders_projection_versions SELECT ''orders'',o.id,o.owner_id,p_key,(o.xmin::text||'':''||o.ctid::text)
 FROM public.fulfillment_orders o WHERE o.owner_id=p_owner AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p_key;';
 IF position('public.shipment_tracking_state' IN scoped)>0 THEN
  stamps:=stamps||' INSERT INTO private.orders_projection_versions SELECT ''tracking'',t.order_id,o.owner_id,p_key,(t.xmin::text||'':''||t.ctid::text)
  FROM public.shipment_tracking_state t JOIN public.fulfillment_orders o ON o.id=t.order_id
  WHERE o.owner_id=p_owner AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p_key;';
 END IF;
 EXECUTE format('CREATE FUNCTION private.orders_dashboard_projection_refresh(p_owner uuid,p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS %L',
 'BEGIN
  '||stamps||'
  WITH refreshed AS MATERIALIZED ('||scoped||' SELECT c.*,p_key AS projection_group_key FROM classified c),
  upserted AS (INSERT INTO private.orders_dashboard_projection('||cols||') SELECT * FROM refreshed WHERE true
  ON CONFLICT(owner_id,projection_group_key) DO UPDATE SET '||assignments||' RETURNING 1)
  DELETE FROM private.orders_dashboard_projection p WHERE p.owner_id=p_owner AND p.projection_group_key=p_key
  AND NOT EXISTS(SELECT 1 FROM refreshed);
  INSERT INTO private.orders_projection_groups VALUES(p_owner,p_key,
   EXISTS(SELECT 1 FROM private.orders_dashboard_projection WHERE owner_id=p_owner AND projection_group_key=p_key))
  ON CONFLICT(owner_id,group_key) DO UPDATE SET has_row=excluded.has_row;
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

-- A cache error must not reject an otherwise valid business write. Every optional
-- write is inside a subtransaction; even failure recording has its own handler.
CREATE FUNCTION private.orders_projection_record_failure(p_state text,p_owner uuid DEFAULT NULL,p_key text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.orders_projection_failures(sqlstate,owner_id,group_key) VALUES(p_state,p_owner,p_key);
EXCEPTION WHEN OTHERS THEN
 RAISE LOG 'orders projection failure recorder unavailable (SQLSTATE %)',SQLSTATE;
END $$;
REVOKE ALL ON FUNCTION private.orders_projection_record_failure(text,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.orders_dashboard_projection_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='25ms' AS $$
BEGIN
 BEGIN
  IF NOT coalesce((SELECT maintenance_enabled FROM private.orders_projection_control WHERE singleton),false) THEN RETURN NULL;END IF;
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL;END IF;
  IF TG_OP<>'INSERT' THEN
   INSERT INTO private.orders_projection_dirty(owner_id,group_key)
   VALUES(OLD.owner_id,private.orders_dashboard_group_key(OLD.source_channel,OLD.order_number,OLD.id));
  END IF;
  IF TG_OP<>'DELETE' THEN
   INSERT INTO private.orders_projection_dirty(owner_id,group_key)
   VALUES(NEW.owner_id,private.orders_dashboard_group_key(NEW.source_channel,NEW.order_number,NEW.id));
  END IF;
 EXCEPTION WHEN OTHERS THEN
  BEGIN
   PERFORM private.orders_projection_record_failure(SQLSTATE,
    CASE WHEN TG_OP='DELETE' THEN OLD.owner_id ELSE NEW.owner_id END,
    CASE WHEN TG_OP='DELETE' THEN private.orders_dashboard_group_key(OLD.source_channel,OLD.order_number,OLD.id)
    ELSE private.orders_dashboard_group_key(NEW.source_channel,NEW.order_number,NEW.id) END);
  EXCEPTION WHEN OTHERS THEN RAISE LOG 'orders projection queue and recorder unavailable';
  END;
 END;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.orders_dashboard_projection_changed() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zzzz_orders_dashboard_projection_changed AFTER INSERT OR UPDATE OR DELETE ON public.fulfillment_orders
FOR EACH ROW EXECUTE FUNCTION private.orders_dashboard_projection_changed();

-- Worker-only serialization: the business write path never takes a group lock.
-- Limit is groups per call; each group still scales with its actual source size.
CREATE FUNCTION private.orders_dashboard_projection_reconcile(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g record;done integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'INVALID_PROJECTION_BATCH_LIMIT';END IF;
 IF NOT coalesce((SELECT maintenance_enabled FROM private.orders_projection_control WHERE singleton),false) THEN RETURN 0;END IF;
 FOR g IN WITH oldest AS MATERIALIZED (
  SELECT id,owner_id,group_key FROM private.orders_projection_dirty ORDER BY id LIMIT p_limit*10
 ) SELECT owner_id,group_key,max(id) last_id FROM oldest
 GROUP BY owner_id,group_key ORDER BY min(id) LIMIT p_limit LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(g.owner_id::text||':'||g.group_key,719)) THEN CONTINUE;END IF;
  BEGIN
   PERFORM private.orders_dashboard_projection_refresh(g.owner_id,g.group_key);
   DELETE FROM private.orders_projection_dirty WHERE owner_id=g.owner_id AND group_key=g.group_key AND id<=g.last_id;
   done:=done+1;
  EXCEPTION WHEN OTHERS THEN
   PERFORM private.orders_projection_record_failure(SQLSTATE,g.owner_id,g.group_key);
  END;
 END LOOP;
 RETURN done;
END $$;
REVOKE ALL ON FUNCTION private.orders_dashboard_projection_reconcile(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.orders_dashboard_projection_reconcile(integer) TO service_role;

-- Operator recovery after a pause or recorder outage. Discovers at most p_limit
-- groups for one tenant; it may scan that tenant's source/version keys. Repeat
-- and reconcile until no mismatches remain. No business rows are modified.
CREATE FUNCTION private.orders_dashboard_projection_repair_enqueue(p_owner uuid,p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'INVALID_PROJECTION_BATCH_LIMIT';END IF;
 INSERT INTO private.orders_projection_dirty(owner_id,group_key)
 SELECT p_owner,k FROM (
  SELECT private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) k
  FROM public.fulfillment_orders o LEFT JOIN private.orders_projection_versions v ON v.kind='orders' AND v.id=o.id
  WHERE o.owner_id=p_owner AND (v.id IS NULL OR (o.xmin::text||':'||o.ctid::text) IS DISTINCT FROM v.version OR o.owner_id IS DISTINCT FROM v.owner_id)
  UNION
  SELECT v.group_key FROM private.orders_projection_versions v LEFT JOIN public.fulfillment_orders o ON o.id=v.id
  WHERE v.kind='orders' AND v.owner_id=p_owner AND (o.id IS NULL OR (o.xmin::text||':'||o.ctid::text) IS DISTINCT FROM v.version OR o.owner_id IS DISTINCT FROM v.owner_id)
  UNION
  SELECT coalesce(p.projection_group_key,g.group_key) FROM
   (SELECT projection_group_key FROM private.orders_dashboard_projection WHERE owner_id=p_owner) p
   FULL JOIN (SELECT group_key FROM private.orders_projection_groups WHERE owner_id=p_owner AND has_row) g
   ON g.group_key=p.projection_group_key WHERE p.projection_group_key IS NULL OR g.group_key IS NULL
 ) missing WHERE NOT EXISTS(SELECT 1 FROM private.orders_projection_dirty d WHERE d.owner_id=p_owner AND d.group_key=k)
 ORDER BY k LIMIT p_limit;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.orders_dashboard_projection_repair_enqueue(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.orders_dashboard_projection_repair_enqueue(uuid,integer) TO service_role;

-- Missing queue entries (including a failed recorder or a paused trigger) cannot
-- authorize stale reads. Validate both directions against this query snapshot.
CREATE FUNCTION private.orders_dashboard_projection_usable() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE own uuid:=private.app_workspace_owner_id();
BEGIN
 IF NOT coalesce((SELECT read_enabled AND maintenance_enabled FROM private.orders_projection_control WHERE singleton),false) THEN RETURN false;END IF;
 IF NOT private.app_has_permission('orders') OR NOT private.mfa_allowed() THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM private.orders_projection_dirty WHERE owner_id=own) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM (SELECT id,owner_id,xmin,ctid FROM public.fulfillment_orders WHERE owner_id=own) o FULL JOIN
  (SELECT * FROM private.orders_projection_versions WHERE kind='orders' AND owner_id=own) v ON v.id=o.id
  WHERE (o.owner_id=own OR v.owner_id=own) AND
  (o.id IS NULL OR v.id IS NULL OR o.owner_id IS DISTINCT FROM v.owner_id OR (o.xmin::text||':'||o.ctid::text) IS DISTINCT FROM v.version)) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM (SELECT projection_group_key FROM private.orders_dashboard_projection WHERE owner_id=own) p
  FULL JOIN (SELECT group_key FROM private.orders_projection_groups WHERE owner_id=own AND has_row) g
  ON g.group_key=p.projection_group_key WHERE p.projection_group_key IS NULL OR g.group_key IS NULL) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION private.orders_dashboard_projection_usable() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.orders_dashboard_projection_usable() TO authenticated,service_role;
-- Direct derived-table reads must obey the same freshness/PII gate as RPCs.
CREATE POLICY orders_projection_fresh ON private.orders_dashboard_projection AS RESTRICTIVE FOR SELECT TO authenticated
 USING((SELECT private.orders_dashboard_projection_usable()));

DO $tracking_dependency$
DECLARE def text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.orders_dashboard_projection_refresh(uuid,text)'::regprocedure AND position('public.shipment_tracking_state' IN prosrc)>0) THEN
  EXECUTE $function$CREATE FUNCTION private.orders_dashboard_projection_tracking_changed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='25ms' AS $body$
  DECLARE old_id uuid;new_id uuid;
  BEGIN
   BEGIN
    IF NOT coalesce((SELECT maintenance_enabled FROM private.orders_projection_control WHERE singleton),false) THEN RETURN NULL;END IF;
    IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL;END IF;
    IF TG_OP<>'INSERT' THEN old_id:=OLD.order_id;END IF;
    IF TG_OP<>'DELETE' THEN new_id:=NEW.order_id;END IF;
    INSERT INTO private.orders_projection_dirty(owner_id,group_key)
    SELECT f.owner_id,private.orders_dashboard_group_key(f.source_channel,f.order_number,f.id)
    FROM public.fulfillment_orders f WHERE f.id IN(old_id,new_id);
   EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM private.orders_projection_record_failure(SQLSTATE);
    EXCEPTION WHEN OTHERS THEN RAISE LOG 'orders tracking projection queue and recorder unavailable';END;
   END;
   RETURN NULL;
  END $body$ $function$;
  EXECUTE 'REVOKE ALL ON FUNCTION private.orders_dashboard_projection_tracking_changed() FROM PUBLIC,anon,authenticated';
  EXECUTE 'CREATE TRIGGER orders_dashboard_projection_tracking_changed AFTER INSERT OR UPDATE OR DELETE ON public.shipment_tracking_state FOR EACH ROW EXECUTE FUNCTION private.orders_dashboard_projection_tracking_changed()';
  SELECT pg_get_functiondef('private.orders_dashboard_projection_repair_enqueue(uuid,integer)'::regprocedure) INTO def;
  EXECUTE replace(def,'UNION'||chr(10)||'  SELECT coalesce', $repair$UNION
  SELECT private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) FROM public.shipment_tracking_state t
   JOIN public.fulfillment_orders o ON o.id=t.order_id
   LEFT JOIN private.orders_projection_versions v ON v.kind='tracking' AND v.id=t.order_id
   WHERE o.owner_id=p_owner AND (v.id IS NULL OR (t.xmin::text||':'||t.ctid::text) IS DISTINCT FROM v.version)
  UNION
  SELECT v.group_key FROM private.orders_projection_versions v LEFT JOIN public.shipment_tracking_state t ON t.order_id=v.id
   WHERE v.kind='tracking' AND v.owner_id=p_owner AND t.order_id IS NULL
  UNION
  SELECT coalesce$repair$);
  SELECT pg_get_functiondef('private.orders_dashboard_projection_usable()'::regprocedure) INTO def;
  EXECUTE replace(def,'RETURN true;', $guard$IF EXISTS(
   SELECT 1 FROM (SELECT t.order_id,(t.xmin::text||':'||t.ctid::text) version FROM public.shipment_tracking_state t
    JOIN public.fulfillment_orders o ON o.id=t.order_id WHERE o.owner_id=own) t
   FULL JOIN (SELECT * FROM private.orders_projection_versions WHERE kind='tracking' AND owner_id=own) v ON v.id=t.order_id
   WHERE t.order_id IS NULL OR v.id IS NULL OR t.version IS DISTINCT FROM v.version
  ) THEN RETURN false;END IF;
  RETURN true;$guard$);
 END IF;
END $tracking_dependency$;

-- Independent storage-retention cleanup also runs while maintenance is paused.
-- Only NEW derived rows are deleted; source orders/tracking are never modified.
CREATE FUNCTION private.orders_dashboard_projection_cleanup(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;g record;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'INVALID_PROJECTION_BATCH_LIMIT';END IF;
 n:=0;
 FOR g IN SELECT p.owner_id,p.projection_group_key FROM private.orders_dashboard_projection p
 WHERE NOT EXISTS(SELECT 1 FROM public.fulfillment_orders o WHERE o.owner_id=p.owner_id
  AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p.projection_group_key)
 OR EXISTS(SELECT 1 FROM private.orders_projection_versions v LEFT JOIN public.fulfillment_orders o ON o.id=v.id
  WHERE v.kind='orders' AND v.owner_id=p.owner_id AND v.group_key=p.projection_group_key
  AND (o.id IS NULL OR o.owner_id IS DISTINCT FROM v.owner_id OR
   private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id) IS DISTINCT FROM v.group_key))
 OR EXISTS(SELECT 1 FROM public.fulfillment_orders o LEFT JOIN private.orders_projection_versions v ON v.kind='orders' AND v.id=o.id
  WHERE o.owner_id=p.owner_id AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p.projection_group_key
  AND o.pii_purged_at IS NOT NULL AND (v.id IS NULL OR v.version IS DISTINCT FROM (o.xmin::text||':'||o.ctid::text)))
 ORDER BY p.owner_id,p.projection_group_key LIMIT p_limit LOOP
  -- No source-write path takes this lock. A busy worker is retried next tick.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(g.owner_id::text||':'||g.projection_group_key,719)) THEN CONTINUE;END IF;
  DELETE FROM private.orders_dashboard_projection WHERE owner_id=g.owner_id AND projection_group_key=g.projection_group_key;
  n:=n+1;
  BEGIN
   INSERT INTO private.orders_projection_dirty(owner_id,group_key) VALUES(g.owner_id,g.projection_group_key);
  EXCEPTION WHEN OTHERS THEN PERFORM private.orders_projection_record_failure(SQLSTATE,g.owner_id,g.projection_group_key);
  END;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.orders_dashboard_projection_cleanup(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.orders_dashboard_projection_cleanup(integer) TO service_role;

DO $schedule$
BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE $job$SELECT cron.schedule('orders-dashboard-projection','* * * * *',
   'BEGIN; SET LOCAL statement_timeout=''5s''; SELECT private.orders_dashboard_projection_cleanup(100); COMMIT; BEGIN; SET LOCAL statement_timeout=''5s''; SELECT private.orders_dashboard_projection_reconcile(100) WHERE EXISTS(SELECT 1 FROM private.orders_projection_dirty); COMMIT;')$job$;
 ELSE
  RAISE NOTICE 'pg_cron unavailable: projection runner must be configured before activation';
 END IF;
END $schedule$;
