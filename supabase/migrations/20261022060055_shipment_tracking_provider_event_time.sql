-- Some carriers return civil event times without an offset. Preserve the exact
-- provider time without inventing a UTC instant or using the poll time.
alter table public.shipment_tracking_state add column raw_event_time text;
alter table public.shipment_tracking_events add column raw_event_time text;
do $patch$
declare src text;anchor text;
begin
 src:=pg_get_functiondef('public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure);
 anchor:='raw_code,raw_message,event_at)';if position(anchor in src)=0 then raise exception 'TRACKING_EVENT_COLUMNS_CHANGED';end if;
 src:=replace(src,anchor,'raw_code,raw_message,event_at,raw_event_time)');
 anchor:=$s$nullif(p_event->>'eventAt','')::timestamptz) on conflict$s$;
 if position(anchor in src)=0 then raise exception 'TRACKING_EVENT_VALUES_CHANGED';end if;
 src:=replace(src,anchor,$s$nullif(p_event->>'eventAt','')::timestamptz,left(p_event->>'eventTimeRaw',40)) on conflict$s$);
 anchor:=' observed_at=case when p_error';if position(anchor in src)=0 then raise exception 'TRACKING_EVENT_UPDATE_CHANGED';end if;
 src:=replace(src,anchor,$s$ raw_event_time=case when p_error is null then left(p_event->>'eventTimeRaw',40) else raw_event_time end,
 observed_at=case when p_error$s$);
 execute src;
 -- Relabeling must also invalidate an old civil time.
 src:=pg_get_functiondef('public.tracking_seed_shadow()'::regprocedure);
 src:=replace(src,'normalized_state=null,raw_code=null','normalized_state=null,raw_event_time=null,raw_code=null');
 src:=replace(src,' order by o.label_created_at desc nulls last limit 1000',' and not exists(select 1 from public.shipment_tracking_state existing where existing.order_id=o.id and existing.identity_key=private.shipment_tracking_identity(o)) order by o.label_created_at desc nulls last limit 1000');execute src;
end $patch$;
