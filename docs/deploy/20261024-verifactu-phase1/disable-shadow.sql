-- Emergency kill switch: preserve guards, issued numbers, chains and snapshots.
BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
SET LOCAL application_name='verifactu_shadow_disabled_preserve_history';
UPDATE private.verifactu_settings SET mode='disabled' WHERE owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';
COMMIT;
-- Cancelling a shadow-registered invoice is blocked while shadow is disabled;
-- re-enable under owner control to append its cancellation. No number is recycled.
