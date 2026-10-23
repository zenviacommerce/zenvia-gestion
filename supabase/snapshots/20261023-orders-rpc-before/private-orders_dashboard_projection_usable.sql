CREATE OR REPLACE FUNCTION private.orders_dashboard_projection_usable()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 IF EXISTS(SELECT 1 FROM private.orders_projection_groups g CROSS JOIN private.orders_projection_classifier c
 WHERE g.owner_id=own AND g.classifier_generation<>c.required_generation) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.fulfillment_orders o WHERE o.owner_id=own AND NOT EXISTS(SELECT 1 FROM private.orders_projection_groups g WHERE g.owner_id=o.owner_id AND g.group_key=private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id))) THEN RETURN false;END IF;
 IF EXISTS(
   SELECT 1 FROM (SELECT t.order_id,(t.xmin::text||':'||t.ctid::text) version FROM public.shipment_tracking_state t
    JOIN public.fulfillment_orders o ON o.id=t.order_id WHERE o.owner_id=own) t
   FULL JOIN (SELECT * FROM private.orders_projection_versions WHERE kind='tracking' AND owner_id=own) v ON v.id=t.order_id
   WHERE t.order_id IS NULL OR v.id IS NULL OR t.version IS DISTINCT FROM v.version
  ) THEN RETURN false;END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
