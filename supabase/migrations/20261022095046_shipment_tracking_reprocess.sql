-- Creates functions only. No existing data is changed by applying this migration.
-- Preview is read-only; only explicitly approved current versions may be queued.
create function public.tracking_reprocess_candidates()
returns table(order_id uuid,owner_id uuid,account_id uuid,provider text,tracking_number text,
 normalized_state text,raw_code text,raw_message text,event_at timestamptz,
 raw_event_time text,observed_at timestamptz,movement_at timestamptz,
 failures integer,next_poll_at timestamptz,paused_until timestamptz,version text)
language sql stable security invoker set search_path='' as $$
 select s.order_id,s.owner_id,s.account_id,s.provider,s.tracking_number,
 s.normalized_state,s.raw_code,s.raw_message,s.event_at,s.raw_event_time,
 s.observed_at,s.movement_at,s.failures,s.next_poll_at,h.paused_until,md5(to_jsonb(s)::text)
 from public.shipment_tracking_state s
 join public.fulfillment_orders o on o.id=s.order_id and o.owner_id=s.owner_id
 join public.integration_accounts a on a.id=s.account_id and a.owner_id=s.owner_id and a.provider=s.provider
 join public.workspaces w on w.id=s.owner_id and w.status in('active','trialing')
 left join public.shipment_tracking_account_health h on h.account_id=s.account_id and h.owner_id=s.owner_id and h.provider=s.provider
 where a.enabled and a.status<>'disabled'
 and o.shipping_integration_account_id=s.account_id
 and (o.shipping_provider=s.provider or (o.shipping_provider is null and s.provider='sendcloud' and o.sendcloud_parcel_id is not null))
 and o.pii_purged_at is null and o.label_cancelled_at is null
 and nullif(trim(o.tracking_number),'') is not null
 and private.shipment_tracking_identity(o)=s.identity_key
 and coalesce(s.normalized_state,'') not in('delivered','returned','cancelled')
 and not private.shipment_tracking_terminal(s.provider,o.tracking_status_code)
 order by s.provider,s.order_id limit 1001;
$$;

-- A scalar envelope keeps the sentinel out of PostgREST's row-count cap.
-- The table RPC remains internal to enqueue; this returns exactly one JSON value.
create function public.tracking_reprocess_preview_candidates()
returns jsonb language sql stable security invoker set search_path='' as $$
 with bounded as (
  select c.*,row_number() over(order by c.provider,c.order_id) as ordinal
  from public.tracking_reprocess_candidates() c limit 1001
 )
 select jsonb_build_object(
  'rows',coalesce(jsonb_agg(to_jsonb(b)-'ordinal' order by b.ordinal) filter(where b.ordinal<=1000),'[]'::jsonb),
  'truncated',count(*)>1000
 ) from bounded b;
$$;

create function public.tracking_reprocess_enqueue(p_candidates jsonb,p_limit integer default 25)
returns integer language plpgsql security invoker set search_path='' set lock_timeout='25ms' as $$
declare approved record;current_row record;n integer:=0;
begin
 if jsonb_typeof(p_candidates) is distinct from 'array' then raise exception 'TRACKING_REPROCESS_INVALID_APPROVAL';end if;
 -- Lock base rows and re-evaluate eligibility while holding the locks, so order
 -- identity/PII, account or workspace changes cannot race the final queue write.
 for approved in
  select x.value->>'order_id' order_id,x.value->>'version' version
  from jsonb_array_elements(p_candidates) with ordinality x(value,ordinality)
  order by x.ordinality limit greatest(0,least(coalesce(p_limit,25),25))
 loop
  begin
  perform 1 from public.shipment_tracking_state s
  join public.fulfillment_orders o on o.id=s.order_id
  join public.integration_accounts a on a.id=s.account_id
  join public.workspaces w on w.id=s.owner_id
  where s.order_id=approved.order_id::uuid for update of s for share of o,a,w;
  if not found then continue;end if;
  select * into current_row from public.tracking_reprocess_candidates() c
  where c.order_id=approved.order_id::uuid and c.version=approved.version;
  if not found then continue;end if;
  -- Never erase leases, account pauses or failure backoff to force work.
  update public.shipment_tracking_state s set next_poll_at=now()
  where s.order_id=current_row.order_id and md5(to_jsonb(s)::text)=approved.version
  and (s.lease_until is null or s.lease_until<now())
  and (current_row.paused_until is null or current_row.paused_until<=now())
  and not (s.failures>0 and s.next_poll_at>now());
  if found then n:=n+1;end if;
  exception when lock_not_available then
   -- A busy business row is omitted, never waited on for a full worker run.
   continue;
  end;
 end loop;
 return n;
end;$$;
revoke all on function public.tracking_reprocess_candidates(),public.tracking_reprocess_preview_candidates(),public.tracking_reprocess_enqueue(jsonb,integer) from public,anon,authenticated;
grant execute on function public.tracking_reprocess_candidates(),public.tracking_reprocess_preview_candidates(),public.tracking_reprocess_enqueue(jsonb,integer) to service_role;
