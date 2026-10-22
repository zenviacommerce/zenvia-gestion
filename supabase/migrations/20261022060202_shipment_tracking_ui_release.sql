-- RETAINED: apply only with the separately approved tracking UI release.
-- No fulfillment order writes. Reads remain tenant/permission/MFA scoped.
grant select on public.shipment_tracking_state to authenticated;
create policy shipment_tracking_workspace_select on public.shipment_tracking_state for select to authenticated using(owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')) and exists(select 1 from public.fulfillment_orders o where o.id=shipment_tracking_state.order_id and o.owner_id=shipment_tracking_state.owner_id and o.pii_purged_at is null and shipment_tracking_state.identity_key=md5(jsonb_build_array(o.owner_id,o.shipping_integration_account_id,o.shipping_provider,o.tracking_number,o.shipping_remote_id,o.sendcloud_parcel_id,o.label_created_at,o.label_cancelled_at)::text)));
-- Match the activation audit's four restrictive policy names even though only
-- SELECT is granted. Writes remain ungranted and have no permissive policy.
create policy mfa_select_gate on public.shipment_tracking_state as restrictive for select to authenticated using((select private.mfa_allowed()));
create policy mfa_insert_gate on public.shipment_tracking_state as restrictive for insert to authenticated with check((select private.mfa_allowed()));
create policy mfa_update_gate on public.shipment_tracking_state as restrictive for update to authenticated using((select private.mfa_allowed())) with check((select private.mfa_allowed()));
create policy mfa_delete_gate on public.shipment_tracking_state as restrictive for delete to authenticated using((select private.mfa_allowed()));
create function private.tracking_legacy_state(p_provider text,p_code text) returns text language sql immutable set search_path='' as $$
 select case lower(regexp_replace(trim(coalesce(p_code,'')),'[ -]+','_','g'))
 when 'ready_to_send' then 'pre_transit' when 'created' then 'pre_transit' when 'announced' then 'pre_transit'
 when 'shipped' then 'in_transit' when 'in_transit' then 'in_transit' when 'parcel_en_route' then 'in_transit'
 when 'driver_on_route' then 'out_for_delivery' when 'driver_en_route' then 'out_for_delivery' when 'out_for_delivery' then 'out_for_delivery'
 when 'delivered' then 'delivered' when 'shipment_collected_by_customer' then 'delivered'
 when 'delivered_at_origin' then 'returned' when 'returned' then 'returned' when 'returned_to_sender' then 'returned'
 when 'delivery_failed' then 'exception' when 'delivery_date_changed' then 'exception' when 'awaiting_customer_pickup' then 'exception'
 when 'address_invalid' then 'exception' when 'delivery_delayed' then 'exception'
 when 'cancelled' then 'cancelled' when 'canceled' then 'cancelled'
 else case when p_provider='envia' then case p_code when '1' then 'pre_transit' when '2' then 'in_transit' when '3' then 'delivered' when '4' then 'cancelled' when '7' then 'pre_transit' when '8' then 'in_transit' when '9' then 'out_for_delivery' when '11' then 'returned' when '13' then 'returned' when '15' then 'in_transit' when '16' then 'pre_transit' when '26' then 'in_transit' when '27' then 'in_transit' when '10' then 'exception' when '12' then 'exception' when '14' then 'exception' when '17' then 'exception' when '18' then 'exception' when '19' then 'exception' when '20' then 'exception' when '21' then 'exception' when '22' then 'exception' when '23' then 'exception' when '24' then 'exception' when '25' then 'exception' when '28' then 'exception' end end end;
$$;
revoke all on function private.tracking_legacy_state(text,text) from public,anon;
grant execute on function private.tracking_legacy_state(text,text) to authenticated,service_role;

do $patch$
declare fn record; src text; before_src text; anchor text; pos_start integer;pos_end integer;patched integer:=0;
begin
 -- Projection releases normalize preserved originals in the additive adapter.
 -- Never search inside the guarded RPC's nested UNION fallback.
 if to_regclass('private.orders_projection_classifier') is not null then return;end if;
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname='orders_dashboard_page_v1') or (n.nspname='private' and p.proname in('pickup_report_dashboard_scope','mfa_impl_orders_dashboard_pickup_v1')) loop
 src:=pg_get_functiondef(fn.oid);before_src:=src;
 anchor:=' SELECT r.*,'||chr(10)||'   lower(trim';
 if position(anchor in src)=0 or position(' FROM merged r' in src)=0 then raise exception 'TRACKING_DASHBOARD_SOURCE_CHANGED';end if;
 src:=replace(src,anchor,' SELECT r.*, st.normalized_state as tracking_normalized_state,st.raw_code as tracking_raw_code,st.raw_message as tracking_raw_message,st.event_at as tracking_event_at,st.raw_event_time as tracking_event_time_raw,st.observed_at as tracking_observed_at,st.movement_at as tracking_movement_at,st.last_checked_at as tracking_checked_at,st.last_error as tracking_error,'||chr(10)||'   lower(trim');
 src:=replace(src,' FROM merged r',' FROM merged r LEFT JOIN public.shipment_tracking_state st ON st.order_id=r.id AND st.owner_id=r.owner_id AND r.pii_purged_at IS NULL AND st.account_id=r.shipping_integration_account_id AND st.identity_key=md5(jsonb_build_array(r.owner_id,r.shipping_integration_account_id,r.shipping_provider,r.tracking_number,r.shipping_remote_id,r.sendcloud_parcel_id,r.label_created_at,r.label_cancelled_at)::text)');
 anchor:='(n.source_code LIKE ''%cancel%'' OR n.tracking_text LIKE ''%cancelled%'' OR n.tracking_text LIKE ''%canceled%'') AS is_cancelled';
 if position(anchor in src)=0 then raise exception 'TRACKING_CANCEL_SOURCE_CHANGED';end if;
 src:=replace(src,anchor,'(n.source_code IN (''cancelled'',''canceled'',''cancelled_by_customer'',''cancelled_by_seller'') OR coalesce(n.tracking_normalized_state,private.tracking_legacy_state(n.shipping_provider,n.tracking_status_code))=''cancelled'') AS is_cancelled');
 pos_start:=position('  CASE'||chr(10)||'   WHEN (NOT n.has_label' in src);pos_end:=position('  END AS tracking_class' in src);
 if pos_start=0 or pos_end<=pos_start then raise exception 'TRACKING_CLASS_SOURCE_CHANGED';end if;
 anchor:=substring(src from pos_start for pos_end+length('  END AS tracking_class')-pos_start);
 src:=replace(src,anchor,$code$  CASE coalesce(n.tracking_normalized_state,CASE WHEN n.shipping_provider='mrw' THEN NULL ELSE private.tracking_legacy_state(n.shipping_provider,n.tracking_status_code) END)
 WHEN 'pre_transit' THEN 'ready' WHEN 'in_transit' THEN 'transit' WHEN 'out_for_delivery' THEN 'route'
 WHEN 'delivered' THEN 'delivered' WHEN 'exception' THEN 'issue' WHEN 'returned' THEN 'returned' WHEN 'cancelled' THEN 'cancelled' ELSE 'none' END AS tracking_class$code$);
 if src=before_src then raise exception 'TRACKING_PATCH_EMPTY';end if;execute src;patched:=patched+1;
 end loop;
 if patched<>3 then raise exception 'TRACKING_DASHBOARD_FUNCTIONS_MISSING';end if;
end $patch$;
