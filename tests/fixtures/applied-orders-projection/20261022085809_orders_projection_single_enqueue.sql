-- Proposed only: avoid duplicate queue entries for UPDATE within one tenant/group.
-- No business data UPDATE/DELETE, no DROP, no read activation.
CREATE OR REPLACE FUNCTION private.orders_dashboard_projection_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='25ms' AS $$
DECLARE old_key text;new_key text;
BEGIN
 BEGIN
  IF NOT coalesce((SELECT maintenance_enabled FROM private.orders_projection_control WHERE singleton),false) THEN RETURN NULL;END IF;
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL;END IF;
  IF TG_OP<>'INSERT' THEN
   old_key:=private.orders_dashboard_group_key(OLD.source_channel,OLD.order_number,OLD.id);
   INSERT INTO private.orders_projection_dirty(owner_id,group_key)
   VALUES(OLD.owner_id,old_key);
  END IF;
  IF TG_OP<>'DELETE' THEN
   new_key:=private.orders_dashboard_group_key(NEW.source_channel,NEW.order_number,NEW.id);
   IF TG_OP='INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR new_key IS DISTINCT FROM old_key THEN
    INSERT INTO private.orders_projection_dirty(owner_id,group_key) VALUES(NEW.owner_id,new_key);
   END IF;
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
