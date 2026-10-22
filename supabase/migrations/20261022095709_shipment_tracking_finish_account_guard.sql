-- Revalidate the account and workspace after provider HTTP, before accepting a
-- leased observation. No order/label/marketplace writes or existing data DML.
-- Replacing the current definition retains its signature, invoker security,
-- grants, terminal/identity/privacy checks and provider civil-time handling.
SET LOCAL lock_timeout='3s';
DO $finish_guard$
DECLARE src text;anchor text;
BEGIN
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure) THEN
  RAISE EXCEPTION 'TRACKING_FINISH_SECURITY_CHANGED';
 END IF;
 src:=pg_get_functiondef('public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure);
 anchor:=' if p_error is null and p_event is not null then';
 IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1
 OR position('o.pii_purged_at is not null' IN src)=0
 OR position('private.shipment_tracking_terminal(s.provider,o.tracking_status_code)' IN src)=0
 OR position('private.shipment_tracking_identity(o)<>p_identity' IN src)=0
 OR position('raw_event_time=case' IN src)=0 THEN
  RAISE EXCEPTION 'TRACKING_FINISH_ACCOUNT_GUARD_SOURCE_CHANGED';
 END IF;
 src:=replace(src,anchor,$guard$
 -- Lock current account/workspace rows until this observation commits. Account
 -- disablement, reassignment or provider changes during HTTP invalidate it.
 PERFORM 1 FROM public.integration_accounts a
 JOIN public.workspaces w ON w.id=a.owner_id
 WHERE a.id=s.account_id AND a.owner_id=s.owner_id AND a.provider=s.provider
 AND a.enabled AND a.status<>'disabled' AND w.status IN('active','trialing')
 FOR SHARE OF a,w;
 IF NOT FOUND THEN RETURN false;END IF;
 if p_error is null and p_event is not null then$guard$);
 anchor:=' return true;'||chr(10)||'end;';
 IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'TRACKING_FINISH_ACCOUNT_GUARD_RETURN_CHANGED';
 END IF;
 src:=replace(src,anchor,' return true;'||chr(10)||$guard$EXCEPTION WHEN lock_not_available THEN
 -- Roll back this candidate's function writes and let a later run retry it.
 RETURN false;
end;$guard$);
 EXECUTE src;
END $finish_guard$;
ALTER FUNCTION public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text) SET lock_timeout='25ms';
