-- Owner decision 2026-10-22: NO scheduled purge until affected counts are reviewed.
-- Deliberately no cron.schedule, credential access, or purge invocation here.
-- private.pickup_document_config.purge_enabled defaults to false as a second gate.
-- Activation requires a separate reviewed change with exact SQL and prior counts.
select 1;
