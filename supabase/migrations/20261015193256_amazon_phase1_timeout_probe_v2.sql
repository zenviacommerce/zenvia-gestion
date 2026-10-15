CREATE OR REPLACE FUNCTION public.amazon_phase1_timeout_probe_v2() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN PERFORM pg_catalog.pg_sleep(1); RETURN 'completed'; END $$;
ALTER FUNCTION public.amazon_phase1_timeout_probe_v2() SET statement_timeout='100ms';
REVOKE ALL ON FUNCTION public.amazon_phase1_timeout_probe_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_phase1_timeout_probe_v2() TO service_role;