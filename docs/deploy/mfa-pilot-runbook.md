# MFA single-user pilot — PREPARED, NOT ACTIVATED

Scope: ZENVIA Gestión only. Production Supabase project `sjkxxbedkkmgmqnvaqjh`. Platform has independent Auth. Pilot only after user is present and explicitly approves execution; **never run activation merely because this file exists**.

## Preflight
1. Verify bridge PR #230 has been merged; production platform-bridge v31 active and all five bundle files match main. Verify real Platform read calls 200 with disabled flag.
2. Identify the operator's **Supabase Gestión auth.users.id** using a securely verified login/email-to-ID mapping. Do not confuse Platform Auth user ID, app_users role IDs, or client/workspace ID.
3. Record baseline: `SELECT enabled, cohort_user_ids FROM private.mfa_configuration WHERE singleton = true;` and ensure `enabled=false`; ensure target not suspended or recovery-locked. Capture cron/worker health and current v31 rollback snapshot path.
4. Confirm TOTP enabled, two independent authenticators available, account-recovery approval and emergency access ready. Browser session and secondary device must be available. Avoid changing any other user's session.
5. Prior to enabled=true, specifically recheck SQL behavior for the cohort target, outside-cohort admin, ordinary user, and `system:plan-sync` in a **rolled-back transaction**; ensure no missing-actor case becomes a delegation bypass.
6. Perform the pilot only in the explicit user-approved window. The Platform's current disabled-MFA read test does **not** establish enabled-MFA behavior.

## Activation — TEMPLATE ONLY; DO NOT EXECUTE NOW
Replace the UUID with the verified Gestión `auth.users.id` of the pilot operator; do not paste an example UUID from elsewhere.
```sql
BEGIN;
SELECT enabled, cohort_user_ids
FROM private.mfa_configuration
WHERE singleton = true
FOR UPDATE;

-- Abort if current baseline differs; never expand an existing cohort.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.mfa_configuration
    WHERE singleton = true
      AND enabled IS FALSE
      AND cohort_user_ids IS NULL
  ) THEN
    RAISE EXCEPTION 'MFA baseline changed: ABORT';
  END IF;
END $$;

UPDATE private.mfa_configuration
SET enabled = true,
    cohort_user_ids = ARRAY['<VERIFIED_GESTION_AUTH_USER_UUID>'::uuid]
WHERE singleton = true AND enabled IS FALSE AND cohort_user_ids IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.mfa_configuration
    WHERE singleton = true AND enabled = true
      AND cohort_user_ids = ARRAY['<VERIFIED_GESTION_AUTH_USER_UUID>'::uuid]
  ) THEN
    RAISE EXCEPTION 'MFA pilot cohort assertion failed';
  END IF;
END $$;
COMMIT;
```
This template assumes the configuration column types and singleton invariant from the deployed migration; recheck the actual schema and call signatures immediately before use. On unexpected SQL result, stop and rollback, never improvise a larger cohort.

## Emergency kill switch — pre-authorized command for pilot window
```sql
BEGIN;
UPDATE private.mfa_configuration
SET enabled = false
WHERE singleton = true;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.mfa_configuration
    WHERE singleton = true AND enabled IS FALSE
  ) THEN
    RAISE EXCEPTION 'MFA emergency disable assertion failed';
  END IF;
END $$;
COMMIT;
SELECT enabled, cohort_user_ids
FROM private.mfa_configuration
WHERE singleton = true;
```
Do not automatically clear the cohort in the emergency path; `enabled=false` is the immediate disable. Never disable TOTP tenant-wide or reset anyone else's factor as a substitute. Restore v30 only for a bridge code regression, not as an alternative to the SQL kill switch.

## Two authenticators — guided UI steps
1. With the verified target user's active Gestión session, navigate to **Configuración → Seguridad / Autenticadores** (component `MfaDevices`; actual label/visibility must be verified at pilot time).
2. Initiate first TOTP enrollment using the app's authorized enrollment/recovery workflow. Scan the QR in authenticator A, confirm code, and verify the account prompts an AAL2 challenge on next login.
3. In a fresh authorized AAL2 session, enroll independent authenticator B; do not store two copies of one TOTP seed. Verify distinct factors are shown and each can independently complete a challenge. If second-factor control is hidden before first factor, complete first enrollment/challenge before retrying.
4. Keep both devices and recovery process available. Never paste TOTP seeds or recovery codes in tickets, commits, logs or chat.

## Acceptance script
- Outside-cohort admin: routine Gestión RPC/data reads and Platform client read remain functional at AAL1.
- Ordinary outside-cohort user: normal login, product/order read, and Platform bridge delegation unchanged.
- Target pilot account: sign in; AAL1 requires TOTP; authenticate with A, logout/sign in with B; AAL2 required and valid for permitted operations; session refresh/relogin path.
- Recovery: with one factor temporarily unavailable, use approved recovery procedure; require identity authorization and verify both factors/locks are protected.
- Platform: ZENVIA client listing/users/integrations still work, and separately verified internal `system:plan-sync` request works only in a safe no-op path or carefully audited service execution. Missing verified token => 401, missing actor => deny when enabled.
- Monitor Auth 5xx, function_edge_logs, core startup RPCs, worker queues and cron. On regression immediately run kill switch, validate `enabled=false`, check real Platform calls, and journal evidence.
- Record start/end UTC, exact target UUID **privately** where access controlled, before/after SQL assertions, log request IDs, factor count (not secrets), result, and rollback decision. Stop before any cohort expansion.

## Rollback provenance
Exact bridge v30 bundle: `safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/platform-bridge-pre-pr230-v30.json`, deployed with `verify_jwt=false`. Current bridge v31, GitHub PR #230 merge commit `4a7fa1064de032d42ef4a3cddcf8593677b5bb00`.
