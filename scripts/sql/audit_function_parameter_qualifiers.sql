-- Read-only audit: renamed implicit PL/pgSQL labels and SQL self qualification.
SELECT m.signature AS public_rpc,m.implementation::text AS implementation,
  original.proname AS stale_qualifier
FROM private.mfa_function_manifest m
JOIN pg_proc original ON original.oid=m.function_oid
JOIN pg_proc implementation ON implementation.oid=m.implementation::oid
WHERE strpos(regexp_replace(implementation.prosrc,'["[:space:]]','','g'),original.proname||'.')>0;
SELECT n.nspname,p.oid::regprocedure::text AS signature,l.lanname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname IN('public','private') AND p.prokind='f' AND l.lanname='sql'
 AND strpos(regexp_replace(p.prosrc,'["[:space:]]','','g'),p.proname||'.')>0;
-- An unrenamed PL/pgSQL function's own-name parameter qualifier is valid;
-- review it, do not classify it as a defect merely because it contains a dot.
