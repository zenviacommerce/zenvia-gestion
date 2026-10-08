create or replace function public.integration_preserve_cancellations()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from order_cancellation_operations where owner_id=new.owner_id and order_id=new.id and kind='order' and status='confirmed') then new.source_status='cancelled';end if;
 if exists(select 1 from order_cancellation_operations where owner_id=new.owner_id and order_id=new.id and kind='label' and status='confirmed' and (details->>'shipmentRef'=coalesce(new.shipping_remote_id,new.sendcloud_parcel_id::text,new.tracking_number,'') or (nullif(details->>'trackingNumber','') is not null and details->>'trackingNumber'=new.tracking_number))) then
  if old.label_created_at is not null and not exists(select 1 from order_cancellation_operations where owner_id=old.owner_id and order_id=old.id and kind='label' and status='confirmed' and (details->>'shipmentRef'=coalesce(old.shipping_remote_id,old.sendcloud_parcel_id::text,old.tracking_number,'') or details->>'trackingNumber'=old.tracking_number)) then
   new.shipping_remote_id=old.shipping_remote_id;new.sendcloud_parcel_id=old.sendcloud_parcel_id;new.sendcloud_shipment_id=old.sendcloud_shipment_id;new.shipping_label_url=old.shipping_label_url;new.label_created_at=old.label_created_at;new.label_printed_at=old.label_printed_at;new.label_print_count=old.label_print_count;
   new.tracking_number=old.tracking_number;new.tracking_url=old.tracking_url;new.tracking_status_code=old.tracking_status_code;new.tracking_status_message=old.tracking_status_message;new.tracking_updated_at=old.tracking_updated_at;new.fulfilled_at=old.fulfilled_at;
   return new;
  end if;
  new.label_cancelled_at=coalesce(new.label_cancelled_at,now());new.shipping_remote_id=null;new.sendcloud_parcel_id=null;new.sendcloud_shipment_id=null;new.shipping_label_url=null;new.label_created_at=null;new.label_printed_at=null;new.label_print_count=0;
  new.tracking_number=null;new.tracking_url=null;new.tracking_status_code=null;new.tracking_status_message=null;new.tracking_updated_at=null;new.fulfilled_at=null;
  new.shipping_cost_amount=null;new.shipping_cost_net_amount=null;new.shipping_cost_tax_amount=null;new.shipping_cost_recorded_at=null;
 end if;
 return new;
end $$;

alter policy order_cancellations_read on public.order_cancellation_operations using(exists(select 1 from public.app_users u where u.user_id=auth.uid() and u.data_owner_id=order_cancellation_operations.owner_id and u.active and (u.role='admin' or 'orders'=any(u.permissions))));
