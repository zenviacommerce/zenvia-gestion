create function private.shipment_tracking_terminal(p_provider text,p_code text) returns boolean language sql immutable set search_path='' as $$
 select upper(replace(coalesce(p_code,''),' ','_')) in('DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER') or (p_provider='envia' and trim(coalesce(p_code,'')) in('3','4','11','13'));
$$;
revoke all on function private.shipment_tracking_terminal(text,text) from public,anon,authenticated;
grant execute on function private.shipment_tracking_terminal(text,text) to service_role;
do $patch$
declare fn record;src text;old_cond text;
begin
 old_cond:=$s$upper(replace(coalesce(o.tracking_status_code,''),' ','_')) not in('DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER')$s$;
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('tracking_seed_shadow','tracking_claim') loop
 src:=pg_get_functiondef(fn.oid);if position(old_cond in src)=0 then raise exception 'TRACKING_TERMINAL_SOURCE_CHANGED';end if;
 execute replace(src,old_cond,'not private.shipment_tracking_terminal(a.provider,o.tracking_status_code)');
 end loop;
 src:=pg_get_functiondef('public.tracking_finish(uuid,uuid,text,jsonb,timestamptz,text)'::regprocedure);
 old_cond:=$s$upper(replace(coalesce(o.tracking_status_code,''),' ','_')) in('DELIVERED','RETURNED','CANCELLED','CANCELED','DELIVERED_AT_ORIGIN','SHIPMENT_COLLECTED_BY_CUSTOMER')$s$;
 if position(old_cond in src)=0 then raise exception 'TRACKING_TERMINAL_FINISH_CHANGED';end if;
 execute replace(src,old_cond,'private.shipment_tracking_terminal(s.provider,o.tracking_status_code)');
end $patch$;
