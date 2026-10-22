-- Legacy Sendcloud shipments may lack parcel metadata. A current same-owner
-- Sendcloud account and tracking number suffice for an authenticated API lookup.
-- Replace only the parcel-ID prerequisite; keep all existing eligibility guards,
-- signatures, invoker security and ACLs. No existing rows are changed here.
SET LOCAL lock_timeout='3s';
DO $coverage$
DECLARE target record;src text;anchor text;required_guard text;
BEGIN
 FOR target IN
  SELECT 'public.tracking_seed_shadow()'::regprocedure AS signature,'a' AS provider_alias,
   ARRAY['a.owner_id=o.owner_id','w.status in(''active'',''trialing'')',
    'a.enabled and a.status<>''disabled''','o.pii_purged_at is null',
    'o.label_cancelled_at is null','nullif(o.tracking_number,'''') is not null',
    'not private.shipment_tracking_terminal(a.provider,o.tracking_status_code)',
    'existing.identity_key=private.shipment_tracking_identity(o)'] AS guards
  UNION ALL
  SELECT 'public.tracking_reprocess_candidates()'::regprocedure,'s',
   ARRAY['a.owner_id=s.owner_id and a.provider=s.provider',
    'w.status in(''active'',''trialing'')','a.enabled and a.status<>''disabled''',
    'o.shipping_integration_account_id=s.account_id','o.pii_purged_at is null',
    'o.label_cancelled_at is null','nullif(trim(o.tracking_number),'''') is not null',
    'private.shipment_tracking_identity(o)=s.identity_key',
    'coalesce(s.normalized_state,'''') not in(''delivered'',''returned'',''cancelled'')',
    'not private.shipment_tracking_terminal(s.provider,o.tracking_status_code)']
 LOOP
  IF (SELECT prosecdef FROM pg_proc WHERE oid=target.signature) THEN
   RAISE EXCEPTION 'TRACKING_LEGACY_SENDCLOUD_SECURITY_CHANGED: %',target.signature;
  END IF;
  src:=pg_get_functiondef(target.signature);
  FOREACH required_guard IN ARRAY target.guards LOOP
   IF position(required_guard IN src)=0 THEN
    RAISE EXCEPTION 'TRACKING_LEGACY_SENDCLOUD_GUARD_CHANGED: %',target.signature;
   END IF;
  END LOOP;
  anchor:=format('(o.shipping_provider is null and %s.provider=''sendcloud'' and o.sendcloud_parcel_id is not null)',target.provider_alias);
  IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1
   OR position(format('o.shipping_provider=%s.provider or ',target.provider_alias) IN src)=0 THEN
   RAISE EXCEPTION 'TRACKING_LEGACY_SENDCLOUD_SOURCE_CHANGED: %',target.signature;
  END IF;
  EXECUTE replace(src,anchor,format('(o.shipping_provider is null and %s.provider=''sendcloud'')',target.provider_alias));
 END LOOP;
END $coverage$;
