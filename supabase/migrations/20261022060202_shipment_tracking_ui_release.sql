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

-- Performance may already have moved classification into its private cache.
-- Restore the preserved classifiers only inside this atomic UI transaction.
do $projection_ui_prepare$
declare f record;
begin
 if to_regclass('private.orders_dashboard_projection') is not null then
  lock table public.fulfillment_orders in share row exclusive mode;
  lock table public.shipment_tracking_state in share row exclusive mode;
  for f in select * from private.orders_projection_rpc_backup loop
   if md5(pg_get_functiondef(to_regprocedure(f.signature)))<>f.optimized_hash then raise exception 'TRACKING_PROJECTION_CALLER_CHANGED: %',f.signature;end if;
   execute f.original_definition;
  end loop;
 end if;
end $projection_ui_prepare$;

do $patch$
declare fn record; src text; before_src text; anchor text; pos_start integer;pos_end integer;patched integer:=0;
begin
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
 src:=replace(src,anchor,$code$  CASE coalesce(n.tracking_normalized_state,private.tracking_legacy_state(n.shipping_provider,n.tracking_status_code))
 WHEN 'pre_transit' THEN 'ready' WHEN 'in_transit' THEN 'transit' WHEN 'out_for_delivery' THEN 'route'
 WHEN 'delivered' THEN 'delivered' WHEN 'exception' THEN 'issue' WHEN 'returned' THEN 'returned' WHEN 'cancelled' THEN 'cancelled' ELSE 'none' END AS tracking_class$code$);
 if src=before_src then raise exception 'TRACKING_PATCH_EMPTY';end if;execute src;patched:=patched+1;
 end loop;
 if patched<>3 then raise exception 'TRACKING_DASHBOARD_FUNCTIONS_MISSING';end if;
end $patch$;

-- Extend a legacy cache in place and rebuild the same exact classifier after
-- the UI transform. Explicit column mapping accommodates added tracking fields.
do $projection_ui_upgrade$
declare source text;prefix text;scoped text;boundary integer;a record;cols text;select_cols text;assignments text;f record;original text;newdef text;source_prefix text;was_active boolean;
begin
 if to_regclass('private.orders_dashboard_projection') is null then return;end if;
 select exists(select 1 from private.orders_projection_rpc_backup) into was_active;
 select prosrc into strict source from pg_proc where oid='private.mfa_impl_orders_dashboard_pickup_v1(date,date,text,text,text,text,text,text,integer,integer,integer,text,text,boolean,integer,uuid[],text,boolean)'::regprocedure;
 boundary:=position(E',\nmatched AS (' in source);
 if boundary=0 then raise exception 'TRACKING_PROJECTION_CLASSIFIER_CHANGED';end if;
 prefix:=left(source,boundary-1);
 scoped:=replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()',
 'FROM public.fulfillment_orders o WHERE o.owner_id=p_owner AND private.orders_dashboard_group_key(o.source_channel,o.order_number,o.id)=p_key');
 execute 'CREATE TEMP TABLE orders_projection_ui_shape ON COMMIT DROP AS '||replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()','FROM public.fulfillment_orders o WHERE false')||' SELECT * FROM classified WITH NO DATA';
 for a in select attname,format_type(atttypid,atttypmod) column_type from pg_attribute where attrelid='pg_temp.orders_projection_ui_shape'::regclass and attnum>0 and not attisdropped loop
  if not exists(select 1 from pg_attribute where attrelid='private.orders_dashboard_projection'::regclass and attname=a.attname and attnum>0 and not attisdropped) then execute format('ALTER TABLE private.orders_dashboard_projection ADD COLUMN %I %s',a.attname,a.column_type);end if;
 end loop;
 select string_agg(format('%I',attname),',' order by attnum),
 string_agg(case when attname='projection_group_key' then 'p_key AS projection_group_key' else format('c.%I',attname) end,',' order by attnum),
 string_agg(format('%1$I=excluded.%1$I',attname),',' order by attnum)
 into cols,select_cols,assignments from pg_attribute where attrelid='private.orders_dashboard_projection'::regclass and attnum>0 and not attisdropped;
 execute format('CREATE OR REPLACE FUNCTION private.orders_dashboard_projection_refresh(p_owner uuid,p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS %L',
 'BEGIN WITH refreshed AS MATERIALIZED ('||scoped||' SELECT '||select_cols||' FROM classified c),
 upserted AS (INSERT INTO private.orders_dashboard_projection('||cols||') SELECT * FROM refreshed WHERE true ON CONFLICT(owner_id,projection_group_key) DO UPDATE SET '||assignments||' RETURNING 1)
 DELETE FROM private.orders_dashboard_projection p WHERE p.owner_id=p_owner AND p.projection_group_key=p_key AND NOT EXISTS(SELECT 1 FROM refreshed);END');
 update private.orders_projection_classifier set source_prefix=prefix where singleton;
 for f in select distinct owner_id,private.orders_dashboard_group_key(source_channel,order_number,id) group_key from public.fulfillment_orders loop perform private.orders_dashboard_projection_refresh(f.owner_id,f.group_key);end loop;
 -- Source purges first lock/delete tracking rows; provider updates do the same
 -- before taking group/cache locks. Preserve this order in both release paths.
 if exists(select 1 from pg_trigger where tgrelid='public.fulfillment_orders'::regclass and tgname='orders_dashboard_projection_changed') then alter trigger orders_dashboard_projection_changed on public.fulfillment_orders rename to zzzz_orders_dashboard_projection_changed;end if;
 if was_active then
  for f in select p.oid,p.oid::regprocedure::text signature,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and p.proname='orders_dashboard_page_v1') or (n.nspname='private' and p.proname in('pickup_report_dashboard_scope','mfa_impl_orders_dashboard_pickup_v1')) loop
   original:=pg_get_functiondef(f.oid);boundary:=position(E',\nmatched AS (' in f.prosrc);source_prefix:=left(f.prosrc,boundary-1);
   if boundary=0 or replace(source_prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()','FROM public.fulfillment_orders o')<>replace(prefix,'FROM public.fulfillment_orders o WHERE o.owner_id=private.app_workspace_owner_id()','FROM public.fulfillment_orders o') then raise exception 'TRACKING_PROJECTION_CLASSIFIER_MISMATCH';end if;
   select string_agg(format('p.%I',attname),',' order by attnum) into cols from pg_attribute where attrelid='private.orders_dashboard_projection'::regclass and attnum>0 and not attisdropped and attname<>'projection_group_key';
   newdef:=replace(original,source_prefix,'WITH classified AS MATERIALIZED (SELECT '||cols||' FROM private.orders_dashboard_projection p WHERE p.owner_id=(SELECT private.app_workspace_owner_id()))');execute newdef;
   update private.orders_projection_rpc_backup set original_definition=original,optimized_hash=md5(pg_get_functiondef(f.oid)) where signature=f.signature;
  end loop;
 end if;
end $projection_ui_upgrade$;

do $projection_ui_dependency$
begin
 if to_regclass('private.orders_dashboard_projection') is null then return;end if;
 execute $function$CREATE OR REPLACE FUNCTION private.orders_dashboard_projection_tracking_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
 declare o record;old_id uuid;new_id uuid;
 begin
  if TG_OP='UPDATE' and NEW is not distinct from OLD then return null;end if;
  if TG_OP<>'INSERT' then old_id:=OLD.order_id;end if;
  if TG_OP<>'DELETE' then new_id:=NEW.order_id;end if;
  for o in select f.owner_id,private.orders_dashboard_group_key(f.source_channel,f.order_number,f.id) group_key from public.fulfillment_orders f where f.id in(old_id,new_id) order by f.id loop
   perform pg_advisory_xact_lock(hashtextextended(o.owner_id::text||':'||o.group_key,719));perform private.orders_dashboard_projection_refresh(o.owner_id,o.group_key);
  end loop;return null;
 end $body$ $function$;
 execute 'REVOKE ALL ON FUNCTION private.orders_dashboard_projection_tracking_changed() FROM PUBLIC,anon,authenticated';
 if not exists(select 1 from pg_trigger where tgrelid='public.shipment_tracking_state'::regclass and tgname='orders_dashboard_projection_tracking_changed') then execute 'CREATE TRIGGER orders_dashboard_projection_tracking_changed AFTER INSERT OR UPDATE OR DELETE ON public.shipment_tracking_state FOR EACH ROW EXECUTE FUNCTION private.orders_dashboard_projection_tracking_changed()';end if;
end $projection_ui_dependency$;
