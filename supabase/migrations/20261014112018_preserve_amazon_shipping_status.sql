-- Amazon PENDING is awaiting confirmation; UNSHIPPED is confirmed and ready to send.
-- Retain generic status normalization for other channels only.
create or replace function private.normalize_fulfillment_order_status()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.source_channel='amazon' then return new; end if;
  if lower(trim(coalesce(new.source_status,'')))='unshipped' then new.source_status:='Pending'; end if;
  return new;
end;
$$;

-- Restore ready Amazon statuses from the latest canonical account/order record.
with latest as (
  select distinct on (f.id) f.id,o.order_status,o.last_update_date
  from public.fulfillment_orders f
  join public.integration_accounts a on a.id=f.source_integration_account_id and a.owner_id=f.owner_id and a.provider='amazon'
  join public.amazon_orders o on o.owner_id=f.owner_id and o.amazon_account_id=a.linked_resource_id
    and o.amazon_order_id=coalesce(f.order_number,f.order_id)
  where f.source_channel='amazon' and f.fulfilled_at is null and f.label_created_at is null
    and lower(trim(coalesce(f.source_status,'')))='pending'
    and lower(replace(coalesce(o.order_status,''),'_','')) in ('unshipped','partiallyshipped')
    and o.last_update_date is not null and (f.order_updated_at is null or o.last_update_date>=f.order_updated_at)
  order by f.id,o.last_update_date desc
)
update public.fulfillment_orders f set source_status=l.order_status,order_updated_at=l.last_update_date
from latest l where f.id=l.id;

