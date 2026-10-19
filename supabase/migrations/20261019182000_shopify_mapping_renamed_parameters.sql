-- The MFA clone has a different implicit PL/pgSQL block name. Use positional
-- arguments in its SQL so its business body survives implementation renaming.
-- Keep the public MFA wrapper, its OID/hash/ACL, and the historical manifest.
DO $migration$
DECLARE
  impl oid;
  body text;
  definition text;
  wrapper oid := 'public.shopify_get_product_mappings(uuid,text)'::regprocedure::oid;
BEGIN
  SELECT implementation::oid INTO STRICT impl
  FROM private.mfa_function_manifest WHERE function_oid=wrapper;
  IF NOT EXISTS(SELECT 1 FROM private.mfa_function_manifest
      WHERE function_oid=wrapper AND wrapper_hash=md5(pg_get_functiondef(wrapper))) THEN
    RAISE EXCEPTION 'SHOPIFY_MAPPING_WRAPPER_DRIFT';
  END IF;
  SELECT p.prosrc INTO STRICT body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=impl AND n.nspname='private' AND l.lanname='plpgsql' AND p.prosecdef
    AND p.proargnames=ARRAY['integration_account_id','seller_sku']::text[];
  IF strpos(body,'shopify_get_product_mappings.integration_account_id')=0
     OR strpos(body,'shopify_get_product_mappings.seller_sku')=0 THEN
    RAISE EXCEPTION 'SHOPIFY_MAPPING_IMPLEMENTATION_DRIFT';
  END IF;
  definition:=pg_get_functiondef(impl);
  body:=replace(replace(body,'shopify_get_product_mappings.integration_account_id','$1'),
    'shopify_get_product_mappings.seller_sku','$2');
  IF strpos(body,'shopify_get_product_mappings.')>0 THEN
    RAISE EXCEPTION 'SHOPIFY_MAPPING_UNEXPECTED_QUALIFIER';
  END IF;
  -- Replace only the function body; SECURITY DEFINER, STABLE, search_path,
  -- parameter names and all existing privileges remain unchanged.
  EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=impl),body);
END;
$migration$;
-- Fail closed if another MFA clone still qualifies parameters with its old name.
DO $audit$
BEGIN
  IF EXISTS(SELECT 1 FROM private.mfa_function_manifest m
    JOIN pg_proc original ON original.oid=m.function_oid
    JOIN pg_proc implementation ON implementation.oid=m.implementation::oid
    WHERE strpos(implementation.prosrc,original.proname||'.')>0) THEN
    RAISE EXCEPTION 'MFA_RENAMED_PARAMETER_REFERENCE_REMAINS';
  END IF;
END;
$audit$;
