-- Operational rollback: stop NEW mutations, retain all signed evidence and reads.
-- Review before execution. This file is prepared only; NOT executed in production.
-- Keep the B document reader/frontend for existing signed reports. A frontend
-- downgrade would lose the distinction between stored signed and unsigned PDFs.
begin;
revoke execute on function public.pickup_document_prepare(uuid,uuid,uuid,uuid,uuid,jsonb),public.pickup_document_complete(uuid,uuid,uuid,uuid,uuid,jsonb),public.pickup_document_void(uuid,uuid,uuid,text),public.pickup_document_mail_prepare(uuid,uuid,uuid,uuid,text,text,boolean,text) from service_role;
revoke execute on function public.pickup_report_create_batch(uuid[],uuid,boolean,jsonb),public.pickup_report_create(uuid[],uuid,boolean,jsonb) from authenticated;
-- Purge is already disabled and unscheduled; do not run it for rollback.
commit;
-- Deliberately retain statuses/read/PDF/mail-history and mail_finish for in-flight
-- receipt recording, plus operations and immutable artifacts. No DELETE/DROP.
