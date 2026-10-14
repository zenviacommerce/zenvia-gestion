-- The aggregate returns exactly one row, not PostgreSQL's default 1,000.
-- Accurate cardinality avoids oversized joins/sorts across all analytics RPCs.
alter function private.amazon_mapping_cost_snapshot(uuid,uuid,text,date) rows 1;

-- Range scans for account-wide adjustments must not read every order component.
create index if not exists amazon_finance_unassigned_period_idx
  on public.amazon_finance_components(owner_id,posted_date,marketplace_id)
  where nullif(amazon_order_id,'') is null
    and component_category not in ('sale_audit','tax_audit');

-- Successful jobs contribute zero to all three completeness counts.
create index if not exists amazon_sync_incomplete_owner_period_idx
  on public.amazon_sync_jobs(owner_id,source,window_to,window_from,marketplace_id)
  include(status) where status in ('queued','running','failed');

do $migration$
declare
  r record;
  definition text;
  old_tax text := 'and c.amazon_order_id is not null';
  new_tax text := $replacement$and c.amazon_order_id is not null
      and exists (
        select 1 from public.amazon_orders scoped
        where scoped.owner_id=c.owner_id
          and scoped.amazon_account_id=c.amazon_account_id
          and scoped.marketplace_id=c.marketplace_id
          and scoped.amazon_order_id=c.amazon_order_id
          and scoped.purchase_date >= from_date::timestamptz
          and scoped.purchase_date < (to_date+1)::timestamptz
          and lower(coalesce(scoped.order_status,'')) not in ('canceled','cancelled')
          and (marketplace_ids is null or cardinality(marketplace_ids)=0 or scoped.marketplace_id=any(marketplace_ids))
      )$replacement$;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'amazon_analytics_summary_without_fbm_20260917',
      'amazon_analytics_series_without_fbm_20260917'
    )
  loop
    definition:=pg_get_functiondef(r.oid);
    if position('select 1 from public.amazon_orders scoped' in definition)=0 then
      if position(old_tax in definition)=0 then raise exception 'Analytics tax audit pattern missing'; end if;
      definition:=replace(definition,old_tax,new_tax);
    end if;
    definition:=replace(definition,'where j.owner_id=v_owner',
      'where j.owner_id=v_owner and j.status in (''queued'',''running'',''failed'')');
    execute definition;
  end loop;
end;
$migration$;

-- Persist account display names so an optional metadata lookup cannot change rows.
update public.fulfillment_orders o
set integration_name=a.display_name
from public.integration_accounts a
where o.source_integration_account_id=a.id and o.owner_id=a.owner_id
  and o.source_channel='amazon' and a.provider='amazon'
  and nullif(trim(a.display_name),'') is not null
  and o.integration_name is distinct from a.display_name;

analyze public.amazon_finance_components;
analyze public.amazon_sync_jobs;
