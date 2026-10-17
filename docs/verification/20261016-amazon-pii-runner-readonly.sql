-- READ ONLY. Metadata, aggregate counts and JSON keys only, never buyer values.
select table_schema,table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema in ('public','private') and
 (table_name in ('amazon_orders','amazon_order_items','amazon_sync_jobs','amazon_sync_runs','amazon_sync_state','amazon_finance_transactions','fulfillment_orders','audit_logs')
 or table_name ~ '(tracking|recipient)') order by table_schema,table_name,ordinal_position;
select count(*) jobs,count(*) filter(where payload<>'{}'::jsonb) payloads,
 count(*) filter(where last_error is not null) errors from public.amazon_sync_jobs;
select distinct k key from public.amazon_sync_jobs cross join lateral jsonb_object_keys(payload) k order by k;
select count(*) runs,count(*) filter(where error_message is not null) errors,
 count(*) filter(where checkpoint<>'{}'::jsonb) checkpoints from public.amazon_sync_runs;
select distinct k key from public.amazon_sync_runs cross join lateral jsonb_object_keys(checkpoint) k order by k;
select distinct k key from public.amazon_sync_state cross join lateral jsonb_object_keys(checkpoint) k order by k;
select count(*) total,count(*) filter(where sendcloud_id like 'amazon:%') synthetic_amazon,
 count(*) filter(where sendcloud_id ~ '^[0-9]+$') numeric_external from public.fulfillment_orders where source_channel='amazon';
select count(*) direct_order_audits from public.audit_logs a where exists(
 select 1 from public.fulfillment_orders f where f.source_channel='amazon' and a.workspace_owner_id=f.owner_id
 and a.entity_id in(f.id::text,f.order_id,f.order_number));
select count(*) transactions,count(*) filter(where metadata<>'{}'::jsonb) metadata_nonempty,
 count(*) filter(where related_identifiers<>'[]'::jsonb) identifiers_nonempty from public.amazon_finance_transactions;
select distinct k key from public.amazon_finance_transactions cross join lateral jsonb_object_keys(metadata) k order by k;
-- A prior whole-table unrestricted recursive key census timed out; use a small
-- deterministic bounded sample instead. This is not exhaustive key/value proof.
with recursive sample as(select metadata from public.amazon_finance_transactions order by id limit 100),
walk(v,depth) as(select metadata,0 from sample union all
 select c.v,w.depth+1 from walk w cross join lateral(
 select value v from jsonb_each(case when jsonb_typeof(w.v)='object' then w.v else '{}'::jsonb end)
 union all select value from jsonb_array_elements(case when jsonb_typeof(w.v)='array' then w.v else '[]'::jsonb end)) c where w.depth<8)
select distinct k key from walk cross join lateral jsonb_object_keys(case when jsonb_typeof(v)='object' then v else '{}'::jsonb end) k order by k;
select distinct k key from public.amazon_finance_transactions
cross join lateral jsonb_array_elements(case when jsonb_typeof(related_identifiers)='array' then related_identifiers else '[]'::jsonb end) e
cross join lateral jsonb_object_keys(case when jsonb_typeof(e)='object' then e else '{}'::jsonb end) k order by k;
