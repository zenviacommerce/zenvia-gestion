-- Persist provider movement history under the same current label/account/PII
-- guards as the latest observation. Applying this migration changes functions
-- only: no existing events, orders, labels or marketplace data are rewritten.
SET LOCAL lock_timeout='3s';
DO $history$
DECLARE src text;anchor text;
BEGIN
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure)
 OR NOT (SELECT coalesce(proconfig,'{}') @> ARRAY['lock_timeout=25ms'] FROM pg_proc WHERE oid='public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure) THEN
  RAISE EXCEPTION 'TRACKING_HISTORY_FINISH_SECURITY_CHANGED';
 END IF;
 src:=pg_get_functiondef('public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure);
 IF position('FOR SHARE OF a,w;' IN src)=0 OR position('o.pii_purged_at is not null' IN src)=0
 OR position('private.shipment_tracking_identity(o)<>p_identity' IN src)=0
 OR position('EXCEPTION WHEN lock_not_available THEN' IN src)=0 THEN
  RAISE EXCEPTION 'TRACKING_HISTORY_FINISH_GUARDS_CHANGED';
 END IF;
 anchor:=$old$ insert into public.shipment_tracking_events(order_id,owner_id,account_id,identity_key,event_key,normalized_state,raw_code,raw_message,event_at,raw_event_time)
 values(p_order,s.owner_id,s.account_id,p_identity,md5(p_event::text),p_event->>'state',left(p_event->>'code',120),left(p_event->>'message',500),nullif(p_event->>'eventAt','')::timestamptz,left(p_event->>'eventTimeRaw',40)) on conflict do nothing;$old$;
 IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'TRACKING_HISTORY_FINISH_INSERT_CHANGED';
 END IF;
 src:=replace(src,anchor,$new$ WITH incoming AS (
  SELECT p_event AS event,false AS provider_history
  UNION ALL
  SELECT item.event,true FROM jsonb_array_elements(
   CASE WHEN jsonb_typeof(p_event->'history')='array' THEN p_event->'history' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS item(event,n)
  WHERE item.n<=200 AND jsonb_typeof(item.event)='object'
 ), canonical AS (
  -- Explicit fields prevent nested histories, recipient details, warnings and
  -- observation/check times from entering either the record or its identity.
  SELECT DISTINCT jsonb_build_object(
   'state',event->>'state','code',left(event->>'code',120),
   'message',left(event->>'message',500),
   'eventAt',CASE WHEN nullif(event->>'eventAt','') IS NULL THEN NULL ELSE
    to_char((event->>'eventAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
   'eventTimeRaw',left(event->>'eventTimeRaw',40)
  ) AS event,provider_history FROM incoming
 ), movements AS (
  -- A reduced current state can retain the previous known state for an
  -- unknown status. The provider's history is the actual event; do not insert
  -- a second copy of it with the reducer's retained classification.
  SELECT DISTINCT ON(event-'state') event FROM canonical
  ORDER BY event-'state',provider_history DESC,event
 )
 INSERT INTO public.shipment_tracking_events(order_id,owner_id,account_id,identity_key,event_key,normalized_state,raw_code,raw_message,event_at,raw_event_time)
 SELECT p_order,s.owner_id,s.account_id,p_identity,md5(c.event::text),c.event->>'state',c.event->>'code',c.event->>'message',nullif(c.event->>'eventAt','')::timestamptz,c.event->>'eventTimeRaw'
 FROM movements c
 -- Earlier releases keyed the whole poll including observation time. Reuse
 -- equivalent legacy movements without modifying any pre-existing event.
 WHERE NOT EXISTS(SELECT 1 FROM public.shipment_tracking_events e
  WHERE e.order_id=p_order AND e.identity_key=p_identity
  AND e.normalized_state IS NOT DISTINCT FROM c.event->>'state'
  AND e.raw_code IS NOT DISTINCT FROM c.event->>'code'
  AND e.raw_message IS NOT DISTINCT FROM c.event->>'message'
  AND e.event_at IS NOT DISTINCT FROM nullif(c.event->>'eventAt','')::timestamptz
  AND e.raw_event_time IS NOT DISTINCT FROM c.event->>'eventTimeRaw')
 ON CONFLICT DO NOTHING;$new$);
 -- A provider movement can be valid while an older/current MRW status code is
 -- unknown to our dictionary. Preserve the safe warning for UI diagnostics,
 -- but accept its movement/history as a successful poll with zero failures.
 -- Authentication, transport and all other errors retain existing backoff.
 anchor:='p_error is null';
 IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>10 THEN
  RAISE EXCEPTION 'TRACKING_HISTORY_FINISH_ERROR_GUARDS_CHANGED';
 END IF;
 src:=replace(src,anchor,$warning$(p_error is null OR p_error ~ '^MRW_UNKNOWN_STATUS_([0-9]{1,4}|UNKNOWN)$')$warning$);
 EXECUTE src;
END $history$;
