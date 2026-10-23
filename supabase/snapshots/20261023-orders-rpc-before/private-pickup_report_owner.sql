CREATE OR REPLACE FUNCTION private.pickup_report_owner()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_owner uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.security_mfa_assert(false);
 v_owner:=private.app_workspace_owner_id();
 IF v_owner IS NULL THEN RAISE EXCEPTION 'ACCESS_DISABLED' USING ERRCODE='42501'; END IF;
 IF NOT coalesce(private.app_has_permission('orders'),false) THEN
 RAISE EXCEPTION 'PICKUP_ORDERS_PERMISSION_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN v_owner;
END $function$
