-- Append-only shipment references, separate from Platform's order shadow.
-- No backfill and no changes to existing orders or cancellation/MFA functions.
create table public.order_shipment_history (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
 identity_key text not null,
 provider text,
 carrier text,
 tracking_number text,
 shipment_reference text,
 cancelled_at timestamptz,
 recorded_at timestamptz not null default now(),
 unique(order_id,identity_key)
);
create index order_shipment_history_owner_order on public.order_shipment_history(owner_id,order_id,recorded_at desc);
alter table public.order_shipment_history enable row level security;
revoke all on public.order_shipment_history from anon,authenticated;
grant select on public.order_shipment_history to authenticated,service_role;
create policy order_shipment_history_workspace_select on public.order_shipment_history for select to authenticated using (
 owner_id=(select private.app_workspace_owner_id())
 and (select private.app_has_permission('orders')) and (select private.mfa_allowed())
 and exists(select 1 from public.fulfillment_orders o where o.id=order_shipment_history.order_id and o.owner_id=order_shipment_history.owner_id and o.pii_purged_at is null)
);
create function private.record_order_shipment_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_cancelled boolean; new_cancelled boolean; reference text; identity text; cancelled timestamptz;
begin
 -- Same retention boundary as the canonical order; never mirror references to Platform.
 if new.pii_purged_at is not null then
  delete from public.order_shipment_history where order_id=new.id and owner_id=new.owner_id;
  return null;
 end if;
 if old.pii_purged_at is not null then return null;end if;
 old_cancelled:=old.label_cancelled_at is not null or upper(trim(coalesce(old.tracking_status_code,''))) in ('CANCELLED','CANCELED') or (old.shipping_provider='envia' and old.tracking_status_code='4');
 new_cancelled:=new.label_cancelled_at is not null or upper(trim(coalesce(new.tracking_status_code,''))) in ('CANCELLED','CANCELED') or (new.shipping_provider='envia' and new.tracking_status_code='4');
 if not (coalesce(new_cancelled,false) or coalesce(old_cancelled,false)) then return null;end if;
 reference:=coalesce(nullif(old.shipping_remote_id,''),old.sendcloud_parcel_id::text,nullif(old.tracking_number,''));
 if reference is null then return null;end if;
 -- Only the old descriptor: a replacement's carrier/tracking must not enter its predecessor.
 identity:=md5(jsonb_build_array(old.shipping_provider,old.shipping_integration_account_id,reference,old.tracking_number,old.label_created_at)::text);
 cancelled:=coalesce(old.label_cancelled_at,new.label_cancelled_at,case when old_cancelled then old.tracking_updated_at when new_cancelled then new.tracking_updated_at end);
 insert into public.order_shipment_history(owner_id,order_id,identity_key,provider,carrier,tracking_number,shipment_reference,cancelled_at)
 values(old.owner_id,old.id,identity,old.shipping_provider,coalesce(nullif(old.carrier_name,''),nullif(old.carrier_code,''),old.shipping_provider),nullif(old.tracking_number,''),reference,cancelled)
 on conflict(order_id,identity_key) do nothing;
 return null;
end $$;
revoke all on function private.record_order_shipment_history() from public,anon,authenticated;
create trigger zz_order_shipment_history after update on public.fulfillment_orders for each row execute function private.record_order_shipment_history();
