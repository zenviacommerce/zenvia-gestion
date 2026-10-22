-- RETAINED with tracking UI release; no existing row changes.
-- Only the current, unpurged label's history may be read by its workspace.
grant select on public.shipment_tracking_events to authenticated;
create policy shipment_tracking_history_workspace_select on public.shipment_tracking_events for select to authenticated using (
 owner_id=(select private.app_workspace_owner_id())
 and (select private.app_has_permission('orders'))
 and exists(select 1 from public.fulfillment_orders o where o.id=shipment_tracking_events.order_id and o.owner_id=shipment_tracking_events.owner_id and o.pii_purged_at is null and o.shipping_integration_account_id=shipment_tracking_events.account_id
 and shipment_tracking_events.identity_key=md5(jsonb_build_array(o.owner_id,o.shipping_integration_account_id,o.shipping_provider,o.tracking_number,o.shipping_remote_id,o.sendcloud_parcel_id,o.label_created_at,o.label_cancelled_at)::text))
);
create policy mfa_select_gate on public.shipment_tracking_events as restrictive for select to authenticated using((select private.mfa_allowed()));
create policy mfa_insert_gate on public.shipment_tracking_events as restrictive for insert to authenticated with check((select private.mfa_allowed()));
create policy mfa_update_gate on public.shipment_tracking_events as restrictive for update to authenticated using((select private.mfa_allowed())) with check((select private.mfa_allowed()));
create policy mfa_delete_gate on public.shipment_tracking_events as restrictive for delete to authenticated using((select private.mfa_allowed()));
create function public.tracking_order_events_v1(p_order uuid) returns table(normalized_state text,raw_code text,raw_message text,event_at timestamptz,raw_event_time text,observed_at timestamptz) language sql stable security invoker set search_path='' as $$
 select e.normalized_state,e.raw_code,e.raw_message,e.event_at,e.raw_event_time,e.observed_at from public.shipment_tracking_events e
 where e.order_id=p_order order by coalesce(e.event_at,e.observed_at) desc,e.event_key desc limit 50;
$$;
revoke all on function public.tracking_order_events_v1(uuid) from public,anon;
grant execute on function public.tracking_order_events_v1(uuid) to authenticated,service_role;
