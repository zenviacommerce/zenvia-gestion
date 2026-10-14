-- Keep account identity stable even when an older synchronization is still in flight.
create or replace function private.fulfillment_amazon_account_name()
returns trigger language plpgsql security invoker set search_path=''
as $function$
declare account_name text;
begin
  if new.source_channel='amazon' and new.source_integration_account_id is not null then
    select a.display_name into account_name from public.integration_accounts a
    where a.id=new.source_integration_account_id and a.owner_id=new.owner_id
      and a.provider='amazon' and nullif(trim(a.display_name),'') is not null;
    if account_name is not null then new.integration_name:=account_name; end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.fulfillment_amazon_account_name() from public,anon,authenticated;
drop trigger if exists fulfillment_amazon_account_name on public.fulfillment_orders;
create trigger fulfillment_amazon_account_name
before insert or update of integration_name,source_integration_account_id,source_channel,owner_id
on public.fulfillment_orders for each row execute function private.fulfillment_amazon_account_name();

update public.fulfillment_orders o set integration_name=a.display_name
from public.integration_accounts a
where o.source_integration_account_id=a.id and o.owner_id=a.owner_id
  and o.source_channel='amazon' and a.provider='amazon'
  and nullif(trim(a.display_name),'') is not null
  and o.integration_name is distinct from a.display_name;
