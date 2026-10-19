create table private.analytics_timezone_names(name text primary key);
insert into private.analytics_timezone_names select name from pg_catalog.pg_timezone_names;
revoke all on private.analytics_timezone_names from public,anon,authenticated;
DO $$begin if exists(select 1 from public.app_settings s where coalesce(s.config->'general'->>'timezone','')<>'' and not exists(select 1 from private.analytics_timezone_names z where z.name=s.config->'general'->>'timezone')) then raise exception 'INVALID_EXISTING_TIMEZONE';end if;end$$;
create function private.validate_analytics_timezone() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(new.config->'general'->>'timezone','')<>'' and not exists(select 1 from private.analytics_timezone_names z where z.name=new.config->'general'->>'timezone') then raise exception 'Zona horaria no válida' using errcode='22023';end if;
 return new;
end$$;
revoke all on function private.validate_analytics_timezone() from public,anon,authenticated;
create trigger app_settings_validate_timezone before insert or update of config on public.app_settings for each row execute function private.validate_analytics_timezone();
create or replace function private.amazon_analytics_timezone() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select nullif(s.config->'general'->>'timezone','') from public.app_settings s where s.owner_id=(select private.app_workspace_owner_id()) limit 1),'Europe/Madrid')
$$;
CREATE OR REPLACE FUNCTION private.shopify_shipping_at_timezone(owner uuid, store uuid, remote_order text, event_date date, p_timezone text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select f.shipping_cost_net_amount*private.amazon_rate_to_eur(coalesce(nullif(f.shipping_cost_currency,''),'EUR'),coalesce((f.shipping_cost_recorded_at at time zone p_timezone)::date,event_date))
 from public.fulfillment_orders f where f.owner_id=owner and owner=private.shopify_analytics_owner() and f.source_channel='shopify'
 and f.source_integration_account_id=store and (f.order_id=remote_order or f.sendcloud_id='shopify:'||store::text||':'||remote_order)
 order by f.shipping_cost_recorded_at desc nulls last,f.last_synced_at desc nulls last limit 1;$function$
;
CREATE OR REPLACE FUNCTION private.shopify_summary_period(p_owner uuid, from_date date, to_date date, integration_account_ids uuid[], v_timezone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid:=p_owner; result jsonb;begin
 if from_date is null or to_date is null or from_date>to_date then raise exception 'El período no es válido.';end if;
 with eligible as(select o.*,(o.event_at at time zone v_timezone)::date d,private.amazon_rate_to_eur(o.currency,(o.event_at at time zone v_timezone)::date) fx
 from public.shopify_analytics_orders o join public.integration_accounts a on a.id=o.integration_account_id and a.owner_id=v and a.enabled and a.status<>'disabled'
 where o.owner_id=v and not o.test and o.financial_status in ('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED')
 and o.event_at>=(from_date::timestamp at time zone v_timezone) and o.event_at<((to_date+1)::timestamp at time zone v_timezone) and (coalesce(cardinality(integration_account_ids),0)=0 or o.integration_account_id=any(integration_account_ids))),
 sales as(select count(*) orders,coalesce(sum(gross_sales*fx),0) gross,coalesce(sum(sales_vat*fx),0) vat,coalesce(sum(discounts*fx),0) discounts,coalesce(sum(shipping_charged*fx),0) shipping_charged,count(*) filter(where fx is null) missing_fx from eligible),
 cost_rows as(select i.quantity,c.cost,c.missing,c.mapping_count from eligible o join public.shopify_analytics_items i on i.integration_account_id=o.integration_account_id and i.order_id=o.order_id and i.owner_id=v left join lateral private.shopify_cost(v,i.integration_account_id,i.seller_sku,o.d) c on true),
 costs as(select coalesce(sum(quantity),0) units,coalesce(sum(quantity*cost),0) product_cost,count(*) filter(where mapping_count=0) unmapped,count(*) filter(where mapping_count=0 or missing>0) missing from cost_rows),
 shipping_rows as materialized (select case when not requires_shipping then 0 else private.shopify_shipping_at_timezone(v,integration_account_id,order_id,d,v_timezone) end cost from eligible),
 shipping as(select coalesce(sum(cost),0) cost,count(*) filter(where cost is null) missing from shipping_rows),
 refund_rows as(select r.*,private.amazon_rate_to_eur(r.currency,(r.event_at at time zone v_timezone)::date) fx from public.shopify_analytics_refunds r join public.integration_accounts a on a.id=r.integration_account_id and a.owner_id=v and a.enabled and a.status<>'disabled'
 where r.owner_id=v and exists(select 1 from public.shopify_analytics_orders ro where ro.integration_account_id=r.integration_account_id and ro.order_id=r.order_id and ro.owner_id=v and not ro.test) and r.event_at>=(from_date::timestamp at time zone v_timezone) and r.event_at<((to_date+1)::timestamp at time zone v_timezone) and (coalesce(cardinality(integration_account_ids),0)=0 or r.integration_account_id=any(integration_account_ids))),
 refunds as(select count(*) n,coalesce(sum(gross_amount*fx),0) gross,coalesce(sum(net_amount*fx),0) net,count(*) filter(where fx is null) missing_fx from refund_rows)
 select jsonb_build_object('grossSales',case when s.missing_fx=0 then round(s.gross,2) end,'salesVat',case when s.missing_fx=0 then round(s.vat,2) end,'netSales',case when s.missing_fx=0 then round(s.gross-s.vat,2) end,'orders',s.orders,'units',c.units,'refunds',case when r.missing_fx=0 then round(r.net,2) end,'refundGross',case when r.missing_fx=0 then round(r.gross,2) end,'refundCount',r.n,'discounts',case when s.missing_fx=0 then round(s.discounts,2) end,'shippingCharged',case when s.missing_fx=0 then round(s.shipping_charged,2) end,'productCost',case when c.missing=0 then round(c.product_cost,2) end,'shippingCost',case when sh.missing=0 then round(sh.cost,2) end,'paymentFees',null,'adsCost',null,'netProfit',null,'profitBeforeAds',case when c.missing+sh.missing+s.missing_fx+r.missing_fx=0 then round(s.gross-s.vat-r.net-c.product_cost-sh.cost,2) end,'marginPct',null,'knownMarginPct',case when s.missing_fx=0 and r.missing_fx=0 and s.gross-s.vat>0 then round(100*(s.gross-s.vat-r.net-c.product_cost-sh.cost)/nullif(s.gross-s.vat,0),1) end,'unmappedSkuCount',c.unmapped,'missingCostCount',c.missing+sh.missing,'missingFxCount',s.missing_fx+r.missing_fx,'profitComplete',false,'currency','EUR','availableFrom',(select min(st.available_from) from public.shopify_analytics_sync_state st where st.owner_id=v and (coalesce(cardinality(integration_account_ids),0)=0 or st.integration_account_id=any(integration_account_ids)))) into result from sales s cross join costs c cross join shipping sh cross join refunds r;
 return result;end;$function$
;
DO $patch$
declare target regprocedure;impl oid;body text;old text;definition text;
begin
 foreach target in array array['public.shopify_analytics_summary(date,date,uuid[])'::regprocedure,'public.shopify_analytics_products(date,date,uuid[],text,integer,integer,text,text,boolean)'::regprocedure] loop
 select implementation::oid into strict impl from private.mfa_function_manifest where function_oid=target::oid and wrapper_hash=md5(pg_get_functiondef(target::oid));
 select prosrc into strict old from pg_proc where oid=impl;definition:=pg_get_functiondef(impl);
 if target::oid='public.shopify_analytics_summary(date,date,uuid[])'::regprocedure::oid then
 body:='begin return private.shopify_summary_period(private.shopify_analytics_owner(),$1,$2,$3,private.amazon_analytics_timezone());end;';
 else
 body:=replace(old,'private.amazon_analytics_timezone()','v_timezone');
 body:=replace(body,'declare v uuid:=','declare v_timezone text:=private.amazon_analytics_timezone(); v uuid:=');
 end if;
 execute replace(definition,old,body);
 end loop;
end;$patch$;
create function public.shopify_analytics_summary_batch(periods jsonb,integration_account_ids uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid;v_timezone text;r jsonb;result jsonb:='[]';data jsonb;begin
 perform public.security_mfa_assert(false);v_owner:=private.shopify_analytics_owner();
 if jsonb_typeof(periods) is distinct from 'array' then raise exception 'Invalid periods';end if;
 if jsonb_array_length(periods) not between 1 and 8 then raise exception 'Between 1 and 8 periods required';end if;
 if exists(select 1 from jsonb_array_elements(periods) x where coalesce(x->>'id','')='' or x->>'from' is null or x->>'to' is null) or (select count(distinct x->>'id') from jsonb_array_elements(periods) x)<>jsonb_array_length(periods) then raise exception 'Invalid or repeated period IDs';end if;
 v_timezone:=private.amazon_analytics_timezone();
 for r in select value from jsonb_array_elements(periods) loop
 begin
 data:=private.shopify_summary_period(v_owner,(r->>'from')::date,(r->>'to')::date,integration_account_ids,v_timezone);
 result:=result||jsonb_build_array(jsonb_build_object('id',r->>'id','data',data));
 exception when invalid_datetime_format or datetime_field_overflow or raise_exception then
 result:=result||jsonb_build_array(jsonb_build_object('id',r->>'id','data',null,'error','No se pudo consultar el periodo.'));
 end;
 end loop;
 return result;end$$;
revoke all on function public.shopify_analytics_summary_batch(jsonb,uuid[]) from public,anon;
grant execute on function public.shopify_analytics_summary_batch(jsonb,uuid[]) to authenticated;
revoke all on function private.shopify_summary_period(uuid,date,date,uuid[],text),private.shopify_shipping_at_timezone(uuid,uuid,text,date,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.shopify_shipping(owner uuid, store uuid, remote_order text, event_date date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with timezone_context as materialized (select private.amazon_analytics_timezone() as value)
 select f.shipping_cost_net_amount*private.amazon_rate_to_eur(coalesce(nullif(f.shipping_cost_currency,''),'EUR'),coalesce((f.shipping_cost_recorded_at at time zone timezone_context.value)::date,event_date))
 from public.fulfillment_orders f cross join timezone_context where f.owner_id=owner and owner=private.shopify_analytics_owner() and f.source_channel='shopify'
 and f.source_integration_account_id=store and (f.order_id=remote_order or f.sendcloud_id='shopify:'||store::text||':'||remote_order)
 order by f.shipping_cost_recorded_at desc nulls last,f.last_synced_at desc nulls last limit 1;$function$
;

-- Register the additive public endpoint in the existing MFA integrity inventory.
DO $wrap$
declare original text;begin
 original:=pg_get_functiondef('public.shopify_analytics_summary_batch(jsonb,uuid[])'::regprocedure);
 execute replace(replace(original,'FUNCTION public.shopify_analytics_summary_batch(', 'FUNCTION private.mfa_impl_shopify_summary_batch('),' perform public.security_mfa_assert(false);v_owner:=',' v_owner:=');
 create or replace function public.shopify_analytics_summary_batch(periods jsonb,integration_account_ids uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $body$
 begin perform public.security_mfa_assert(false);return private.mfa_impl_shopify_summary_batch($1,$2);end $body$;
 revoke all on function private.mfa_impl_shopify_summary_batch(jsonb,uuid[]) from public,anon,authenticated;
 insert into private.mfa_function_manifest(signature,function_oid,implementation,original_definition,wrapper_hash)
 values('public.shopify_analytics_summary_batch(jsonb,uuid[])','public.shopify_analytics_summary_batch(jsonb,uuid[])'::regprocedure::oid,'private.mfa_impl_shopify_summary_batch(jsonb,uuid[])'::regprocedure,original,md5(pg_get_functiondef('public.shopify_analytics_summary_batch(jsonb,uuid[])'::regprocedure)));
end $wrap$;
