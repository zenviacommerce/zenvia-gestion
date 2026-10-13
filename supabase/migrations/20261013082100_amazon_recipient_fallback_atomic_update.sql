-- Internal compare-and-swap keeps concurrent SP-API/manual changes and avoids
-- sending the complete raw order as a PostgREST URL filter.
create or replace function public.apply_amazon_recipient_fallback(
 p_order_id uuid,p_owner_id uuid,p_amazon_account_id uuid,
 p_expected_raw jsonb,p_expected_synced_at timestamptz,p_patch jsonb
) returns integer language plpgsql set search_path='' as $$
declare v_count integer;
begin
 update public.fulfillment_orders o set
  shipping_address=p_patch->'shipping_address',
  customer_name=coalesce(p_patch->>'customer_name',o.customer_name),
  customer_email=coalesce(p_patch->>'customer_email',o.customer_email),
  customer_phone=coalesce(p_patch->>'customer_phone',o.customer_phone),
  raw_payload=p_patch->'raw_payload'
 where o.id=p_order_id and o.owner_id=p_owner_id
  and o.source_channel='amazon' and o.source_integration_account_id=p_amazon_account_id
  and o.raw_payload is not distinct from p_expected_raw
  and o.last_synced_at is not distinct from p_expected_synced_at
  and not (coalesce(o.raw_payload,'{}'::jsonb) ? '_zenvia_local_shipping_updated_at')
  and exists(select 1 from public.integration_accounts a
    join public.integration_accounts s on s.id::text=a.config->>'recipientSourceAccountId'
    where a.id=p_amazon_account_id and a.owner_id=p_owner_id and a.enabled and a.status<>'disabled'
      and s.owner_id=p_owner_id and s.enabled and s.status<>'disabled'
      and s.id::text=p_patch->'raw_payload'->'_zenvia_recipient_fallback'->>'accountId'
      and s.provider=p_patch->'raw_payload'->'_zenvia_recipient_fallback'->>'provider');
 get diagnostics v_count=row_count;
 return v_count;
end;
$$;
revoke all on function public.apply_amazon_recipient_fallback(uuid,uuid,uuid,jsonb,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_amazon_recipient_fallback(uuid,uuid,uuid,jsonb,timestamptz,jsonb) to service_role;
