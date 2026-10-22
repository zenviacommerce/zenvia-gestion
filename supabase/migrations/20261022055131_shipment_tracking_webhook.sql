create table public.shipment_tracking_webhook_receipts(account_id uuid not null,event_key text not null,received_at timestamptz not null default now(),primary key(account_id,event_key));
create index shipment_tracking_webhook_received on public.shipment_tracking_webhook_receipts(account_id,received_at);
alter table public.shipment_tracking_webhook_receipts enable row level security;
revoke all on public.shipment_tracking_webhook_receipts from public,anon,authenticated;
grant select,insert,delete on public.shipment_tracking_webhook_receipts to service_role;
create function public.tracking_webhook_wake(p_account uuid,p_owner uuid,p_tracking text,p_event_key text) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_event_key!~'^[a-f0-9]{64}$' or length(p_tracking)>100 then raise exception 'INVALID_TRACKING_EVENT';end if;
 if not exists(select 1 from public.shipment_tracking_settings where singleton and enabled) then return 0;end if;
 if not exists(select 1 from public.integration_accounts a join public.workspaces w on w.id=a.owner_id where a.id=p_account and a.owner_id=p_owner and a.provider='sendcloud' and a.enabled and a.status<>'disabled' and w.status in('active','trialing')) then return 0;end if;
 perform pg_advisory_xact_lock(hashtextextended('shipment-webhook:'||p_account::text,0));
 if (select count(*) from public.shipment_tracking_webhook_receipts where account_id=p_account and received_at>now()-interval '1 minute')>=120 then return 0;end if;
 insert into public.shipment_tracking_webhook_receipts(account_id,event_key) values(p_account,p_event_key) on conflict do nothing;
 if not found then return 0;end if;
 update public.shipment_tracking_state s set next_poll_at=least(s.next_poll_at,now()) from public.fulfillment_orders o
 where s.order_id=o.id and s.owner_id=p_owner and s.account_id=p_account and s.provider='sendcloud' and s.tracking_number=p_tracking
 and private.shipment_tracking_identity(o)=s.identity_key and o.label_cancelled_at is null
 and s.next_poll_at is not null and coalesce(s.normalized_state,'') not in('delivered','returned','cancelled')
 and upper(replace(coalesce(o.tracking_status_code,''),' ','_')) not in('DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER');
 get diagnostics n=row_count;return n;
end;$$;
revoke all on function public.tracking_webhook_wake(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.tracking_webhook_wake(uuid,uuid,text,text) to service_role;
