-- Fase 0: rollback snapshot (2026-10-15)
-- Schedules comprobados con SELECT cron.job antes de modificarlos.
-- Para restaurar las frecuencias originales:
SELECT cron.alter_job(8, schedule := '* * * * *');
SELECT cron.alter_job(10, schedule := '*/5 * * * *');
SELECT cron.alter_job(11, schedule := '*/30 * * * *');

-- Estado original de todos los cron:
-- 1 amazon-orchestrator-hourly       7 * * * *
-- 4 amazon-fx-daily                 17 4 * * *
-- 5 amazon-product-images-refresh   */10 * * * *
-- 8 amazon-sync-worker              * * * * *
-- 9 amazon-orders-five-minutes      */5 * * * *
-- 10 amazon-recipient-fallback-refresh */5 * * * *
-- 11 shopify-analytics-sync         */30 * * * *

-- Funciones: copia ejecutable de las definiciones actuales (sin modificar).
-- private.amazon_claim_sync_jobs(integer)
-- public.amazon_claim_sync_jobs(integer)
-- Se guardan por separado en la misma carpeta.
