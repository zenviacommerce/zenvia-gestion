-- Additive preparation. No existing shipment is registered or reprocessed.
alter table public.fulfillment_orders add column external_shipment jsonb;

create or replace function public.register_external_shipment(p_order uuid,p_owner uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='500ms' set statement_timeout='5s' as $$
declare o public.fulfillment_orders; a public.integration_accounts; carrier text; tracking text; link text;
 shipped timestamptz; cost numeric; account uuid; notify boolean; stamp timestamptz:=clock_timestamp();
begin
 if p_request is null or not exists(select 1 from public.app_users u join public.workspaces w on w.id=u.data_owner_id
  where u.user_id=p_actor and u.data_owner_id=p_owner and u.active and w.status in('active','trialing')
  and (u.role='admin' or 'orders'=any(u.permissions))) then raise exception 'No tienes permiso para gestionar pedidos.' using errcode='42501'; end if;
 select * into o from public.fulfillment_orders where id=p_order and owner_id=p_owner for update;
 if not found then raise exception 'Pedido no encontrado.'; end if;
 if o.external_shipment->>'requestId'=p_request::text then
  if o.external_shipment->'input' is distinct from p_input or o.external_shipment->>'actorId'<>p_actor::text then raise exception 'La solicitud ya se utilizó con otros datos.'; end if;
  return jsonb_build_object('ok',true,'alreadyRegistered',true,'orderId',o.id);
 end if;
 if o.pii_purged_at is not null then raise exception 'Los datos del pedido han sido eliminados por retención.'; end if;
 if o.external_shipment is not null or o.label_created_at is not null or o.label_cancelled_at is not null or o.sendcloud_parcel_id is not null
  or o.sendcloud_shipment_id is not null or nullif(o.shipping_remote_id,'') is not null or nullif(o.tracking_number,'') is not null
  or o.fulfilled_at is not null or nullif(o.shipping_label_url,'') is not null then raise exception 'El pedido ya tiene una expedición. No se sobrescribirá.'; end if;
 if o.order_action_lease_until>stamp or o.shopify_tracking_lease_until>stamp then raise exception 'Hay otra operación de envío en curso.'; end if;
 if o.source_status ilike '%cancel%' or exists(select 1 from public.order_cancellation_operations c where c.order_id=o.id and c.owner_id=p_owner
  and (c.status in('submitting','pending','unknown') or (c.kind='order' and c.status='confirmed'))) then raise exception 'El pedido tiene una cancelación pendiente o confirmada.'; end if;
 carrier:=nullif(trim(p_input->>'carrier'),''); tracking:=nullif(trim(p_input->>'trackingNumber'),'');link:=nullif(trim(p_input->>'url'),'');
 if carrier is null or length(carrier)>120 or tracking is null or length(tracking)>120 or tracking~'[[:cntrl:]]' then raise exception 'Transportista y tracking son obligatorios (máximo 120 caracteres).'; end if;
 if length(coalesce(p_input->>'service',''))>200 or length(coalesce(link,''))>2000 or (link is not null and link!~*'^https?://[^ /]+') then raise exception 'Servicio o URL de seguimiento no válidos.'; end if;
 shipped:=coalesce(nullif(p_input->>'shippedAt','')::timestamptz,stamp);
 if not isfinite(shipped) or shipped>stamp+interval '5 minutes' then raise exception 'Fecha de envío no válida.'; end if;
 cost:=nullif(p_input->>'cost','')::numeric;
 if cost is not null and (cost<0 or cost>1000000) then raise exception 'Coste de envío no válido.'; end if;
 if p_input ? 'notifySource' and jsonb_typeof(p_input->'notifySource')<>'boolean' then raise exception 'Confirmación de canal no válida.'; end if;
 notify:=coalesce((p_input->>'notifySource')::boolean,false);
 account:=nullif(p_input->>'accountId','')::uuid;
 if account is not null then
  select * into a from public.integration_accounts where id=account and owner_id=p_owner and provider in('mrw','sendcloud','envia') and enabled and status<>'disabled' for share;
  if not found then raise exception 'La cuenta de transporte no está disponible para tu empresa.'; end if;
  if a.provider='mrw' and lower(carrier) not like '%mrw%' then raise exception 'La cuenta MRW requiere el transportista MRW.'; end if;
 end if;
 update public.fulfillment_orders set carrier_name=carrier,carrier_code=case when a.provider='mrw' then 'mrw' else null end,
  tracking_number=tracking,tracking_url=link,shipping_service_name=nullif(trim(p_input->>'service'),''),
  shipping_integration_account_id=account,shipping_provider=a.provider,fulfilled_at=shipped,source_status='shipped',
  tracking_status_code=null,tracking_status_message=null,tracking_updated_at=null,
  shipping_cost_amount=cost,shipping_cost_currency=case when cost is not null then coalesce(o.currency,'EUR') end,
  shipping_cost_source='external_manual',shipping_cost_recorded_at=case when cost is not null then stamp end,
  external_shipment=jsonb_build_object('registeredAt',stamp,'actorId',p_actor,'requestId',p_request,'notifySource',notify,'input',p_input)
 where id=o.id and owner_id=p_owner returning * into o;
 if account is not null then
  insert into public.shipment_tracking_state(order_id,owner_id,account_id,provider,tracking_number,identity_key,label_created_at)
   values(o.id,p_owner,account,a.provider,tracking,private.shipment_tracking_identity(o),shipped);
 end if;
 insert into public.audit_logs(workspace_owner_id,actor_user_id,module,action,entity_type,entity_id,entity_label,summary,details)
 values(p_owner,p_actor,'orders','register_external_shipment','fulfillment_order',o.id::text,o.order_number,'Envío externo registrado',
  jsonb_build_object('requestId',p_request,'carrier',carrier,'accountId',account,'notifySource',notify,'cost',cost));
 return jsonb_build_object('ok',true,'alreadyRegistered',false,'orderId',o.id);
end;$$;
revoke all on function public.register_external_shipment(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.register_external_shipment(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- The existing claim writes happen before any marketplace request, including
-- forced Amazon retries. Enforce the saved choice at that common DB boundary.
create or replace function private.guard_external_shipment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.external_shipment is null then return new; end if;
 if coalesce((old.external_shipment->>'notifySource')::boolean,false)=false and
  (coalesce(new.amazon_tracking_sync_attempts,0)>coalesce(old.amazon_tracking_sync_attempts,0)
   or (new.shopify_tracking_lease is not null and new.shopify_tracking_lease is distinct from old.shopify_tracking_lease))
 then raise exception 'No se autorizó la notificación del envío externo al canal.';end if;
 if new.last_synced_at is distinct from old.last_synced_at then
  -- A local dispatch is not a marketplace confirmation. Keep it operationally
  -- shipped through stale/unfulfilled source snapshots; actual cancellations win.
  if coalesce(new.source_status,'') not ilike '%cancel%' then new.source_status:=old.source_status;end if;
  new.external_shipment:=old.external_shipment;new.shipping_integration_account_id:=old.shipping_integration_account_id;
  new.shipping_provider:=old.shipping_provider;new.tracking_number:=old.tracking_number;new.tracking_url:=old.tracking_url;
  new.carrier_name:=old.carrier_name;new.carrier_code:=old.carrier_code;new.shipping_service_name:=old.shipping_service_name;
  new.fulfilled_at:=old.fulfilled_at;new.shipping_cost_source:=old.shipping_cost_source;
  new.shipping_cost_amount:=old.shipping_cost_amount;new.shipping_cost_currency:=old.shipping_cost_currency;
  new.shipping_cost_net_amount:=old.shipping_cost_net_amount;new.shipping_cost_tax_amount:=old.shipping_cost_tax_amount;
  new.shipping_cost_recorded_at:=old.shipping_cost_recorded_at;
 end if;
 return new;
end;$$;
revoke all on function private.guard_external_shipment() from public,anon,authenticated;
create trigger zzz_external_shipment_guard before update on public.fulfillment_orders for each row execute function private.guard_external_shipment();

-- Keep exact existing claim and retry semantics; only extend eligibility for
-- external shipments with explicit source notification. Preserve OIDs and ACLs.
do $patch$
declare sig regprocedure;src text;anchor text;
begin
 foreach sig in array array['public.integration_shopify_pending_shipments(uuid)'::regprocedure,'public.integration_shopify_claim_shipment(uuid,uuid,uuid)'::regprocedure] loop
  src:=pg_get_functiondef(sig);anchor:='label_created_at is not null and nullif(tracking_number,'''') is not null';
  if position(anchor in src)=0 or position('external_shipment' in src)>0 then raise exception 'EXTERNAL_SHIPMENT_SHOPIFY_SOURCE_CHANGED: %',sig;end if;
  execute replace(src,anchor,'(label_created_at is not null or external_shipment is not null) and (external_shipment is null or external_shipment->>''notifySource''=''true'') and nullif(tracking_number,'''') is not null');
 end loop;
end $patch$;
