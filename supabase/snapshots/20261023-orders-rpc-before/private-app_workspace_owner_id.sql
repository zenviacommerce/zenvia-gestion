CREATE OR REPLACE FUNCTION private.app_workspace_owner_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.app_workspace_id()
$function$
