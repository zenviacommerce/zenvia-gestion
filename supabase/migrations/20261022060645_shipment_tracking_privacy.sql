-- Extend the established Amazon/order PII lifecycle to the new shadow tables.
create function private.shipment_tracking_purge_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.pii_purged_at is not null then
  delete from public.shipment_tracking_events where order_id=new.id;
  delete from public.shipment_tracking_state where order_id=new.id;
 end if;
 return new;
end;$$;
revoke all on function private.shipment_tracking_purge_order() from public,anon,authenticated;
create trigger zz_shipment_tracking_pii_purge after update of pii_purged_at on public.fulfillment_orders for each row execute function private.shipment_tracking_purge_order();
delete from public.shipment_tracking_events e where not exists(select 1 from public.fulfillment_orders o where o.id=e.order_id and o.pii_purged_at is null);
delete from public.shipment_tracking_state s using public.fulfillment_orders o where o.id=s.order_id and o.pii_purged_at is not null;
alter table public.shipment_tracking_events add constraint shipment_tracking_events_order_fk foreign key(order_id) references public.fulfillment_orders(id) on delete cascade;
do $patch$
declare src text;anchor text;
begin
 src:=pg_get_functiondef('public.tracking_seed_shadow()'::regprocedure);anchor:='and nullif(o.tracking_number';
 if position(anchor in src)=0 then raise exception 'TRACKING_SEED_PRIVACY_SOURCE_CHANGED';end if;
 src:=replace(src,anchor,'and o.pii_purged_at is null and nullif(o.tracking_number');execute src;
 src:=pg_get_functiondef('public.tracking_claim(uuid,integer)'::regprocedure);anchor:='and o.label_cancelled_at is null';
 if position(anchor in src)=0 then raise exception 'TRACKING_CLAIM_PRIVACY_SOURCE_CHANGED';end if;
 src:=replace(src,anchor,'and o.pii_purged_at is null and o.label_cancelled_at is null');execute src;
 src:=pg_get_functiondef('public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure);anchor:='if not found or private.shipment_tracking_identity(o)';
 if position(anchor in src)=0 then raise exception 'TRACKING_FINISH_PRIVACY_SOURCE_CHANGED';end if;
 src:=replace(src,anchor,'if not found or o.pii_purged_at is not null or private.shipment_tracking_identity(o)');execute src;
end $patch$;
