-- One-time cache seed after schema migration and before worker deployment.
-- Reads ledger JSON without rewriting ledger/component source rows.
insert into private.amazon_finance_deferred_references(owner_id,amazon_account_id,deferred_transaction_id,released_transaction_id)
select t.owner_id,t.amazon_account_id,i->>'value',t.id from public.amazon_finance_transactions t
cross join lateral jsonb_array_elements(case when jsonb_typeof(t.related_identifiers)='array' then t.related_identifiers else '[]'::jsonb end) i
where i->>'name'='DEFERRED_TRANSACTION_ID' and nullif(i->>'value','') is not null
on conflict do nothing;
