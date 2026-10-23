-- Restore the currently installed trigger implementation; keep existing ACLs.
CREATE OR REPLACE FUNCTION private.orders_dashboard_projection_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='25ms' AS $$
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
