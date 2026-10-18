-- Snapshot before PR #232 rename migration; production had no public.security_mfa_rename_factor(uuid,text).
-- Rollback only after disabling rename UI and confirming no in-flight RPC transactions.
BEGIN;
REVOKE ALL ON FUNCTION public.security_mfa_rename_factor(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.security_mfa_rename_factor(uuid,text);
COMMIT;
-- No factor data changes are rolled back: existing friendly names must be preserved.
