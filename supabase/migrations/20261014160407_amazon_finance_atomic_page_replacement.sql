-- Indexed reverse references avoid scanning the entire JSON ledger on every page.
create table private.amazon_finance_deferred_references (
 owner_id uuid not null,amazon_account_id uuid not null,deferred_transaction_id text not null,
 released_transaction_id uuid not null references public.amazon_finance_transactions(id) on delete cascade,
 primary key(owner_id,amazon_account_id,deferred_transaction_id,released_transaction_id));
create index amazon_finance_deferred_reference_source_idx on private.amazon_finance_deferred_references(released_transaction_id);
alter table private.amazon_finance_deferred_references enable row level security;
revoke all on private.amazon_finance_deferred_references from public,anon,authenticated;
grant select,insert,update,delete on private.amazon_finance_deferred_references to service_role;
create function private.amazon_track_deferred_references() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 delete from private.amazon_finance_deferred_references r where r.released_transaction_id=new.id and
 (r.owner_id is distinct from new.owner_id or r.amazon_account_id is distinct from new.amazon_account_id or not exists(
  select 1 from jsonb_array_elements(coalesce(new.related_identifiers,'[]'::jsonb)) i where i->>'name'='DEFERRED_TRANSACTION_ID' and i->>'value'=r.deferred_transaction_id));
 insert into private.amazon_finance_deferred_references(owner_id,amazon_account_id,deferred_transaction_id,released_transaction_id)
 select new.owner_id,new.amazon_account_id,i->>'value',new.id from jsonb_array_elements(coalesce(new.related_identifiers,'[]'::jsonb)) i
 where i->>'name'='DEFERRED_TRANSACTION_ID' and nullif(i->>'value','') is not null on conflict do nothing;
 return new;
end;$$;
revoke all on function private.amazon_track_deferred_references() from public,anon,authenticated;
grant execute on function private.amazon_track_deferred_references() to service_role;
create trigger trg_amazon_track_deferred_references after insert or update of related_identifiers,transaction_status,owner_id,amazon_account_id on public.amazon_finance_transactions for each row execute function private.amazon_track_deferred_references();
-- Seed existing source references with scripts/sql/amazon-finance-deferred-reference-backfill.sql
-- before deploying the worker; source ledger rows are never rewritten by the seed.
-- One finance page is committed atomically, preserving IDs and avoiding timestamp-only writes.
-- Service-role-only: no browser role may replace ledger snapshots.
create function public.amazon_replace_finance_page(p_owner_id uuid,p_amazon_account_id uuid,p_page jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare entry jsonb;component_input jsonb;t public.amazon_finance_transactions;c public.amazon_finance_components;
 old_component public.amazon_finance_components;transaction_id uuid;country text;ledger_superseded boolean;
 retained_keys text[];processed integer:=0;old_transaction_id uuid;
begin
 if p_owner_id is null or p_amazon_account_id is null or not exists(select 1 from public.amazon_accounts a where a.id=p_amazon_account_id and a.owner_id=p_owner_id) then
  raise exception 'Invalid finance owner/account scope' using errcode='42501';end if;
 if jsonb_typeof(p_page) is distinct from 'array' or jsonb_array_length(p_page)>1000 then raise exception 'Expected a finance page array of at most 1000 transactions';end if;
 -- Serializes new as well as existing transaction keys, preventing concurrent pages
 -- from interleaving component replacement or deferred-transaction supersession.
 perform pg_advisory_xact_lock(hashtextextended('amazon-finance:'||p_owner_id::text||':'||p_amazon_account_id::text,0));
 -- Preserve provider page order so existing deferred-lifecycle trigger behavior is unchanged.
 select upper(coalesce(b.country_code,'')) into country from public.business_settings b where b.owner_id=p_owner_id limit 1;
 for entry in select value from jsonb_array_elements(p_page) with ordinality order by ordinality loop
  if jsonb_typeof(entry->'transaction') is distinct from 'object' or jsonb_typeof(entry->'components') is distinct from 'array' then raise exception 'Invalid finance page entry';end if;
  t:=jsonb_populate_record(null::public.amazon_finance_transactions,entry->'transaction');
  if t.owner_id is distinct from p_owner_id or t.amazon_account_id is distinct from p_amazon_account_id or coalesce(trim(t.transaction_key),'')='' then raise exception 'Invalid transaction scope' using errcode='42501';end if;
  -- No caller-controlled primary key or superseded flag is accepted.
  t.id:=null;t.synced_at:=now();t.updated_at:=now();
  select existing.id into transaction_id from public.amazon_finance_transactions existing
   where existing.owner_id=p_owner_id and existing.amazon_account_id=p_amazon_account_id and existing.transaction_key=t.transaction_key for update;
insert into public.amazon_finance_transactions as target(owner_id,amazon_account_id,transaction_key,amazon_transaction_id,marketplace_id,amazon_order_id,seller_sku,asin,posted_date,transaction_status,transaction_type,category,amount_original,currency_code,related_identifiers,metadata,amount_eur,fx_rate) values(t.owner_id,t.amazon_account_id,t.transaction_key,t.amazon_transaction_id,t.marketplace_id,t.amazon_order_id,t.seller_sku,t.asin,t.posted_date,t.transaction_status,t.transaction_type,t.category,t.amount_original,t.currency_code,t.related_identifiers,t.metadata,t.amount_eur,t.fx_rate) on conflict(owner_id,amazon_account_id,transaction_key) do update set amazon_transaction_id=excluded.amazon_transaction_id,marketplace_id=excluded.marketplace_id,amazon_order_id=excluded.amazon_order_id,seller_sku=excluded.seller_sku,asin=excluded.asin,posted_date=excluded.posted_date,transaction_status=excluded.transaction_status,transaction_type=excluded.transaction_type,category=excluded.category,amount_original=excluded.amount_original,currency_code=excluded.currency_code,related_identifiers=excluded.related_identifiers,metadata=excluded.metadata,amount_eur=excluded.amount_eur,fx_rate=excluded.fx_rate,updated_at=now() ,synced_at=now() where row(target.amazon_transaction_id,target.marketplace_id,target.amazon_order_id,target.seller_sku,target.asin,target.posted_date,target.transaction_status,target.transaction_type,target.category,target.amount_original,target.currency_code,target.related_identifiers,target.metadata) is distinct from row(excluded.amazon_transaction_id,excluded.marketplace_id,excluded.amazon_order_id,excluded.seller_sku,excluded.asin,excluded.posted_date,excluded.transaction_status,excluded.transaction_type,excluded.category,excluded.amount_original,excluded.currency_code,excluded.related_identifiers,excluded.metadata);
  processed:=processed+1;
 end loop;
 -- Incoming predecessors may be referenced by a Released row in this or an older page.
 -- The indexed reference cache is maintained by a ledger trigger on all write paths.
 for old_transaction_id in
  update public.amazon_finance_transactions old_tx set superseded=true,updated_at=now()
  where old_tx.owner_id=p_owner_id and old_tx.amazon_account_id=p_amazon_account_id and not old_tx.superseded
   and old_tx.transaction_key in(select e->'transaction'->>'transaction_key' from jsonb_array_elements(p_page) e)
   and exists(select 1 from private.amazon_finance_deferred_references r
    join public.amazon_finance_transactions source_tx on source_tx.id=r.released_transaction_id and source_tx.owner_id=p_owner_id and source_tx.amazon_account_id=p_amazon_account_id
    where r.owner_id=p_owner_id and r.amazon_account_id=p_amazon_account_id and r.deferred_transaction_id=old_tx.amazon_transaction_id
    -- Validate candidates against their source row; a concurrent one-time seed
    -- cannot turn an obsolete cached reference into a false supersession.
    and source_tx.related_identifiers @> jsonb_build_array(jsonb_build_object('name','DEFERRED_TRANSACTION_ID','value',old_tx.amazon_transaction_id)))
  returning old_tx.id
 loop
  delete from public.amazon_finance_components old_component_row where old_component_row.owner_id=p_owner_id and old_component_row.amazon_account_id=p_amazon_account_id and old_component_row.finance_transaction_id=old_transaction_id;
 end loop;
 -- All component eligibility decisions now see the complete, reconciled ledger.
 for entry in select value from jsonb_array_elements(p_page) with ordinality order by ordinality loop
  t:=jsonb_populate_record(null::public.amazon_finance_transactions,entry->'transaction');
  select existing.id,coalesce(existing.superseded,false) into transaction_id,ledger_superseded from public.amazon_finance_transactions existing
   where existing.owner_id=p_owner_id and existing.amazon_account_id=p_amazon_account_id and existing.transaction_key=t.transaction_key for update;
  retained_keys:=array[]::text[];
  for component_input in select value from jsonb_array_elements(entry->'components') order by value->>'component_key' loop
   c:=jsonb_populate_record(null::public.amazon_finance_components,component_input);
   if c.owner_id is distinct from p_owner_id or c.amazon_account_id is distinct from p_amazon_account_id or c.finance_transaction_id is not null or coalesce(trim(c.component_key),'')='' then raise exception 'Invalid component scope or identity' using errcode='42501';end if;
   c.finance_transaction_id:=transaction_id;c.id:=null;
   -- Apply the same eligibility and Spanish ServiceFee tax normalization as
   -- trg_amazon_prepare_finance_component_fast BEFORE comparing existing rows.
   -- Otherwise every unchanged gross-only fee would invoke an INSERT/UPDATE trigger.
   if ledger_superseded or (c.component_category='adjustment' and c.component_type='Adjustment (fallback)' and
     (coalesce(t.metadata,'{}'::jsonb)::text ilike '%ReserveDebit%' or coalesce(t.metadata,'{}'::jsonb)::text ilike '%ReserveCredit%')) then continue;end if;
   if c.tax_amount_original is null and t.transaction_type='ServiceFee' and c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee') and c.amount_original<>0 and country='ES' then
    c.tax_amount_original:=round(c.amount_original-(c.amount_original/1.21),6);end if;
   retained_keys:=array_append(retained_keys,c.component_key);
   select existing.* into old_component from public.amazon_finance_components existing where existing.owner_id=p_owner_id and existing.amazon_account_id=p_amazon_account_id and existing.finance_transaction_id=transaction_id and existing.component_key=c.component_key for update;
   if old_component.id is not null and row(old_component.marketplace_id,old_component.amazon_order_id,old_component.seller_sku,old_component.asin,old_component.posted_date,old_component.component_type,old_component.component_category,old_component.amount_original,old_component.currency_code,old_component.tax_amount_original) is not distinct from row(c.marketplace_id,c.amazon_order_id,c.seller_sku,c.asin,c.posted_date,c.component_type,c.component_category,c.amount_original,c.currency_code,c.tax_amount_original) then continue;end if;
insert into public.amazon_finance_components as target(owner_id,amazon_account_id,finance_transaction_id,component_key,marketplace_id,amazon_order_id,seller_sku,asin,posted_date,component_type,component_category,amount_original,currency_code,tax_amount_original,amount_eur,tax_amount_eur,fx_rate) values(c.owner_id,c.amazon_account_id,c.finance_transaction_id,c.component_key,c.marketplace_id,c.amazon_order_id,c.seller_sku,c.asin,c.posted_date,c.component_type,c.component_category,c.amount_original,c.currency_code,c.tax_amount_original,c.amount_eur,c.tax_amount_eur,c.fx_rate) on conflict(owner_id,amazon_account_id,finance_transaction_id,component_key) do update set marketplace_id=excluded.marketplace_id,amazon_order_id=excluded.amazon_order_id,seller_sku=excluded.seller_sku,asin=excluded.asin,posted_date=excluded.posted_date,component_type=excluded.component_type,component_category=excluded.component_category,amount_original=excluded.amount_original,currency_code=excluded.currency_code,tax_amount_original=excluded.tax_amount_original,amount_eur=excluded.amount_eur,tax_amount_eur=excluded.tax_amount_eur,fx_rate=excluded.fx_rate,updated_at=now() where row(target.marketplace_id,target.amazon_order_id,target.seller_sku,target.asin,target.posted_date,target.component_type,target.component_category,target.amount_original,target.currency_code,target.tax_amount_original) is distinct from row(excluded.marketplace_id,excluded.amazon_order_id,excluded.seller_sku,excluded.asin,excluded.posted_date,excluded.component_type,excluded.component_category,excluded.amount_original,excluded.currency_code,excluded.tax_amount_original);
  end loop;
  delete from public.amazon_finance_components obsolete where obsolete.owner_id=p_owner_id and obsolete.amazon_account_id=p_amazon_account_id and obsolete.finance_transaction_id=transaction_id and not(obsolete.component_key=any(retained_keys));
 end loop;
 return processed;
end;$$;
revoke all on function public.amazon_replace_finance_page(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.amazon_replace_finance_page(uuid,uuid,jsonb) to service_role;
