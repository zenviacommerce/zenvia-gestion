-- Actual production ACL captured before hardening; owner postgres.
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
BEGIN;
GRANT EXECUTE ON FUNCTION public.amazon_close_recovered_order_failures() TO PUBLIC, anon, authenticated, service_role;
COMMIT;
