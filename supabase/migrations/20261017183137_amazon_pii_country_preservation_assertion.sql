create or replace function private.assert_amazon_pii_country_preserved()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare prior_country text;
begin
 if old.source_channel = 'amazon' and old.pii_purged_at is null and new.pii_purged_at is not null then
  prior_country := coalesce(
    case when old.destination_country_code ~ '^[A-Z]{2}$' then old.destination_country_code end,
    case when old.shipping_address->>'country_code' ~ '^[A-Z]{2}$' then old.shipping_address->>'country_code' end
  );
  if prior_country is not null and new.destination_country_code is distinct from prior_country then
    raise exception 'Amazon PII purge country preservation violation' using errcode = '23514';
  end if;
 end if;
 return null;
end $$;
revoke all on function private.assert_amazon_pii_country_preserved() from public, anon, authenticated;
drop trigger if exists zzzzzz_assert_amazon_pii_country_preserved on public.fulfillment_orders;
create trigger zzzzzz_assert_amazon_pii_country_preserved
after update of pii_purged_at on public.fulfillment_orders
for each row execute function private.assert_amazon_pii_country_preserved();