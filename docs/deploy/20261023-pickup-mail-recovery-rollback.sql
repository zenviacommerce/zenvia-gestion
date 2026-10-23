-- Emergency state rollback only; reintroduces the original blocked state. Do not use after a retry/reconciliation.
BEGIN;
UPDATE private.pickup_document_mail SET status='sending',error_code=NULL,finished_at=NULL WHERE owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2' AND request_id='3461de73-9eeb-4e61-b03b-6d5563903048' AND report_id='8a011430-1bb2-4c7f-9e9f-2ecb5af2b9b5' AND status='failed' AND error_code='EDGE_CPU_LIMIT' AND message_id IS NULL;
COMMIT;
