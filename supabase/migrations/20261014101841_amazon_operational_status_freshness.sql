-- The operational shipping state must not be replaced by an older import.
create or replace function private.fulfillment_amazon_status_freshness()
returns trigger language plpgsql security invoker set search_path=''
as $function$
declare canonical_status text; canonical_updated timestamptz;
begin
  if new.source_channel<>'amazon' then return new; end if;
  if tg_op='UPDATE' and old.fulfilled_at is not null and new.fulfilled_at is not null
     and lower(replace(coalesce(new.source_status,''),'_','')) in ('pending','pendingavailability','invoiceunconfirmed','unshipped','partiallyshipped') then
    new.source_status:=case when lower(coalesce(old.source_status,'')) in ('shipped','fulfilled','delivered') then old.source_status else 'SHIPPED' end;
    new.order_updated_at:=old.order_updated_at;
    return new;
  end if;
  if tg_op='UPDATE' and old.source_channel='amazon'
     and old.order_updated_at is not null and new.order_updated_at is not null
     and new.order_updated_at<old.order_updated_at then
    new.source_status:=old.source_status;
    new.order_updated_at:=old.order_updated_at;
    new.fulfilled_at:=old.fulfilled_at;
    return new;
  end if;
  if new.fulfilled_at is null
     and lower(replace(coalesce(new.source_status,''),'_','')) in ('pending','pendingavailability','invoiceunconfirmed','unshipped','partiallyshipped') then
    select o.order_status,o.last_update_date into canonical_status,canonical_updated
    from public.amazon_orders o join public.integration_accounts a
      on a.linked_resource_id=o.amazon_account_id and a.owner_id=o.owner_id
    where o.owner_id=new.owner_id and a.id=new.source_integration_account_id
      and a.provider='amazon' and o.amazon_order_id=coalesce(new.order_number,new.order_id)
    order by o.last_update_date desc nulls last limit 1;
    if canonical_status is not null and canonical_updated is not null
       and (new.order_updated_at is null or canonical_updated>=new.order_updated_at) then
      new.source_status:=canonical_status;
      new.order_updated_at:=canonical_updated;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.fulfillment_amazon_status_freshness() from public,anon,authenticated;
drop trigger if exists fulfillment_amazon_status_freshness on public.fulfillment_orders;
create trigger fulfillment_amazon_status_freshness
before insert or update of source_status,order_updated_at,source_channel,source_integration_account_id
on public.fulfillment_orders for each row execute function private.fulfillment_amazon_status_freshness();

-- Repair only stale, non-dispatched payment states using the matching Amazon account.
update public.fulfillment_orders f
set source_status=o.order_status,order_updated_at=o.last_update_date
from public.amazon_orders o join public.integration_accounts a
  on a.linked_resource_id=o.amazon_account_id and a.owner_id=o.owner_id and a.provider='amazon'
where f.owner_id=o.owner_id and f.source_channel='amazon'
  and f.source_integration_account_id=a.id and f.order_number=o.amazon_order_id
  and f.fulfilled_at is null and lower(replace(coalesce(f.source_status,''),'_','')) in ('pending','pendingavailability','invoiceunconfirmed')
  and o.order_status in ('UNSHIPPED','PARTIALLY_SHIPPED','SHIPPED','CANCELLED')
  and o.last_update_date>=coalesce(f.order_updated_at,'-infinity'::timestamptz);
