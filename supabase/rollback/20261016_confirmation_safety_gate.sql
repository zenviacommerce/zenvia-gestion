-- Gate mutating confirmation entry points before any rollback.
-- Retain the ledger and its data. Never drop uncertain operations or restore blind POST retries.
-- Original claim definitions are in 20261016_confirmation_original_claims.sql.
-- Restore those definitions ONLY after every pending/prepared/needs_review operation has
-- been resolved and the confirmation/worker/cancellation endpoints remain paused.
do $$ begin
 if exists(select 1 from public.amazon_confirmation_operations where state in('prepared','pending_verification','needs_review')) then
  raise exception 'Rollback blocked: unresolved confirmation operations must be retained and reconciled';
 end if;
end $$;
